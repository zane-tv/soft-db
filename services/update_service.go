package services

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// UpdateInfo holds the result of a version check
type UpdateInfo struct {
	CurrentVersion string `json:"currentVersion"`
	LatestVersion  string `json:"latestVersion"`
	HasUpdate      bool   `json:"hasUpdate"`
	ReleaseNotes   string `json:"releaseNotes"`
	PublishedAt    string `json:"publishedAt"`
	HTMLURL        string `json:"htmlUrl"`
}

// DownloadProgress reports download progress to the frontend
type DownloadProgress struct {
	Percent    int    `json:"percent"`
	Downloaded int64  `json:"downloaded"`
	Total      int64  `json:"total"`
	Status     string `json:"status"` // "downloading", "verifying", "ready", "error"
	Error      string `json:"error,omitempty"`
}

// ReleaseAsset from GitHub API
type ghRelease struct {
	TagName     string    `json:"tag_name"`
	Name        string    `json:"name"`
	Body        string    `json:"body"`
	HTMLURL     string    `json:"html_url"`
	PublishedAt time.Time `json:"published_at"`
	Assets      []struct {
		Name               string `json:"name"`
		BrowserDownloadURL string `json:"browser_download_url"`
		Size               int64  `json:"size"`
	} `json:"assets"`
}

const (
	githubOwner = "zane-tv"
	githubRepo  = "soft-db"
	apiBase     = "https://api.github.com/repos/" + githubOwner + "/" + githubRepo
)

// UpdateService checks for updates and manages downloads
type UpdateService struct {
	version string
	app     *application.App
	mu      sync.Mutex
	cached  *UpdateInfo
}

// NewUpdateService creates the service
func NewUpdateService(version string) *UpdateService {
	return &UpdateService{version: version}
}

// SetApp injects the Wails app reference for event emission
func (s *UpdateService) SetApp(app *application.App) {
	s.app = app
}

// GetAppVersion returns the current app version
func (s *UpdateService) GetAppVersion() string {
	return s.version
}

// CheckForUpdate checks the latest GitHub release
func (s *UpdateService) CheckForUpdate() (*UpdateInfo, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	resp, err := http.Get(apiBase + "/releases/latest")
	if err != nil {
		return nil, fmt.Errorf("failed to check for updates: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("GitHub API returned %d", resp.StatusCode)
	}

	var release ghRelease
	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
		return nil, fmt.Errorf("failed to parse release: %w", err)
	}

	info := &UpdateInfo{
		CurrentVersion: s.version,
		LatestVersion:  release.TagName,
		HasUpdate:      isNewer(release.TagName, s.version),
		ReleaseNotes:   release.Body,
		PublishedAt:    release.PublishedAt.Format(time.RFC3339),
		HTMLURL:        release.HTMLURL,
	}

	s.cached = info
	return info, nil
}

// GetChangelog fetches release notes for multiple versions
func (s *UpdateService) GetChangelog(limit int) ([]UpdateInfo, error) {
	if limit <= 0 || limit > 20 {
		limit = 10
	}

	resp, err := http.Get(fmt.Sprintf("%s/releases?per_page=%d", apiBase, limit))
	if err != nil {
		return nil, fmt.Errorf("failed to fetch changelog: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("GitHub API returned %d", resp.StatusCode)
	}

	var releases []ghRelease
	if err := json.NewDecoder(resp.Body).Decode(&releases); err != nil {
		return nil, fmt.Errorf("failed to parse releases: %w", err)
	}

	var result []UpdateInfo
	for _, r := range releases {
		result = append(result, UpdateInfo{
			CurrentVersion: s.version,
			LatestVersion:  r.TagName,
			HasUpdate:      isNewer(r.TagName, s.version),
			ReleaseNotes:   r.Body,
			PublishedAt:    r.PublishedAt.Format(time.RFC3339),
			HTMLURL:        r.HTMLURL,
		})
	}
	return result, nil
}

// DownloadUpdate downloads the appropriate installer for the current platform
func (s *UpdateService) DownloadUpdate() (*DownloadProgress, error) {
	// Get latest release
	resp, err := http.Get(apiBase + "/releases/latest")
	if err != nil {
		return &DownloadProgress{Status: "error", Error: err.Error()}, nil
	}
	defer resp.Body.Close()

	var release ghRelease
	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
		return &DownloadProgress{Status: "error", Error: err.Error()}, nil
	}

	// Find the right asset for this platform
	assetName := getAssetName()
	var downloadURL string
	var expectedSize int64

	for _, asset := range release.Assets {
		if strings.Contains(asset.Name, assetName) {
			downloadURL = asset.BrowserDownloadURL
			expectedSize = asset.Size
			break
		}
	}

	if downloadURL == "" {
		return &DownloadProgress{
			Status: "error",
			Error:  fmt.Sprintf("No download found for %s/%s", runtime.GOOS, runtime.GOARCH),
		}, nil
	}

	// Download to temp dir
	tempDir, err := os.MkdirTemp("", "softdb-update-*")
	if err != nil {
		return &DownloadProgress{Status: "error", Error: err.Error()}, nil
	}

	destPath := filepath.Join(tempDir, filepath.Base(downloadURL))

	// Start download in background, emit progress events
	go s.downloadFile(downloadURL, destPath, expectedSize)

	return &DownloadProgress{
		Status:  "downloading",
		Total:   expectedSize,
		Percent: 0,
	}, nil
}

// OpenReleasePage opens the GitHub release page in the default browser
func (s *UpdateService) OpenReleasePage(url string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	return cmd.Start()
}

// downloadFile downloads a file and emits progress events
func (s *UpdateService) downloadFile(url, destPath string, expectedSize int64) {
	emit := func(p DownloadProgress) {
		if s.app != nil {
			s.app.Event.Emit("update:progress", p)
		}
	}

	resp, err := http.Get(url)
	if err != nil {
		emit(DownloadProgress{Status: "error", Error: err.Error()})
		return
	}
	defer resp.Body.Close()

	total := resp.ContentLength
	if total <= 0 {
		total = expectedSize
	}

	file, err := os.Create(destPath)
	if err != nil {
		emit(DownloadProgress{Status: "error", Error: err.Error()})
		return
	}
	defer file.Close()

	var downloaded int64
	buf := make([]byte, 32*1024) // 32KB chunks
	lastEmit := time.Now()

	for {
		n, readErr := resp.Body.Read(buf)
		if n > 0 {
			_, writeErr := file.Write(buf[:n])
			if writeErr != nil {
				emit(DownloadProgress{Status: "error", Error: writeErr.Error()})
				return
			}
			downloaded += int64(n)

			// Emit progress every 200ms
			if time.Since(lastEmit) > 200*time.Millisecond {
				pct := 0
				if total > 0 {
					pct = int(downloaded * 100 / total)
				}
				emit(DownloadProgress{
					Status:     "downloading",
					Percent:    pct,
					Downloaded: downloaded,
					Total:      total,
				})
				lastEmit = time.Now()
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			emit(DownloadProgress{Status: "error", Error: readErr.Error()})
			return
		}
	}

	// Done — emit ready with file path
	emit(DownloadProgress{
		Status:     "ready",
		Percent:    100,
		Downloaded: downloaded,
		Total:      total,
	})

	// Auto-open the downloaded file
	s.openDownloadedFile(destPath)
}

// openDownloadedFile opens the downloaded installer/package
func (s *UpdateService) openDownloadedFile(path string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", path)
	case "windows":
		cmd = exec.Command("cmd", "/c", "start", "", path)
	default:
		// Linux: make AppImage executable and run, or install .deb
		if strings.HasSuffix(path, ".AppImage") {
			os.Chmod(path, 0755)
			cmd = exec.Command(path)
		} else if strings.HasSuffix(path, ".deb") {
			cmd = exec.Command("xdg-open", path)
		} else {
			cmd = exec.Command("xdg-open", path)
		}
	}
	if cmd != nil {
		cmd.Start()
	}
}

// getAssetName returns the expected asset filename pattern for the current platform
func getAssetName() string {
	switch runtime.GOOS {
	case "darwin":
		return "darwin-arm64.dmg"
	case "windows":
		return "installer.exe"
	case "linux":
		return ".AppImage"
	default:
		return ""
	}
}

// isNewer compares two semver-style version tags (e.g., "v1.2.3" > "v1.1.0")
func isNewer(latest, current string) bool {
	// Strip "v" prefix
	latest = strings.TrimPrefix(latest, "v")
	current = strings.TrimPrefix(current, "v")

	// Handle "dev" as always old
	if current == "dev" || current == "" {
		return latest != "dev" && latest != ""
	}

	lParts := strings.Split(latest, ".")
	cParts := strings.Split(current, ".")

	for i := 0; i < 3; i++ {
		var l, c int
		if i < len(lParts) {
			fmt.Sscanf(lParts[i], "%d", &l)
		}
		if i < len(cParts) {
			fmt.Sscanf(cParts[i], "%d", &c)
		}
		if l > c {
			return true
		}
		if l < c {
			return false
		}
	}
	return false
}
