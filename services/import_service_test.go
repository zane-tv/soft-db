package services

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"soft-db/internal/driver"
	"soft-db/internal/store"
)

func newTestImportService(t *testing.T) (*ImportService, *store.Store) {
	t.Helper()
	dir := t.TempDir()
	s, err := store.NewWithDir(dir)
	if err != nil {
		t.Fatalf("create test store: %v", err)
	}
	t.Cleanup(func() { s.Close() })
	settings := NewSettingsService(s)
	conn := NewConnectionService(s, settings)
	svc := NewImportService(s, conn, settings)
	return svc, s
}

func writeWorkspaceFile(t *testing.T, dir string, connections []driver.ConnectionConfig, passphrase string) string {
	t.Helper()
	data, err := SerializeWorkspace(connections, nil, nil, passphrase)
	if err != nil {
		t.Fatalf("serialize workspace: %v", err)
	}
	path := filepath.Join(dir, "export.softdb")
	if err := os.WriteFile(path, data, 0644); err != nil {
		t.Fatalf("write workspace file: %v", err)
	}
	return path
}

func TestImportService_WorkspaceSkip(t *testing.T) {
	t.Parallel()

	svc, s := newTestImportService(t)
	dir := t.TempDir()

	existing := driver.ConnectionConfig{
		ID:       "existing-id",
		Name:     "prod-pg",
		Type:     driver.PostgreSQL,
		Host:     "localhost",
		Port:     5432,
		Database: "original",
		Username: "admin",
		Password: "original-pass",
	}
	if err := s.SaveConnection(existing); err != nil {
		t.Fatalf("seed connection: %v", err)
	}

	toImport := []driver.ConnectionConfig{
		{
			Name:     "prod-pg",
			Type:     driver.PostgreSQL,
			Host:     "newhost",
			Port:     5432,
			Database: "newdb",
			Username: "admin",
			Password: "new-pass",
		},
	}
	path := writeWorkspaceFile(t, dir, toImport, "")

	result, err := svc.ImportWorkspaceFromFile(path, "", ConflictSkip)
	if err != nil {
		t.Fatalf("import: %v", err)
	}

	if result.ConnectionsSkipped != 1 {
		t.Errorf("skipped = %d, want 1", result.ConnectionsSkipped)
	}
	if result.ConnectionsImported != 0 {
		t.Errorf("imported = %d, want 0", result.ConnectionsImported)
	}

	conns, err := s.LoadConnections()
	if err != nil {
		t.Fatalf("load connections: %v", err)
	}

	var found *driver.ConnectionConfig
	for i := range conns {
		if conns[i].Name == "prod-pg" {
			found = &conns[i]
			break
		}
	}
	if found == nil {
		t.Fatal("connection not found")
	}
	if found.Database != "original" {
		t.Errorf("database = %q, want original (skip should not overwrite)", found.Database)
	}
}

func TestImportService_WorkspaceReplace(t *testing.T) {
	t.Parallel()

	svc, s := newTestImportService(t)
	dir := t.TempDir()

	existing := driver.ConnectionConfig{
		ID:       "existing-id",
		Name:     "prod-pg",
		Type:     driver.PostgreSQL,
		Host:     "localhost",
		Port:     5432,
		Database: "original",
		Username: "admin",
		Password: "original-pass",
	}
	if err := s.SaveConnection(existing); err != nil {
		t.Fatalf("seed connection: %v", err)
	}

	toImport := []driver.ConnectionConfig{
		{
			Name:     "prod-pg",
			Type:     driver.PostgreSQL,
			Host:     "newhost",
			Port:     5432,
			Database: "newdb",
			Username: "admin",
			Password: "new-pass",
		},
	}
	path := writeWorkspaceFile(t, dir, toImport, "")

	result, err := svc.ImportWorkspaceFromFile(path, "", ConflictReplace)
	if err != nil {
		t.Fatalf("import: %v", err)
	}

	if result.ConnectionsImported != 1 {
		t.Errorf("imported = %d, want 1", result.ConnectionsImported)
	}

	conns, err := s.LoadConnections()
	if err != nil {
		t.Fatalf("load connections: %v", err)
	}

	var found *driver.ConnectionConfig
	for i := range conns {
		if conns[i].Name == "prod-pg" {
			found = &conns[i]
			break
		}
	}
	if found == nil {
		t.Fatal("connection not found after replace")
	}
	if found.Database != "newdb" {
		t.Errorf("database = %q, want newdb (replace should update)", found.Database)
	}
}

func TestImportService_WorkspaceRename(t *testing.T) {
	t.Parallel()

	svc, s := newTestImportService(t)
	dir := t.TempDir()

	existing := driver.ConnectionConfig{
		ID:       "existing-id",
		Name:     "prod-pg",
		Type:     driver.PostgreSQL,
		Host:     "localhost",
		Port:     5432,
		Database: "original",
		Username: "admin",
		Password: "original-pass",
	}
	if err := s.SaveConnection(existing); err != nil {
		t.Fatalf("seed connection: %v", err)
	}

	toImport := []driver.ConnectionConfig{
		{
			Name:     "prod-pg",
			Type:     driver.PostgreSQL,
			Host:     "newhost",
			Port:     5432,
			Database: "newdb",
			Username: "admin",
			Password: "new-pass",
		},
	}
	path := writeWorkspaceFile(t, dir, toImport, "")

	result, err := svc.ImportWorkspaceFromFile(path, "", ConflictRename)
	if err != nil {
		t.Fatalf("import: %v", err)
	}

	if result.ConnectionsImported != 1 {
		t.Errorf("imported = %d, want 1", result.ConnectionsImported)
	}

	conns, err := s.LoadConnections()
	if err != nil {
		t.Fatalf("load connections: %v", err)
	}

	names := make([]string, 0, len(conns))
	for _, c := range conns {
		names = append(names, c.Name)
	}

	foundOriginal := false
	foundRenamed := false
	for _, name := range names {
		if name == "prod-pg" {
			foundOriginal = true
		}
		if strings.HasSuffix(name, "(imported)") {
			foundRenamed = true
		}
	}

	if !foundOriginal {
		t.Error("original connection should still exist")
	}
	if !foundRenamed {
		t.Errorf("renamed connection not found among: %v", names)
	}
}

func TestImportService_WorkspacePasswordReencryption(t *testing.T) {
	t.Parallel()

	svc, s := newTestImportService(t)
	dir := t.TempDir()

	passphrase := "test-pass-123"
	toImport := []driver.ConnectionConfig{
		{
			Name:     "secure-conn",
			Type:     driver.PostgreSQL,
			Host:     "dbhost",
			Port:     5432,
			Database: "mydb",
			Username: "admin",
			Password: "super-secret",
		},
	}
	path := writeWorkspaceFile(t, dir, toImport, passphrase)

	result, err := svc.ImportWorkspaceFromFile(path, passphrase, ConflictSkip)
	if err != nil {
		t.Fatalf("import: %v", err)
	}
	if result.ConnectionsImported != 1 {
		t.Fatalf("imported = %d, want 1", result.ConnectionsImported)
	}

	conns, err := s.LoadConnections()
	if err != nil {
		t.Fatalf("load connections: %v", err)
	}

	var found *driver.ConnectionConfig
	for i := range conns {
		if conns[i].Name == "secure-conn" {
			found = &conns[i]
			break
		}
	}
	if found == nil {
		t.Fatal("imported connection not found")
	}
	if found.Password != "super-secret" {
		t.Errorf("password = %q, want super-secret (should be decrypted by store.LoadConnections)", found.Password)
	}
}

func TestImportService_WrongPassphrase(t *testing.T) {
	t.Parallel()

	svc, _ := newTestImportService(t)
	dir := t.TempDir()

	toImport := []driver.ConnectionConfig{
		{
			Name:     "conn",
			Type:     driver.PostgreSQL,
			Password: "secret",
		},
	}
	path := writeWorkspaceFile(t, dir, toImport, "correct-passphrase")

	_, err := svc.ImportWorkspaceFromFile(path, "wrong-passphrase", ConflictSkip)
	if err == nil {
		t.Fatal("expected error with wrong passphrase")
	}
	if !strings.Contains(err.Error(), "wrong passphrase") && !strings.Contains(err.Error(), "decryption") {
		t.Errorf("error = %q, want mention of wrong passphrase or decryption", err)
	}
}

func TestImportService_NoConflict(t *testing.T) {
	t.Parallel()

	svc, s := newTestImportService(t)
	dir := t.TempDir()

	toImport := []driver.ConnectionConfig{
		{
			Name:     "new-conn",
			Type:     driver.PostgreSQL,
			Host:     "host",
			Port:     5432,
			Database: "db",
			Username: "user",
			Password: "pass",
		},
		{
			Name:     "another-conn",
			Type:     driver.MySQL,
			Host:     "mysqlhost",
			Port:     3306,
			Database: "mysqldb",
			Username: "root",
		},
	}
	path := writeWorkspaceFile(t, dir, toImport, "")

	result, err := svc.ImportWorkspaceFromFile(path, "", ConflictSkip)
	if err != nil {
		t.Fatalf("import: %v", err)
	}

	if result.ConnectionsImported != 2 {
		t.Errorf("imported = %d, want 2", result.ConnectionsImported)
	}
	if result.ConnectionsSkipped != 0 {
		t.Errorf("skipped = %d, want 0", result.ConnectionsSkipped)
	}

	conns, err := s.LoadConnections()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if len(conns) != 2 {
		t.Errorf("stored connections = %d, want 2", len(conns))
	}
}

func TestImportService_SnippetsImport(t *testing.T) {
	t.Parallel()

	svc, s := newTestImportService(t)
	dir := t.TempDir()

	connections := []driver.ConnectionConfig{
		{Name: "conn", Type: driver.PostgreSQL, Host: "h", Port: 5432},
	}

	data, err := SerializeWorkspace(connections, nil, []store.Snippet{
		{Title: "List users", QueryText: "SELECT * FROM users", Tags: []string{"select"}},
		{Title: "Count rows", QueryText: "SELECT COUNT(*) FROM orders"},
	}, "")
	if err != nil {
		t.Fatalf("serialize: %v", err)
	}

	path := filepath.Join(dir, "export.softdb")
	if err := os.WriteFile(path, data, 0644); err != nil {
		t.Fatalf("write: %v", err)
	}

	result, err := svc.ImportWorkspaceFromFile(path, "", ConflictSkip)
	if err != nil {
		t.Fatalf("import: %v", err)
	}

	if result.SnippetsImported != 2 {
		t.Errorf("snippets imported = %d, want 2", result.SnippetsImported)
	}

	snippets, err := s.ListSnippets("")
	if err != nil {
		t.Fatalf("load snippets: %v", err)
	}
	if len(snippets) != 2 {
		t.Errorf("stored snippets = %d, want 2", len(snippets))
	}
}

func TestImportService_SnippetsDuplicateSkipped(t *testing.T) {
	t.Parallel()

	svc, s := newTestImportService(t)
	dir := t.TempDir()

	if err := s.SaveSnippet(store.Snippet{
		Title:     "List users",
		QueryText: "SELECT * FROM users",
	}); err != nil {
		t.Fatalf("seed snippet: %v", err)
	}

	connections := []driver.ConnectionConfig{
		{Name: "conn", Type: driver.PostgreSQL, Host: "h", Port: 5432},
	}
	data, err := SerializeWorkspace(connections, nil, []store.Snippet{
		{Title: "List users", QueryText: "SELECT * FROM users"},
		{Title: "New snippet", QueryText: "SELECT 1"},
	}, "")
	if err != nil {
		t.Fatalf("serialize: %v", err)
	}

	path := filepath.Join(dir, "export.softdb")
	if err := os.WriteFile(path, data, 0644); err != nil {
		t.Fatalf("write: %v", err)
	}

	result, err := svc.ImportWorkspaceFromFile(path, "", ConflictSkip)
	if err != nil {
		t.Fatalf("import: %v", err)
	}

	if result.SnippetsImported != 1 {
		t.Errorf("snippets imported = %d, want 1 (duplicate skipped)", result.SnippetsImported)
	}
}

func TestImportService_SplitSQLStatements(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		input string
		want  int
	}{
		{
			name:  "simple statements",
			input: "SELECT 1; SELECT 2; SELECT 3",
			want:  3,
		},
		{
			name:  "semicolon in string literal",
			input: "INSERT INTO t VALUES ('a;b'); SELECT 1",
			want:  2,
		},
		{
			name:  "comment skipped",
			input: "-- this is a comment\nSELECT 1; SELECT 2",
			want:  2,
		},
		{
			name:  "empty input",
			input: "",
			want:  0,
		},
		{
			name:  "only whitespace",
			input: "   \n   ",
			want:  0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := splitSQLStatements(tt.input)
			if len(got) != tt.want {
				t.Errorf("splitSQLStatements(%q) = %d statements, want %d: %v", tt.input, len(got), tt.want, got)
			}
		})
	}
}

func sqliteInMemory(t *testing.T) *driver.SQLiteDriver {
	t.Helper()
	drv := &driver.SQLiteDriver{}
	if err := drv.Connect(context.Background(), driver.ConnectionConfig{FilePath: ":memory:"}); err != nil {
		t.Fatalf("connect sqlite in-memory: %v", err)
	}
	t.Cleanup(func() { drv.Disconnect(context.Background()) })
	return drv
}

func TestImportSQL_AllDML_CommitsSQLite(t *testing.T) {
	t.Parallel()

	drv := sqliteInMemory(t)
	ctx := context.Background()

	if _, err := drv.Execute(ctx, "CREATE TABLE tx_test (id INTEGER PRIMARY KEY, val TEXT)"); err != nil {
		t.Fatalf("create table: %v", err)
	}

	var stmts []string
	for i := 1; i <= 10; i++ {
		stmts = append(stmts, fmt.Sprintf("INSERT INTO tx_test VALUES (%d, 'v%d')", i, i))
	}
	sqlData := strings.Join(stmts, ";\n") + ";"

	svc, _ := newTestImportService(t)
	req := DatabaseImportRequest{ConnectionID: "fake"}
	if err := svc.importSQLDatabase(ctx, drv, req, []byte(sqlData)); err != nil {
		t.Fatalf("import: %v", err)
	}

	result, err := drv.Execute(ctx, "SELECT COUNT(*) FROM tx_test")
	if err != nil {
		t.Fatalf("count: %v", err)
	}
	if result.Error != "" {
		t.Fatalf("count query error: %s", result.Error)
	}
	if len(result.Rows) == 0 {
		t.Fatal("no rows returned from COUNT")
	}
	var count int64
	switch v := result.Rows[0]["COUNT(*)"].(type) {
	case int64:
		count = v
	case float64:
		count = int64(v)
	default:
		t.Fatalf("unexpected count type %T: %v", result.Rows[0]["COUNT(*)"], result.Rows[0]["COUNT(*)"])
	}
	if count != 10 {
		t.Errorf("row count = %d, want 10", count)
	}
}

func TestImportSQL_DMLFailure_RollbackSQLite(t *testing.T) {
	t.Parallel()

	drv := sqliteInMemory(t)
	ctx := context.Background()

	if _, err := drv.Execute(ctx, "CREATE TABLE tx_rollback (id INTEGER PRIMARY KEY, val TEXT)"); err != nil {
		t.Fatalf("create table: %v", err)
	}

	stmts := []string{
		"INSERT INTO tx_rollback VALUES (1, 'a')",
		"INSERT INTO tx_rollback VALUES (2, 'b')",
		"INSERT INTO tx_rollback VALUES (3, 'c')",
		"INSERT INTO tx_rollback VALUES (4, 'd')",
		"INSERT INTO tx_rollback VALUES (1, 'dup')", // duplicate PK — forces error
		"INSERT INTO tx_rollback VALUES (6, 'f')",
		"INSERT INTO tx_rollback VALUES (7, 'g')",
		"INSERT INTO tx_rollback VALUES (8, 'h')",
		"INSERT INTO tx_rollback VALUES (9, 'i')",
		"INSERT INTO tx_rollback VALUES (10, 'j')",
	}
	sqlData := strings.Join(stmts, ";\n") + ";"

	svc, _ := newTestImportService(t)
	req := DatabaseImportRequest{ConnectionID: "fake"}
	err := svc.importSQLDatabase(ctx, drv, req, []byte(sqlData))
	if err == nil {
		t.Fatal("expected error from duplicate PK insert, got nil")
	}

	result, qErr := drv.Execute(ctx, "SELECT COUNT(*) FROM tx_rollback")
	if qErr != nil {
		t.Fatalf("count after rollback: %v", qErr)
	}
	if result.Error != "" {
		t.Fatalf("count query error: %s", result.Error)
	}
	if len(result.Rows) == 0 {
		t.Fatal("no rows returned from COUNT after rollback")
	}
	var count int64
	switch v := result.Rows[0]["COUNT(*)"].(type) {
	case int64:
		count = v
	case float64:
		count = int64(v)
	default:
		t.Fatalf("unexpected count type %T", result.Rows[0]["COUNT(*)"])
	}
	if count != 0 {
		t.Errorf("row count after rollback = %d, want 0 (transaction must have been rolled back)", count)
	}
}

type mysqlFakeDriver struct {
	*driver.SQLiteDriver
}

func (m *mysqlFakeDriver) Type() driver.DatabaseType { return driver.MySQL }

func TestImportSQL_MySQLDDLNotRolledBack(t *testing.T) {
	t.Parallel()

	sqlite := sqliteInMemory(t)
	drv := &mysqlFakeDriver{SQLiteDriver: sqlite}
	ctx := context.Background()

	sqlData := strings.Join([]string{
		"CREATE TABLE mysql_test (id INTEGER PRIMARY KEY, val TEXT)",
		"INSERT INTO mysql_test VALUES (1, 'a')",
		"INSERT INTO mysql_test VALUES (2, 'b')",
		"INSERT INTO mysql_test VALUES (1, 'dup')", // forces DML tx to fail
	}, ";\n") + ";"

	svc, _ := newTestImportService(t)
	req := DatabaseImportRequest{ConnectionID: "fake"}
	err := svc.importSQLDatabase(ctx, drv, req, []byte(sqlData))
	if err == nil {
		t.Fatal("expected error from duplicate PK insert, got nil")
	}

	result, qErr := drv.Execute(ctx, "SELECT COUNT(*) FROM mysql_test")
	if qErr != nil {
		t.Fatalf("count: %v", qErr)
	}
	if result.Error != "" {
		t.Fatalf("count query error: %s", result.Error)
	}
	if len(result.Rows) == 0 {
		t.Fatal("no rows returned from COUNT")
	}

	var count int64
	switch v := result.Rows[0]["COUNT(*)"].(type) {
	case int64:
		count = v
	case float64:
		count = int64(v)
	default:
		t.Fatalf("unexpected count type %T", result.Rows[0]["COUNT(*)"])
	}
	if count != 0 {
		t.Errorf("row count = %d, want 0 (DML transaction must have been rolled back)", count)
	}
}

var _ driver.Driver = (*mysqlFakeDriver)(nil)
