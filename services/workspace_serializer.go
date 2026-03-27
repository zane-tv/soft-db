package services

import (
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"soft-db/internal/crypto"
	"soft-db/internal/driver"
	"soft-db/internal/store"
)

var (
	ErrUnsupportedVersion = errors.New("unsupported export version")
	ErrDecryptFailed      = errors.New("decryption failed: wrong passphrase or corrupted data")
)

var validDatabaseTypes = map[driver.DatabaseType]bool{
	driver.MySQL:      true,
	driver.MariaDB:    true,
	driver.PostgreSQL: true,
	driver.SQLite:     true,
	driver.MongoDB:    true,
	driver.Redshift:   true,
}

// SerializeWorkspace converts connections, settings, and snippets into a .softdb JSON export.
// If passphrase is non-empty, connection passwords and URIs are encrypted.
// If passphrase is empty, passwords and URIs are omitted from the output.
func SerializeWorkspace(
	connections []driver.ConnectionConfig,
	settings *AppSettings,
	snippets []store.Snippet,
	passphrase string,
) ([]byte, error) {
	export := WorkspaceExport{
		Version:    1,
		ExportedAt: time.Now().Format(time.RFC3339),
		AppName:    "SoftDB",
		Settings:   settings,
	}

	for _, c := range connections {
		ce := ConnectionExport{
			Name:     c.Name,
			Type:     string(c.Type),
			Host:     c.Host,
			Port:     c.Port,
			Database: c.Database,
			Username: c.Username,
			FilePath: c.FilePath,
			SSLMode:  c.SSLMode,
		}

		if passphrase != "" {
			ce.Encrypted = true

			if c.Password != "" {
				encrypted, err := crypto.EncryptWithPassphrase(c.Password, passphrase)
				if err != nil {
					return nil, fmt.Errorf("encrypt password for %q: %w", c.Name, err)
				}
				ce.Password = encrypted
			}

			if c.URI != "" {
				encrypted, err := crypto.EncryptWithPassphrase(c.URI, passphrase)
				if err != nil {
					return nil, fmt.Errorf("encrypt URI for %q: %w", c.Name, err)
				}
				ce.URI = encrypted
			}
		}
		export.Connections = append(export.Connections, ce)
	}

	for _, s := range snippets {
		export.Snippets = append(export.Snippets, SnippetExport{
			Title:    s.Title,
			Content:  s.QueryText,
			Language: languageForSnippet(s),
			Tags:     s.Tags,
		})
	}

	data, err := json.MarshalIndent(export, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("marshal workspace export: %w", err)
	}
	return data, nil
}

// DeserializeWorkspace parses a .softdb JSON export and optionally decrypts passwords.
// If connections are marked encrypted, the passphrase is used to decrypt Password and URI fields.
func DeserializeWorkspace(data []byte, passphrase string) (*WorkspaceExport, error) {
	var export WorkspaceExport
	if err := json.Unmarshal(data, &export); err != nil {
		return nil, fmt.Errorf("parse workspace export: %w", err)
	}

	if export.Version != 1 {
		return nil, fmt.Errorf("%w: got version %d, expected 1", ErrUnsupportedVersion, export.Version)
	}

	for i := range export.Connections {
		c := &export.Connections[i]
		if !c.Encrypted {
			continue
		}

		if c.Password != "" {
			decrypted, err := crypto.DecryptWithPassphrase(c.Password, passphrase)
			if err != nil {
				return nil, fmt.Errorf("%w: connection %q password: %v", ErrDecryptFailed, c.Name, err)
			}
			c.Password = decrypted
		}

		if c.URI != "" {
			decrypted, err := crypto.DecryptWithPassphrase(c.URI, passphrase)
			if err != nil {
				return nil, fmt.Errorf("%w: connection %q URI: %v", ErrDecryptFailed, c.Name, err)
			}
			c.URI = decrypted
		}

		c.Encrypted = false
	}

	return &export, nil
}

// ValidateWorkspaceExport checks structural validity of a workspace export.
func ValidateWorkspaceExport(export *WorkspaceExport) error {
	if export.Version < 1 {
		return fmt.Errorf("invalid export version: %d", export.Version)
	}

	for i, c := range export.Connections {
		if c.Name == "" {
			return fmt.Errorf("connection[%d]: name is required", i)
		}
		if c.Type == "" {
			return fmt.Errorf("connection[%d] %q: type is required", i, c.Name)
		}
		if !validDatabaseTypes[driver.DatabaseType(c.Type)] {
			return fmt.Errorf("connection[%d] %q: unknown database type %q", i, c.Name, c.Type)
		}
	}

	return nil
}

func languageForSnippet(s store.Snippet) string {
	switch driver.DatabaseType(s.Scope) {
	case driver.MongoDB:
		return "javascript"
	default:
		return "sql"
	}
}
