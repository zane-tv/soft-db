package services

import (
	"encoding/json"
	"strings"
	"testing"

	"soft-db/internal/driver"
	"soft-db/internal/store"
)

func TestWorkspaceSerialize_RoundTripWithPassphrase(t *testing.T) {
	t.Parallel()

	connections := []driver.ConnectionConfig{
		{
			Name:     "prod-pg",
			Type:     driver.PostgreSQL,
			Host:     "localhost",
			Port:     5432,
			Database: "mydb",
			Username: "admin",
			Password: "s3cret!",
		},
	}
	snippets := []store.Snippet{
		{Title: "Select all", QueryText: "SELECT * FROM users", Tags: []string{"quick"}},
	}

	passphrase := "test-passphrase-123"
	data, err := SerializeWorkspace(connections, nil, snippets, passphrase)
	if err != nil {
		t.Fatalf("serialize: %v", err)
	}

	if strings.Contains(string(data), "s3cret!") {
		t.Fatal("plaintext password found in encrypted output")
	}

	result, err := DeserializeWorkspace(data, passphrase)
	if err != nil {
		t.Fatalf("deserialize: %v", err)
	}

	if len(result.Connections) != 1 {
		t.Fatalf("expected 1 connection, got %d", len(result.Connections))
	}
	if result.Connections[0].Password != "s3cret!" {
		t.Errorf("password = %q, want %q", result.Connections[0].Password, "s3cret!")
	}
	if result.Connections[0].Encrypted {
		t.Error("expected Encrypted = false after decryption")
	}

	if len(result.Snippets) != 1 {
		t.Fatalf("expected 1 snippet, got %d", len(result.Snippets))
	}
	if result.Snippets[0].Content != "SELECT * FROM users" {
		t.Errorf("snippet content = %q, want query text", result.Snippets[0].Content)
	}
}

func TestWorkspaceSerialize_RoundTripWithoutPassphrase(t *testing.T) {
	t.Parallel()

	connections := []driver.ConnectionConfig{
		{
			Name:     "dev-pg",
			Type:     driver.PostgreSQL,
			Host:     "localhost",
			Port:     5432,
			Password: "secret",
		},
	}

	data, err := SerializeWorkspace(connections, nil, nil, "")
	if err != nil {
		t.Fatalf("serialize: %v", err)
	}

	if strings.Contains(string(data), "secret") {
		t.Fatal("password should be omitted when no passphrase")
	}

	result, err := DeserializeWorkspace(data, "")
	if err != nil {
		t.Fatalf("deserialize: %v", err)
	}

	if result.Connections[0].Password != "" {
		t.Errorf("password = %q, want empty", result.Connections[0].Password)
	}
	if result.Connections[0].Encrypted {
		t.Error("expected Encrypted = false without passphrase")
	}
}

func TestWorkspaceDeserialize_WrongPassphrase(t *testing.T) {
	t.Parallel()

	connections := []driver.ConnectionConfig{
		{
			Name:     "prod",
			Type:     driver.PostgreSQL,
			Password: "correct-password",
		},
	}

	data, err := SerializeWorkspace(connections, nil, nil, "passphrase-A")
	if err != nil {
		t.Fatalf("serialize: %v", err)
	}

	_, err = DeserializeWorkspace(data, "passphrase-B")
	if err == nil {
		t.Fatal("expected error with wrong passphrase")
	}
	if !strings.Contains(err.Error(), "wrong passphrase") {
		t.Errorf("error = %q, want mention of wrong passphrase", err)
	}
}

func TestWorkspaceDeserialize_InvalidJSON(t *testing.T) {
	t.Parallel()

	_, err := DeserializeWorkspace([]byte("not valid json{{{"), "")
	if err == nil {
		t.Fatal("expected error for invalid JSON")
	}
	if !strings.Contains(err.Error(), "parse") {
		t.Errorf("error = %q, want parse error", err)
	}
}

func TestWorkspaceDeserialize_VersionMismatch(t *testing.T) {
	t.Parallel()

	export := WorkspaceExport{
		Version:    99,
		ExportedAt: "2025-01-01T00:00:00Z",
		AppName:    "SoftDB",
	}
	data, err := json.Marshal(export)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	_, err = DeserializeWorkspace(data, "")
	if err == nil {
		t.Fatal("expected error for unsupported version")
	}
	if !strings.Contains(err.Error(), "unsupported export version") {
		t.Errorf("error = %q, want version error", err)
	}
}

func TestWorkspaceSerialize_MongoDBURIEncryption(t *testing.T) {
	t.Parallel()

	connections := []driver.ConnectionConfig{
		{
			Name: "mongo-prod",
			Type: driver.MongoDB,
			URI:  "mongodb://admin:p%40ss@cluster0.example.net:27017/mydb?authSource=admin",
		},
	}

	passphrase := "mongo-secret"
	data, err := SerializeWorkspace(connections, nil, nil, passphrase)
	if err != nil {
		t.Fatalf("serialize: %v", err)
	}

	if strings.Contains(string(data), "mongodb://") {
		t.Fatal("plaintext URI found in encrypted output")
	}

	result, err := DeserializeWorkspace(data, passphrase)
	if err != nil {
		t.Fatalf("deserialize: %v", err)
	}

	want := "mongodb://admin:p%40ss@cluster0.example.net:27017/mydb?authSource=admin"
	if result.Connections[0].URI != want {
		t.Errorf("URI = %q, want %q", result.Connections[0].URI, want)
	}
}

func TestWorkspaceValidate_InvalidConnections(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		export  WorkspaceExport
		wantErr string
	}{
		{
			name:    "zero version",
			export:  WorkspaceExport{Version: 0},
			wantErr: "invalid export version",
		},
		{
			name: "missing connection name",
			export: WorkspaceExport{
				Version:     1,
				Connections: []ConnectionExport{{Type: "postgresql"}},
			},
			wantErr: "name is required",
		},
		{
			name: "missing connection type",
			export: WorkspaceExport{
				Version:     1,
				Connections: []ConnectionExport{{Name: "test"}},
			},
			wantErr: "type is required",
		},
		{
			name: "unknown database type",
			export: WorkspaceExport{
				Version:     1,
				Connections: []ConnectionExport{{Name: "test", Type: "oracle"}},
			},
			wantErr: "unknown database type",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			err := ValidateWorkspaceExport(&tt.export)
			if err == nil {
				t.Fatal("expected validation error")
			}
			if !strings.Contains(err.Error(), tt.wantErr) {
				t.Errorf("error = %q, want to contain %q", err, tt.wantErr)
			}
		})
	}
}

func TestWorkspaceValidate_ValidExport(t *testing.T) {
	t.Parallel()

	export := WorkspaceExport{
		Version: 1,
		Connections: []ConnectionExport{
			{Name: "pg", Type: "postgresql"},
			{Name: "mongo", Type: "mongodb"},
		},
	}

	if err := ValidateWorkspaceExport(&export); err != nil {
		t.Errorf("unexpected validation error: %v", err)
	}
}
