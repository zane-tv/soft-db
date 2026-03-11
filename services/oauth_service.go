package services

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"soft-db/internal/store"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// OAuthService manages OAuth 2.0 PKCE flow for ChatGPT authentication
type OAuthService struct {
	store *store.Store
	app   *application.App
	mu    sync.Mutex

	// PKCE state
	codeVerifier string
	state        string
	callbackCh   chan callbackResult
}

// AuthStatus represents the current authentication state
type AuthStatus struct {
	Status string `json:"status"` // "logged_in", "logged_out", "expired"
	Email  string `json:"email,omitempty"`
}

type callbackResult struct {
	Code  string
	Error string
}

// tokenResponse represents the OAuth token exchange response
type tokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"`
	TokenType    string `json:"token_type"`
	Error        string `json:"error,omitempty"`
	ErrorDesc    string `json:"error_description,omitempty"`
}

// NewOAuthService creates a new OAuth service
func NewOAuthService(s *store.Store) *OAuthService {
	return &OAuthService{
		store: s,
	}
}

// SetApp sets the Wails application reference (called after app creation)
func (o *OAuthService) SetApp(app *application.App) {
	o.app = app
}

// ─── Public Methods (Wails Bindings) ───

// StartOAuthLogin initiates the OAuth PKCE flow
func (o *OAuthService) StartOAuthLogin(clientID string) error {
	o.mu.Lock()
	defer o.mu.Unlock()

	// Generate PKCE code verifier (43-128 chars, base64url)
	verifierBytes := make([]byte, 32)
	if _, err := rand.Read(verifierBytes); err != nil {
		return fmt.Errorf("failed to generate code verifier: %w", err)
	}
	o.codeVerifier = base64.RawURLEncoding.EncodeToString(verifierBytes)

	// Generate code challenge = SHA256(verifier), base64url encoded
	hash := sha256.Sum256([]byte(o.codeVerifier))
	codeChallenge := base64.RawURLEncoding.EncodeToString(hash[:])

	// Generate state parameter
	stateBytes := make([]byte, 16)
	rand.Read(stateBytes)
	o.state = base64.RawURLEncoding.EncodeToString(stateBytes)

	// Start callback server on port 1455 (Codex CLI's registered redirect URI)
	listener, err := net.Listen("tcp", "127.0.0.1:1455")
	if err != nil {
		// Port 1455 busy — try fallback random port (may cause redirect_uri mismatch)
		listener, err = net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			return fmt.Errorf("failed to start callback server: %w", err)
		}
	}
	port := listener.Addr().(*net.TCPAddr).Port
	redirectURI := fmt.Sprintf("http://localhost:%d/auth/callback", port)

	o.callbackCh = make(chan callbackResult, 1)

	// HTTP server for OAuth callback
	mux := http.NewServeMux()
	mux.HandleFunc("/auth/callback", func(w http.ResponseWriter, r *http.Request) {
		// Only accept from localhost
		if !strings.HasPrefix(r.RemoteAddr, "127.0.0.1") && !strings.HasPrefix(r.RemoteAddr, "[::1]") {
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}

		code := r.URL.Query().Get("code")
		errParam := r.URL.Query().Get("error")
		state := r.URL.Query().Get("state")

		if state != o.state {
			o.callbackCh <- callbackResult{Error: "invalid state parameter"}
			fmt.Fprint(w, htmlCallbackPage("Error", "Invalid state parameter. Please try again."))
			return
		}

		if errParam != "" {
			o.callbackCh <- callbackResult{Error: errParam}
			fmt.Fprint(w, htmlCallbackPage("Error", "Authentication was cancelled or failed."))
			return
		}

		o.callbackCh <- callbackResult{Code: code}
		fmt.Fprint(w, htmlCallbackPage("Success", "You can close this window and return to SoftDB."))
	})

	server := &http.Server{Handler: mux}

	// Run server in background, auto-shutdown
	go func() {
		go server.Serve(listener)

		// Wait for callback or timeout (5 minutes)
		select {
		case result := <-o.callbackCh:
			// Shutdown server
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			server.Shutdown(ctx)

			if result.Error != "" {
				slog.Error("OAuth callback error", "error", result.Error)
				o.emitAuthStatus("logged_out", "")
				return
			}

			// Exchange code for tokens
			if err := o.exchangeCode(result.Code, redirectURI, clientID); err != nil {
				slog.Error("OAuth token exchange failed", "error", err)
				o.emitAuthStatus("logged_out", "")
				return
			}

		case <-time.After(5 * time.Minute):
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			server.Shutdown(ctx)
			slog.Info("OAuth callback timed out")
			o.emitAuthStatus("logged_out", "")
		}
	}()

	// Build authorization URL
	authURL := fmt.Sprintf(
		"https://auth.openai.com/oauth/authorize?response_type=code&client_id=%s&redirect_uri=%s&scope=%s&state=%s&code_challenge=%s&code_challenge_method=S256&audience=%s",
		url.QueryEscape(clientID),
		url.QueryEscape(redirectURI),
		url.QueryEscape("openid profile email offline_access"),
		url.QueryEscape(o.state),
		url.QueryEscape(codeChallenge),
		url.QueryEscape("https://api.openai.com/v1"),
	)

	// Open browser
	if err := application.Get().Browser.OpenURL(authURL); err != nil {
		return fmt.Errorf("failed to open browser: %w", err)
	}

	return nil
}

// GetAuthStatus returns the current authentication state
func (o *OAuthService) GetAuthStatus() AuthStatus {
	tokens, err := o.store.LoadOAuthTokens()
	if err != nil {
		return AuthStatus{Status: "logged_out"}
	}

	// Check if expired
	expiresAt, err := time.Parse(time.RFC3339, tokens.ExpiresAt)
	if err != nil {
		return AuthStatus{Status: "logged_out"}
	}

	if time.Now().After(expiresAt) {
		return AuthStatus{Status: "expired"}
	}

	return AuthStatus{Status: "logged_in"}
}

// Logout clears stored tokens
func (o *OAuthService) Logout() error {
	if err := o.store.DeleteOAuthTokens(); err != nil {
		return err
	}
	o.emitAuthStatus("logged_out", "")
	return nil
}

// ─── Internal Methods ───

// GetValidToken returns a valid access token, refreshing if needed
func (o *OAuthService) GetValidToken(clientID string) (string, error) {
	tokens, err := o.store.LoadOAuthTokens()
	if err != nil {
		return "", fmt.Errorf("not authenticated: %w", err)
	}

	// Check expiry with 60s buffer
	expiresAt, err := time.Parse(time.RFC3339, tokens.ExpiresAt)
	if err != nil {
		return "", fmt.Errorf("invalid token expiry: %w", err)
	}

	if time.Now().Add(60 * time.Second).Before(expiresAt) {
		// Token still valid
		return tokens.AccessToken, nil
	}

	// Try refresh
	if tokens.RefreshToken == "" {
		return "", fmt.Errorf("token expired and no refresh token available")
	}

	if err := o.refreshToken(tokens.RefreshToken, clientID); err != nil {
		return "", fmt.Errorf("token refresh failed: %w", err)
	}

	// Load refreshed tokens
	tokens, err = o.store.LoadOAuthTokens()
	if err != nil {
		return "", err
	}
	return tokens.AccessToken, nil
}

// exchangeCode exchanges the authorization code for tokens
func (o *OAuthService) exchangeCode(code, redirectURI, clientID string) error {
	data := url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {code},
		"redirect_uri":  {redirectURI},
		"client_id":     {clientID},
		"code_verifier": {o.codeVerifier},
	}

	resp, err := http.PostForm("https://auth.openai.com/oauth/token", data)
	if err != nil {
		return fmt.Errorf("token exchange request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("failed to read response: %w", err)
	}

	var tokenResp tokenResponse
	if err := json.Unmarshal(body, &tokenResp); err != nil {
		return fmt.Errorf("failed to parse token response: %w", err)
	}

	if tokenResp.Error != "" {
		return fmt.Errorf("OAuth error: %s — %s", tokenResp.Error, tokenResp.ErrorDesc)
	}

	// Calculate expiry
	expiresAt := time.Now().Add(time.Duration(tokenResp.ExpiresIn) * time.Second)

	// Save encrypted tokens
	if err := o.store.SaveOAuthTokens(store.OAuthTokens{
		AccessToken:  tokenResp.AccessToken,
		RefreshToken: tokenResp.RefreshToken,
		ExpiresAt:    expiresAt.Format(time.RFC3339),
		Provider:     "openai",
	}); err != nil {
		return fmt.Errorf("failed to save tokens: %w", err)
	}

	o.emitAuthStatus("logged_in", "")
	slog.Info("OAuth login successful")
	return nil
}

// refreshToken refreshes the access token using the refresh token
func (o *OAuthService) refreshToken(refreshToken, clientID string) error {
	data := url.Values{
		"grant_type":    {"refresh_token"},
		"refresh_token": {refreshToken},
		"client_id":     {clientID},
	}

	resp, err := http.PostForm("https://auth.openai.com/oauth/token", data)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}

	var tokenResp tokenResponse
	if err := json.Unmarshal(body, &tokenResp); err != nil {
		return err
	}

	if tokenResp.Error != "" {
		// Refresh failed — clear tokens
		o.store.DeleteOAuthTokens()
		o.emitAuthStatus("logged_out", "")
		return fmt.Errorf("refresh failed: %s", tokenResp.Error)
	}

	expiresAt := time.Now().Add(time.Duration(tokenResp.ExpiresIn) * time.Second)

	// Use new refresh token if provided, otherwise keep old one
	newRefresh := tokenResp.RefreshToken
	if newRefresh == "" {
		newRefresh = refreshToken
	}

	return o.store.SaveOAuthTokens(store.OAuthTokens{
		AccessToken:  tokenResp.AccessToken,
		RefreshToken: newRefresh,
		ExpiresAt:    expiresAt.Format(time.RFC3339),
		Provider:     "openai",
	})
}

// emitAuthStatus sends auth status event to frontend
func (o *OAuthService) emitAuthStatus(status, email string) {
	if o.app == nil {
		return
	}
	o.app.Event.Emit("auth:status", map[string]interface{}{
		"status": status,
		"email":  email,
	})
}

// htmlCallbackPage returns a simple HTML page for the OAuth callback
func htmlCallbackPage(title, message string) string {
	return fmt.Sprintf(`<!DOCTYPE html>
<html><head><title>SoftDB - %s</title>
<style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#18181b;color:#fafafa}
.card{text-align:center;padding:2rem;border-radius:12px;background:#27272a;max-width:400px}
h1{font-size:1.5rem;margin-bottom:0.5rem}p{color:#a1a1aa}</style></head>
<body><div class="card"><h1>%s</h1><p>%s</p></div></body></html>`, title, title, message)
}
