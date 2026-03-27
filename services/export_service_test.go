package services

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"soft-db/internal/store"
)

func TestExportService_WorkspaceRoundTrip(t *testing.T) {
	t.Parallel()

	s := newTestStore(t)
	settings := NewSettingsService(s)
	conn := NewConnectionService(s, settings)
	svc := NewExportService(s, conn, settings)

	dir := t.TempDir()
	filePath := filepath.Join(dir, "workspace.softdb")

	if err := svc.ExportWorkspaceToFile(filePath, ""); err != nil {
		t.Fatalf("ExportWorkspaceToFile: %v", err)
	}

	data, err := os.ReadFile(filePath)
	if err != nil {
		t.Fatalf("read exported file: %v", err)
	}

	var export WorkspaceExport
	if err := json.Unmarshal(data, &export); err != nil {
		t.Fatalf("unmarshal exported JSON: %v", err)
	}

	if export.Version != 1 {
		t.Errorf("version = %d, want 1", export.Version)
	}
	if export.AppName != "SoftDB" {
		t.Errorf("appName = %q, want SoftDB", export.AppName)
	}
	if export.ExportedAt == "" {
		t.Error("exportedAt is empty")
	}
}

func TestExportService_WorkspaceRoundTrip_WithPassphrase(t *testing.T) {
	t.Parallel()

	s := newTestStore(t)
	settings := NewSettingsService(s)
	conn := NewConnectionService(s, settings)
	svc := NewExportService(s, conn, settings)

	dir := t.TempDir()
	filePath := filepath.Join(dir, "workspace.softdb")

	if err := svc.ExportWorkspaceToFile(filePath, "passphrase123"); err != nil {
		t.Fatalf("ExportWorkspaceToFile: %v", err)
	}

	data, err := os.ReadFile(filePath)
	if err != nil {
		t.Fatalf("read exported file: %v", err)
	}

	var export WorkspaceExport
	if err := json.Unmarshal(data, &export); err != nil {
		t.Fatalf("unmarshal exported JSON: %v", err)
	}

	if export.Version != 1 {
		t.Errorf("version = %d, want 1", export.Version)
	}
}

func TestExportService_WorkspaceRoundTrip_WithSnippets(t *testing.T) {
	t.Parallel()

	s := newTestStore(t)

	if err := s.SaveSnippet(store.Snippet{
		Title:     "Select all users",
		QueryText: "SELECT * FROM users",
		Scope:     "all",
	}); err != nil {
		t.Fatalf("save snippet: %v", err)
	}

	settings := NewSettingsService(s)
	conn := NewConnectionService(s, settings)
	svc := NewExportService(s, conn, settings)

	dir := t.TempDir()
	filePath := filepath.Join(dir, "workspace.softdb")

	if err := svc.ExportWorkspaceToFile(filePath, ""); err != nil {
		t.Fatalf("ExportWorkspaceToFile: %v", err)
	}

	data, err := os.ReadFile(filePath)
	if err != nil {
		t.Fatalf("read exported file: %v", err)
	}

	var export WorkspaceExport
	if err := json.Unmarshal(data, &export); err != nil {
		t.Fatalf("unmarshal exported JSON: %v", err)
	}

	if len(export.Snippets) != 1 {
		t.Fatalf("expected 1 snippet, got %d", len(export.Snippets))
	}
	if export.Snippets[0].Content != "SELECT * FROM users" {
		t.Errorf("snippet content = %q, want SELECT * FROM users", export.Snippets[0].Content)
	}
}

func TestExportService_Cancel(t *testing.T) {
	t.Parallel()

	s := newTestStore(t)
	settings := NewSettingsService(s)
	conn := NewConnectionService(s, settings)
	svc := NewExportService(s, conn, settings)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	var cancelCalled bool
	svc.cancelFn = func() {
		cancelCalled = true
	}

	svc.CancelExport()

	if !cancelCalled {
		t.Error("cancelFn was not called")
	}

	_ = ctx
}

func TestExportService_ExportDatabase_NoActiveConnection(t *testing.T) {
	t.Parallel()

	s := newTestStore(t)
	settings := NewSettingsService(s)
	conn := NewConnectionService(s, settings)
	svc := NewExportService(s, conn, settings)

	dir := t.TempDir()

	req := DatabaseExportRequest{
		ConnectionID:  "nonexistent-id",
		IncludeSchema: true,
		FilePath:      filepath.Join(dir, "out.sql"),
	}

	err := svc.ExportDatabase(req)
	if err == nil {
		t.Fatal("expected error for non-active connection, got nil")
	}

	if _, statErr := os.Stat(req.FilePath); !os.IsNotExist(statErr) {
		t.Error("partial file was not cleaned up on error")
	}
}

func TestExportService_ExportDatabase_ConcurrentBlocked(t *testing.T) {
	t.Parallel()

	s := newTestStore(t)
	settings := NewSettingsService(s)
	conn := NewConnectionService(s, settings)
	svc := NewExportService(s, conn, settings)

	svc.mu.Lock()

	var wg sync.WaitGroup
	wg.Add(1)

	var concurrentErr error
	go func() {
		defer wg.Done()
		concurrentErr = svc.ExportDatabase(DatabaseExportRequest{
			ConnectionID: "any",
			FilePath:     filepath.Join(t.TempDir(), "out.sql"),
		})
	}()

	wg.Wait()
	svc.mu.Unlock()

	if concurrentErr == nil {
		t.Fatal("expected error when export already in progress")
	}
}

func newTestStore(t *testing.T) *store.Store {
	t.Helper()

	dir := t.TempDir()
	dbPath := filepath.Join(dir, "test.sqlite")

	_ = os.Setenv("SOFTDB_DATA_DIR", dir)
	_ = dbPath

	s, err := store.NewWithDir(dir)
	if err != nil {
		t.Fatalf("create test store: %v", err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}
