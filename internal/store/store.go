package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"soft-db/internal/crypto"
	"soft-db/internal/driver"

	_ "modernc.org/sqlite"
)

// Store handles local SQLite persistence for connections and query history
type Store struct {
	db *sql.DB
}

// New creates and initializes the local store
func New() (*Store, error) {
	// Get user config directory
	configDir, err := os.UserConfigDir()
	if err != nil {
		configDir = "."
	}

	appDir := filepath.Join(configDir, "SoftDB")
	if err := os.MkdirAll(appDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create config dir: %w", err)
	}

	dbPath := filepath.Join(appDir, "softdb.sqlite")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open store: %w", err)
	}

	db.Exec("PRAGMA journal_mode=WAL")
	db.Exec("PRAGMA foreign_keys=ON")

	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		return nil, fmt.Errorf("failed to migrate store: %w", err)
	}

	return s, nil
}

func (s *Store) migrate() error {
	_, err := s.db.Exec(`
		CREATE TABLE IF NOT EXISTS connections (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			type TEXT NOT NULL,
			host TEXT,
			port INTEGER,
			database_name TEXT,
			username TEXT,
			password TEXT,
			file_path TEXT,
			uri TEXT DEFAULT '',
			ssl_mode TEXT DEFAULT '',
			last_used TEXT,
			created_at TEXT DEFAULT (datetime('now')),
			updated_at TEXT DEFAULT (datetime('now'))
		);
	`)
	if err != nil {
		return err
	}

	// Migration: add uri column for existing databases (ignore error if column already exists)
	s.db.Exec(`ALTER TABLE connections ADD COLUMN uri TEXT DEFAULT ''`)

	_, err = s.db.Exec(`
		CREATE TABLE IF NOT EXISTS query_history (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			connection_id TEXT NOT NULL,
			query_text TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'success',
			execution_time REAL DEFAULT 0,
			rows_affected INTEGER DEFAULT 0,
			error_message TEXT,
			created_at TEXT DEFAULT (datetime('now')),
			FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE
		);
		CREATE TABLE IF NOT EXISTS snippets (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			connection_id TEXT,
			title TEXT NOT NULL,
			query_text TEXT NOT NULL,
			tags TEXT DEFAULT '[]',
			created_at TEXT DEFAULT (datetime('now')),
			updated_at TEXT DEFAULT (datetime('now'))
		);
		CREATE TABLE IF NOT EXISTS settings (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL,
			updated_at TEXT DEFAULT (datetime('now'))
		);
		CREATE INDEX IF NOT EXISTS idx_history_conn ON query_history(connection_id);
		CREATE INDEX IF NOT EXISTS idx_history_created ON query_history(created_at DESC);
		CREATE INDEX IF NOT EXISTS idx_snippets_conn ON snippets(connection_id);
	`)
	if err != nil {
		return err
	}

	// AI Chatbox tables
	_, err = s.db.Exec(`
		CREATE TABLE IF NOT EXISTS oauth_tokens (
			id INTEGER PRIMARY KEY DEFAULT 1,
			access_token TEXT NOT NULL,
			refresh_token TEXT NOT NULL,
			expires_at TEXT NOT NULL,
			provider TEXT DEFAULT 'openai',
			updated_at TEXT DEFAULT (datetime('now')),
			UNIQUE(id)
		);
		CREATE TABLE IF NOT EXISTS chat_history (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			connection_id TEXT NOT NULL,
			role TEXT NOT NULL,
			content TEXT NOT NULL,
			model TEXT DEFAULT '',
			created_at TEXT DEFAULT (datetime('now')),
			FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE
		);
		CREATE INDEX IF NOT EXISTS idx_chat_conn ON chat_history(connection_id);
		CREATE INDEX IF NOT EXISTS idx_chat_created ON chat_history(created_at);
	`)
	return err
}

// ─── Connection CRUD ───

func (s *Store) SaveConnection(cfg driver.ConnectionConfig) error {
	// Encrypt password before storing
	encryptedPwd, err := crypto.Encrypt(cfg.Password)
	if err != nil {
		return fmt.Errorf("failed to encrypt password: %w", err)
	}

	_, err = s.db.Exec(`
		INSERT INTO connections (id, name, type, host, port, database_name, username, password, file_path, uri, ssl_mode)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			name=excluded.name, type=excluded.type, host=excluded.host, port=excluded.port,
			database_name=excluded.database_name, username=excluded.username, password=excluded.password,
			file_path=excluded.file_path, uri=excluded.uri, ssl_mode=excluded.ssl_mode, updated_at=datetime('now')`,
		cfg.ID, cfg.Name, cfg.Type, cfg.Host, cfg.Port, cfg.Database, cfg.Username, encryptedPwd, cfg.FilePath, cfg.URI, cfg.SSLMode)
	return err
}

func (s *Store) LoadConnections() ([]driver.ConnectionConfig, error) {
	rows, err := s.db.Query(`
		SELECT id, name, type, host, port, database_name, username, password, file_path, uri, ssl_mode, last_used
		FROM connections ORDER BY updated_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var conns []driver.ConnectionConfig
	for rows.Next() {
		var c driver.ConnectionConfig
		var lastUsed sql.NullString
		var filePath sql.NullString
		var uri sql.NullString
		if err := rows.Scan(&c.ID, &c.Name, &c.Type, &c.Host, &c.Port, &c.Database, &c.Username, &c.Password, &filePath, &uri, &c.SSLMode, &lastUsed); err != nil {
			return nil, err
		}
		// Decrypt password (backward-compatible with plaintext)
		if decrypted, err := crypto.Decrypt(c.Password); err == nil {
			c.Password = decrypted
		}
		if filePath.Valid {
			c.FilePath = filePath.String
		}
		if uri.Valid {
			c.URI = uri.String
		}
		if lastUsed.Valid {
			c.LastUsed = lastUsed.String
		}
		c.Status = "offline"
		conns = append(conns, c)
	}
	return conns, nil
}

func (s *Store) DeleteConnection(id string) error {
	_, err := s.db.Exec(`DELETE FROM connections WHERE id = ?`, id)
	return err
}

func (s *Store) TouchConnection(id string) error {
	_, err := s.db.Exec(`UPDATE connections SET last_used = ? WHERE id = ?`, time.Now().Format(time.RFC3339), id)
	return err
}

// ─── Query History ───

type HistoryEntry struct {
	ID            int     `json:"id"`
	ConnectionID  string  `json:"connectionId"`
	QueryText     string  `json:"queryText"`
	Status        string  `json:"status"` // success, error, mutation
	ExecutionTime float64 `json:"executionTime"`
	RowsAffected  int64   `json:"rowsAffected"`
	ErrorMessage  string  `json:"errorMessage,omitempty"`
	CreatedAt     string  `json:"createdAt"`
}

func (s *Store) AddHistory(entry HistoryEntry) error {
	_, err := s.db.Exec(`
		INSERT INTO query_history (connection_id, query_text, status, execution_time, rows_affected, error_message)
		VALUES (?, ?, ?, ?, ?, ?)`,
		entry.ConnectionID, entry.QueryText, entry.Status, entry.ExecutionTime, entry.RowsAffected, entry.ErrorMessage)
	return err
}

func (s *Store) ListHistory(connectionID string, limit int) ([]HistoryEntry, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := s.db.Query(`
		SELECT id, connection_id, query_text, status, execution_time, rows_affected, COALESCE(error_message, ''), created_at
		FROM query_history WHERE connection_id = ?
		ORDER BY created_at DESC LIMIT ?`, connectionID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var entries []HistoryEntry
	for rows.Next() {
		var e HistoryEntry
		if err := rows.Scan(&e.ID, &e.ConnectionID, &e.QueryText, &e.Status, &e.ExecutionTime, &e.RowsAffected, &e.ErrorMessage, &e.CreatedAt); err != nil {
			return nil, err
		}
		entries = append(entries, e)
	}
	return entries, nil
}

// ─── Snippets ───

type Snippet struct {
	ID           int      `json:"id"`
	ConnectionID string   `json:"connectionId"`
	Title        string   `json:"title"`
	QueryText    string   `json:"queryText"`
	Tags         []string `json:"tags"`
	CreatedAt    string   `json:"createdAt"`
}

func (s *Store) SaveSnippet(snippet Snippet) error {
	// Prevent duplicate snippets (same connection + same query text)
	var count int
	s.db.QueryRow(`SELECT COUNT(*) FROM snippets WHERE connection_id = ? AND query_text = ?`,
		snippet.ConnectionID, snippet.QueryText).Scan(&count)
	if count > 0 {
		return nil // already saved
	}

	tagsJSON, _ := json.Marshal(snippet.Tags)
	_, err := s.db.Exec(`
		INSERT INTO snippets (connection_id, title, query_text, tags)
		VALUES (?, ?, ?, ?)`,
		snippet.ConnectionID, snippet.Title, snippet.QueryText, string(tagsJSON))
	return err
}

func (s *Store) ListSnippets(connectionID string) ([]Snippet, error) {
	rows, err := s.db.Query(`
		SELECT id, COALESCE(connection_id, ''), title, query_text, tags, created_at
		FROM snippets WHERE connection_id = ? OR connection_id = ''
		ORDER BY created_at DESC`, connectionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var snippets []Snippet
	for rows.Next() {
		var sn Snippet
		var tagsStr string
		if err := rows.Scan(&sn.ID, &sn.ConnectionID, &sn.Title, &sn.QueryText, &tagsStr, &sn.CreatedAt); err != nil {
			return nil, err
		}
		json.Unmarshal([]byte(tagsStr), &sn.Tags)
		snippets = append(snippets, sn)
	}
	return snippets, nil
}

func (s *Store) DeleteSnippet(id int) error {
	_, err := s.db.Exec(`DELETE FROM snippets WHERE id = ?`, id)
	return err
}

// ─── Settings ───

func (s *Store) LoadSettings() (string, error) {
	var value string
	err := s.db.QueryRow(`SELECT value FROM settings WHERE key = 'app_settings'`).Scan(&value)
	if err != nil {
		return "{}", nil // return empty JSON if no settings saved yet
	}
	return value, nil
}

func (s *Store) SaveSettings(jsonValue string) error {
	_, err := s.db.Exec(`
		INSERT INTO settings (key, value, updated_at) VALUES ('app_settings', ?, datetime('now'))
		ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')`,
		jsonValue)
	return err
}

func (s *Store) Close() error {
	if s.db != nil {
		return s.db.Close()
	}
	return nil
}

// ─── OAuth Tokens ───

// OAuthTokens holds encrypted OAuth credentials
type OAuthTokens struct {
	AccessToken  string `json:"accessToken"`
	RefreshToken string `json:"refreshToken"`
	ExpiresAt    string `json:"expiresAt"`
	Provider     string `json:"provider"`
}

// SaveOAuthTokens encrypts and stores OAuth tokens (single row, upsert)
func (s *Store) SaveOAuthTokens(tokens OAuthTokens) error {
	encAccess, err := crypto.Encrypt(tokens.AccessToken)
	if err != nil {
		return fmt.Errorf("failed to encrypt access token: %w", err)
	}
	encRefresh, err := crypto.Encrypt(tokens.RefreshToken)
	if err != nil {
		return fmt.Errorf("failed to encrypt refresh token: %w", err)
	}

	provider := tokens.Provider
	if provider == "" {
		provider = "openai"
	}

	_, err = s.db.Exec(`
		INSERT INTO oauth_tokens (id, access_token, refresh_token, expires_at, provider, updated_at)
		VALUES (1, ?, ?, ?, ?, datetime('now'))
		ON CONFLICT(id) DO UPDATE SET
			access_token=excluded.access_token, refresh_token=excluded.refresh_token,
			expires_at=excluded.expires_at, provider=excluded.provider, updated_at=datetime('now')`,
		encAccess, encRefresh, tokens.ExpiresAt, provider)
	return err
}

// LoadOAuthTokens retrieves and decrypts stored OAuth tokens
func (s *Store) LoadOAuthTokens() (OAuthTokens, error) {
	var tokens OAuthTokens
	err := s.db.QueryRow(`
		SELECT access_token, refresh_token, expires_at, COALESCE(provider, 'openai')
		FROM oauth_tokens WHERE id = 1`).Scan(
		&tokens.AccessToken, &tokens.RefreshToken, &tokens.ExpiresAt, &tokens.Provider)
	if err != nil {
		return tokens, err
	}

	// Decrypt tokens
	if decrypted, err := crypto.Decrypt(tokens.AccessToken); err == nil {
		tokens.AccessToken = decrypted
	}
	if decrypted, err := crypto.Decrypt(tokens.RefreshToken); err == nil {
		tokens.RefreshToken = decrypted
	}

	return tokens, nil
}

// DeleteOAuthTokens removes all stored OAuth tokens
func (s *Store) DeleteOAuthTokens() error {
	_, err := s.db.Exec(`DELETE FROM oauth_tokens WHERE id = 1`)
	return err
}

// ─── Chat History ───

// ChatMessage represents a single AI chat message
type ChatMessage struct {
	ID           int    `json:"id"`
	ConnectionID string `json:"connectionId"`
	Role         string `json:"role"` // "user" | "assistant"
	Content      string `json:"content"`
	Model        string `json:"model,omitempty"`
	CreatedAt    string `json:"createdAt"`
}

// AddChatMessage saves a chat message to history
func (s *Store) AddChatMessage(msg ChatMessage) error {
	_, err := s.db.Exec(`
		INSERT INTO chat_history (connection_id, role, content, model)
		VALUES (?, ?, ?, ?)`,
		msg.ConnectionID, msg.Role, msg.Content, msg.Model)
	return err
}

// ListChatMessages retrieves chat history for a connection (ordered oldest first)
func (s *Store) ListChatMessages(connectionID string, limit int) ([]ChatMessage, error) {
	if limit <= 0 {
		limit = 100
	}
	rows, err := s.db.Query(`
		SELECT id, connection_id, role, content, COALESCE(model, ''), created_at
		FROM chat_history WHERE connection_id = ?
		ORDER BY created_at ASC LIMIT ?`, connectionID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var messages []ChatMessage
	for rows.Next() {
		var m ChatMessage
		if err := rows.Scan(&m.ID, &m.ConnectionID, &m.Role, &m.Content, &m.Model, &m.CreatedAt); err != nil {
			return nil, err
		}
		messages = append(messages, m)
	}
	return messages, nil
}

// ClearChatMessages deletes all chat history for a connection
func (s *Store) ClearChatMessages(connectionID string) error {
	_, err := s.db.Exec(`DELETE FROM chat_history WHERE connection_id = ?`, connectionID)
	return err
}

// ─── Generic Settings Helpers ───

// GetSetting retrieves a setting value by key
func (s *Store) GetSetting(key string) (string, error) {
	var value string
	err := s.db.QueryRow(`SELECT value FROM settings WHERE key = ?`, key).Scan(&value)
	if err != nil {
		return "", err
	}
	return value, nil
}

// SetSetting stores a key-value setting (upsert)
func (s *Store) SetSetting(key, value string) error {
	_, err := s.db.Exec(`
		INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
		ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')`,
		key, value)
	return err
}
