package services

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeTestBinary(t *testing.T, dir, name, content string) string {
	t.Helper()
	p := filepath.Join(dir, name)
	if err := os.WriteFile(p, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
	return p
}

func sha256Hex(data string) string {
	h := sha256.Sum256([]byte(data))
	return hex.EncodeToString(h[:])
}

func TestUpdateChecksumValid(t *testing.T) {
	binaryContent := "fake-binary-content-for-testing"
	binaryName := "SoftDB-linux-amd64.AppImage"
	expectedHash := sha256Hex(binaryContent)

	checksumBody := fmt.Sprintf("%s  %s\n%s  SoftDB-amd64-installer.exe\n",
		expectedHash, binaryName, "aaaa"+expectedHash[4:])

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, checksumBody)
	}))
	defer srv.Close()

	dir := t.TempDir()
	binaryPath := writeTestBinary(t, dir, binaryName, binaryContent)

	err := verifyChecksum(binaryPath, srv.URL+"/SHA256SUMS.txt", binaryName)
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}

	if _, statErr := os.Stat(binaryPath); statErr != nil {
		t.Fatal("binary should still exist after successful verification")
	}
}

func TestUpdateChecksumInvalid(t *testing.T) {
	binaryContent := "real-binary-data"
	binaryName := "SoftDB-linux-amd64.AppImage"
	wrongHash := "deadbeef" + sha256Hex("wrong-data")[8:]

	checksumBody := fmt.Sprintf("%s  %s\n", wrongHash, binaryName)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, checksumBody)
	}))
	defer srv.Close()

	dir := t.TempDir()
	binaryPath := writeTestBinary(t, dir, binaryName, binaryContent)

	err := verifyChecksum(binaryPath, srv.URL+"/SHA256SUMS.txt", binaryName)
	if err == nil {
		t.Fatal("expected checksum mismatch error, got nil")
	}

	if got := err.Error(); !contains(got, "sha256 mismatch") {
		t.Fatalf("expected sha256 mismatch error, got: %s", got)
	}
}

func TestUpdateChecksumFileMissing(t *testing.T) {
	binaryContent := "some-binary"
	binaryName := "SoftDB-darwin-arm64.dmg"

	dir := t.TempDir()
	binaryPath := writeTestBinary(t, dir, binaryName, binaryContent)

	err := verifyChecksum(binaryPath, "", binaryName)
	if err != nil {
		t.Fatalf("expected graceful skip when no checksum URL, got: %v", err)
	}

	if _, statErr := os.Stat(binaryPath); statErr != nil {
		t.Fatal("binary should still exist when checksum file is missing")
	}
}

func TestUpdateChecksumServerError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	dir := t.TempDir()
	binaryPath := writeTestBinary(t, dir, "SoftDB.exe", "binary")

	err := verifyChecksum(binaryPath, srv.URL+"/SHA256SUMS.txt", "SoftDB.exe")
	if err != nil {
		t.Fatalf("expected graceful skip on server error, got: %v", err)
	}
}

func TestUpdateChecksumAssetNotInFile(t *testing.T) {
	checksumBody := fmt.Sprintf("%s  other-file.txt\n", sha256Hex("other"))

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, checksumBody)
	}))
	defer srv.Close()

	dir := t.TempDir()
	binaryPath := writeTestBinary(t, dir, "SoftDB.AppImage", "binary")

	err := verifyChecksum(binaryPath, srv.URL+"/SHA256SUMS.txt", "SoftDB.AppImage")
	if err != nil {
		t.Fatalf("expected graceful skip when asset not in checksum file, got: %v", err)
	}
}

func TestParseChecksumFile(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		target   string
		wantHash string
		wantErr  bool
	}{
		{
			name:     "standard sha256sum format",
			input:    "abc123def456  myfile.dmg\nfff000aaa111  other.exe\n",
			target:   "myfile.dmg",
			wantHash: "abc123def456",
		},
		{
			name:     "binary mode asterisk prefix",
			input:    "abc123def456 *myfile.dmg\n",
			target:   "myfile.dmg",
			wantHash: "abc123def456",
		},
		{
			name:    "target not found",
			input:   "abc123def456  other.dmg\n",
			target:  "missing.dmg",
			wantErr: true,
		},
		{
			name:     "uppercase hash normalized",
			input:    "ABC123DEF456  myfile.dmg\n",
			target:   "myfile.dmg",
			wantHash: "abc123def456",
		},
		{
			name:     "empty lines ignored",
			input:    "\n\nabc123  myfile.dmg\n\n",
			target:   "myfile.dmg",
			wantHash: "abc123",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := strings.NewReader(tt.input)
			got, err := parseChecksumFile(r, tt.target)
			if tt.wantErr {
				if err == nil {
					t.Fatal("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tt.wantHash {
				t.Errorf("got %q, want %q", got, tt.wantHash)
			}
		})
	}
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && searchSubstring(s, substr)
}

func searchSubstring(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
