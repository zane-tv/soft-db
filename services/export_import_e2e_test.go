package services

import (
	"encoding/csv"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"soft-db/internal/driver"
	"soft-db/internal/store"
)

// ─── Helpers ───

// newTestServices creates paired export/import services backed by a temp store.
func newTestServices(t *testing.T) (*ExportService, *ImportService, *store.Store) {
	t.Helper()
	dir := t.TempDir()
	s, err := store.NewWithDir(dir)
	if err != nil {
		t.Fatalf("create test store: %v", err)
	}
	t.Cleanup(func() { s.Close() })

	settings := NewSettingsService(s)
	conn := NewConnectionService(s, settings)
	exp := NewExportService(s, conn, settings)
	imp := NewImportService(s, conn, settings)
	return exp, imp, s
}

// seedConnections saves connections into the store and returns them.
func seedConnections(t *testing.T, s *store.Store, conns []driver.ConnectionConfig) {
	t.Helper()
	for _, c := range conns {
		if err := s.SaveConnection(c); err != nil {
			t.Fatalf("seed connection %q: %v", c.Name, err)
		}
	}
}

// loadConnectionByName finds a connection by name in the store.
func loadConnectionByName(t *testing.T, s *store.Store, name string) *driver.ConnectionConfig {
	t.Helper()
	conns, err := s.LoadConnections()
	if err != nil {
		t.Fatalf("load connections: %v", err)
	}
	for i := range conns {
		if conns[i].Name == name {
			return &conns[i]
		}
	}
	return nil
}

// ─── E2E Tests ───

func TestE2E_WorkspaceRoundTripWithPassphrase(t *testing.T) {
	t.Parallel()

	exportSvc, _, srcStore := newTestServices(t)
	_, importSvc, dstStore := newTestServices(t)

	// Seed source store with connections + snippets.
	conns := []driver.ConnectionConfig{
		{
			ID: "pg-1", Name: "production-pg", Type: driver.PostgreSQL,
			Host: "db.prod.example.com", Port: 5432, Database: "appdb",
			Username: "admin", Password: "s3cret!", URI: "postgresql://admin:s3cret!@db.prod.example.com:5432/appdb",
			SSLMode: "require",
		},
		{
			ID: "mysql-1", Name: "staging-mysql", Type: driver.MySQL,
			Host: "staging.mysql.local", Port: 3306, Database: "staging",
			Username: "root", Password: "mysql-pass",
		},
		{
			ID: "sqlite-1", Name: "local-sqlite", Type: driver.SQLite,
			FilePath: "/tmp/test.db",
		},
	}
	seedConnections(t, srcStore, conns)

	if err := srcStore.SaveSnippet(store.Snippet{
		Title: "List users", QueryText: "SELECT * FROM users", Tags: []string{"select", "users"},
	}); err != nil {
		t.Fatalf("save snippet: %v", err)
	}
	if err := srcStore.SaveSnippet(store.Snippet{
		Title: "Count orders", QueryText: "SELECT COUNT(*) FROM orders",
	}); err != nil {
		t.Fatalf("save snippet: %v", err)
	}

	// Export with passphrase.
	passphrase := "my-export-passphrase-2024"
	filePath := filepath.Join(t.TempDir(), "workspace.softdb")
	if err := exportSvc.ExportWorkspaceToFile(filePath, passphrase); err != nil {
		t.Fatalf("export: %v", err)
	}

	// Verify exported file exists and is non-empty JSON.
	data, err := os.ReadFile(filePath)
	if err != nil {
		t.Fatalf("read exported file: %v", err)
	}
	if len(data) == 0 {
		t.Fatal("exported file is empty")
	}

	// Verify passwords are encrypted in the file (not plaintext).
	if strings.Contains(string(data), "s3cret!") {
		t.Error("exported file contains plaintext password")
	}

	// Import into fresh store.
	result, err := importSvc.ImportWorkspaceFromFile(filePath, passphrase, ConflictSkip)
	if err != nil {
		t.Fatalf("import: %v", err)
	}

	if result.ConnectionsImported != 3 {
		t.Errorf("connections imported = %d, want 3", result.ConnectionsImported)
	}
	if result.SnippetsImported != 2 {
		t.Errorf("snippets imported = %d, want 2", result.SnippetsImported)
	}
	if result.SettingsImported != true {
		t.Error("settings should be imported")
	}

	// Verify round-tripped connections match.
	dstConns, err := dstStore.LoadConnections()
	if err != nil {
		t.Fatalf("load destination connections: %v", err)
	}
	if len(dstConns) != 3 {
		t.Fatalf("destination connections = %d, want 3", len(dstConns))
	}

	pgConn := loadConnectionByName(t, dstStore, "production-pg")
	if pgConn == nil {
		t.Fatal("production-pg not found in destination")
	}
	if pgConn.Password != "s3cret!" {
		t.Errorf("password = %q, want s3cret! (decrypted)", pgConn.Password)
	}
	if pgConn.Host != "db.prod.example.com" {
		t.Errorf("host = %q, want db.prod.example.com", pgConn.Host)
	}
	if pgConn.SSLMode != "require" {
		t.Errorf("sslMode = %q, want require", pgConn.SSLMode)
	}

	// Verify snippets.
	snippets, err := dstStore.ListSnippets("")
	if err != nil {
		t.Fatalf("list snippets: %v", err)
	}
	if len(snippets) != 2 {
		t.Errorf("snippets = %d, want 2", len(snippets))
	}
}

func TestE2E_WorkspaceRoundTripWithoutPassphrase(t *testing.T) {
	t.Parallel()

	exportSvc, _, srcStore := newTestServices(t)
	_, importSvc, dstStore := newTestServices(t)

	conns := []driver.ConnectionConfig{
		{
			ID: "pg-1", Name: "no-pass-conn", Type: driver.PostgreSQL,
			Host: "localhost", Port: 5432, Database: "testdb",
			Username: "user", Password: "my-password", URI: "postgresql://user:my-password@localhost/testdb",
		},
	}
	seedConnections(t, srcStore, conns)

	filePath := filepath.Join(t.TempDir(), "workspace.softdb")
	if err := exportSvc.ExportWorkspaceToFile(filePath, ""); err != nil {
		t.Fatalf("export: %v", err)
	}

	// Without passphrase, passwords and URIs should be omitted.
	data, err := os.ReadFile(filePath)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if strings.Contains(string(data), "my-password") {
		t.Error("plaintext password should not appear in export without passphrase")
	}

	result, err := importSvc.ImportWorkspaceFromFile(filePath, "", ConflictSkip)
	if err != nil {
		t.Fatalf("import: %v", err)
	}
	if result.ConnectionsImported != 1 {
		t.Fatalf("imported = %d, want 1", result.ConnectionsImported)
	}

	conn := loadConnectionByName(t, dstStore, "no-pass-conn")
	if conn == nil {
		t.Fatal("connection not found")
	}
	if conn.Password != "" {
		t.Errorf("password = %q, want empty (no passphrase export omits passwords)", conn.Password)
	}
	if conn.Host != "localhost" {
		t.Errorf("host = %q, want localhost", conn.Host)
	}
}

func TestE2E_DDLGenerationPerEngine(t *testing.T) {
	t.Parallel()

	columns := []driver.ColumnInfo{
		{Name: "id", Type: "INTEGER", PrimaryKey: true, Nullable: false},
		{Name: "name", Type: "VARCHAR(255)", Nullable: false},
		{Name: "email", Type: "VARCHAR(255)", Nullable: true, Unique: true},
		{Name: "age", Type: "INTEGER", Nullable: true, DefaultValue: "0"},
		{Name: "active", Type: "BOOLEAN", Nullable: false, DefaultValue: "TRUE"},
	}

	tests := []struct {
		name   string
		dbType driver.DatabaseType
		// Expected fragments in the output.
		wantFragments []string
		// Fragments that must NOT appear.
		notWantFragments []string
	}{
		{
			name:   "MySQL",
			dbType: driver.MySQL,
			wantFragments: []string{
				"CREATE TABLE IF NOT EXISTS",
				"`id`", "`name`", "`email`",
				"PRIMARY KEY",
				"NOT NULL",
				"UNIQUE",
				"ENGINE=InnoDB",
				"DEFAULT CHARSET=utf8mb4",
			},
		},
		{
			name:   "PostgreSQL",
			dbType: driver.PostgreSQL,
			wantFragments: []string{
				"CREATE TABLE IF NOT EXISTS",
				`"id"`, `"name"`, `"email"`,
				"PRIMARY KEY",
				"NOT NULL",
				"UNIQUE",
			},
			notWantFragments: []string{"ENGINE=InnoDB"},
		},
		{
			name:   "SQLite",
			dbType: driver.SQLite,
			wantFragments: []string{
				"CREATE TABLE IF NOT EXISTS",
				`"id"`, `"name"`,
				"PRIMARY KEY",
			},
			notWantFragments: []string{"ENGINE=InnoDB"},
		},
		{
			name:   "Redshift",
			dbType: driver.Redshift,
			wantFragments: []string{
				"CREATE TABLE IF NOT EXISTS",
				`"id"`, `"name"`,
				"PRIMARY KEY",
			},
			notWantFragments: []string{"ENGINE=InnoDB"},
		},
		{
			name:   "MariaDB",
			dbType: driver.MariaDB,
			wantFragments: []string{
				"`id`", "`name`",
				"ENGINE=InnoDB",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			ddl := GenerateCreateTableDDL(tt.dbType, "users", columns, true)

			if ddl == "" {
				t.Fatal("DDL is empty")
			}

			for _, frag := range tt.wantFragments {
				if !strings.Contains(ddl, frag) {
					t.Errorf("DDL missing %q\nDDL:\n%s", frag, ddl)
				}
			}
			for _, frag := range tt.notWantFragments {
				if strings.Contains(ddl, frag) {
					t.Errorf("DDL should not contain %q\nDDL:\n%s", frag, ddl)
				}
			}

			// Every DDL must end with a semicolon.
			trimmed := strings.TrimSpace(ddl)
			if !strings.HasSuffix(trimmed, ";") {
				t.Errorf("DDL does not end with semicolon:\n%s", ddl)
			}
		})
	}
}

func TestE2E_DDLMultiColumnPrimaryKey(t *testing.T) {
	t.Parallel()

	columns := []driver.ColumnInfo{
		{Name: "user_id", Type: "INTEGER", PrimaryKey: true, Nullable: false},
		{Name: "role_id", Type: "INTEGER", PrimaryKey: true, Nullable: false},
		{Name: "granted_at", Type: "TIMESTAMP", Nullable: true},
	}

	ddl := GenerateCreateTableDDL(driver.PostgreSQL, "user_roles", columns, true)

	// Multi-column PK should produce a trailing PRIMARY KEY constraint, not inline.
	if !strings.Contains(ddl, `PRIMARY KEY ("user_id", "role_id")`) {
		t.Errorf("expected composite PK constraint\nDDL:\n%s", ddl)
	}
}

func TestE2E_DataSerializerCSVRoundTrip(t *testing.T) {
	t.Parallel()

	columns := []string{"id", "name", "email", "score"}
	rows := []map[string]interface{}{
		{"id": 1, "name": "Alice", "email": "alice@example.com", "score": 95.5},
		{"id": 2, "name": "Bob", "email": nil, "score": 82},
		{"id": 3, "name": "Charlie, Jr.", "email": "charlie@example.com", "score": 77.3},
	}

	csvStr := SerializeRowsAsCSV(columns, rows, ",")

	// Parse the CSV back.
	reader := csv.NewReader(strings.NewReader(csvStr))
	records, err := reader.ReadAll()
	if err != nil {
		t.Fatalf("parse CSV: %v", err)
	}

	// Header + 3 data rows.
	if len(records) != 4 {
		t.Fatalf("records = %d, want 4 (header + 3 rows)", len(records))
	}

	// Verify header.
	for i, col := range columns {
		if records[0][i] != col {
			t.Errorf("header[%d] = %q, want %q", i, records[0][i], col)
		}
	}

	// Verify Alice row.
	if records[1][1] != "Alice" {
		t.Errorf("row[0].name = %q, want Alice", records[1][1])
	}

	// Nil → empty string in CSV.
	if records[2][2] != "" {
		t.Errorf("row[1].email = %q, want empty (nil)", records[2][2])
	}

	// Comma in value should be properly quoted.
	if records[3][1] != "Charlie, Jr." {
		t.Errorf("row[2].name = %q, want 'Charlie, Jr.'", records[3][1])
	}
}

func TestE2E_DataSerializerCSVCustomDelimiter(t *testing.T) {
	t.Parallel()

	columns := []string{"a", "b"}
	rows := []map[string]interface{}{
		{"a": "x", "b": "y"},
	}

	csvStr := SerializeRowsAsCSV(columns, rows, ";")

	// Should use semicolon, not comma.
	if !strings.Contains(csvStr, "a;b") {
		t.Errorf("header should use ; delimiter\nCSV:\n%s", csvStr)
	}
}

func TestE2E_DataSerializerJSONRoundTrip(t *testing.T) {
	t.Parallel()

	columns := []string{"id", "name", "active"}
	rows := []map[string]interface{}{
		{"id": float64(1), "name": "Alice", "active": true},
		{"id": float64(2), "name": "Bob", "active": false},
	}

	data, err := SerializeRowsAsJSON(columns, rows)
	if err != nil {
		t.Fatalf("serialize JSON: %v", err)
	}

	// Parse back.
	var parsed []map[string]interface{}
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("parse JSON: %v", err)
	}

	if len(parsed) != 2 {
		t.Fatalf("parsed rows = %d, want 2", len(parsed))
	}

	if parsed[0]["name"] != "Alice" {
		t.Errorf("row[0].name = %v, want Alice", parsed[0]["name"])
	}
	if parsed[1]["active"] != false {
		t.Errorf("row[1].active = %v, want false", parsed[1]["active"])
	}
}

func TestE2E_DataSerializerSQLInsert(t *testing.T) {
	t.Parallel()

	columns := []string{"id", "name", "bio", "score"}
	rows := []map[string]interface{}{
		{"id": 1, "name": "Alice", "bio": nil, "score": 99.5},
		{"id": 2, "name": "O'Brien", "bio": "has a quote", "score": 42},
	}

	tests := []struct {
		name   string
		dbType driver.DatabaseType
		want   []string
	}{
		{
			name:   "PostgreSQL",
			dbType: driver.PostgreSQL,
			want: []string{
				`INSERT INTO "users"`,
				"NULL",
				"'Alice'",
				"'O''Brien'",
				"99.5",
			},
		},
		{
			name:   "MySQL",
			dbType: driver.MySQL,
			want: []string{
				"INSERT INTO `users`",
				"NULL",
				"'Alice'",
				"'O''Brien'",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			sql := SerializeRowsAsSQL(tt.dbType, "users", columns, rows, 0)

			for _, frag := range tt.want {
				if !strings.Contains(sql, frag) {
					t.Errorf("SQL missing %q\nSQL:\n%s", frag, sql)
				}
			}

			// Must end with semicolon.
			trimmed := strings.TrimSpace(sql)
			if !strings.HasSuffix(trimmed, ";") {
				t.Errorf("SQL does not end with semicolon:\n%s", sql)
			}
		})
	}
}

func TestE2E_DataSerializerSQLBooleans(t *testing.T) {
	t.Parallel()

	columns := []string{"id", "active"}
	rows := []map[string]interface{}{
		{"id": 1, "active": true},
		{"id": 2, "active": false},
	}

	// PostgreSQL uses TRUE/FALSE.
	pgSQL := SerializeRowsAsSQL(driver.PostgreSQL, "flags", columns, rows, 0)
	if !strings.Contains(pgSQL, "TRUE") || !strings.Contains(pgSQL, "FALSE") {
		t.Errorf("PostgreSQL should use TRUE/FALSE\nSQL:\n%s", pgSQL)
	}

	// MySQL uses 1/0.
	mySQL := SerializeRowsAsSQL(driver.MySQL, "flags", columns, rows, 0)
	if strings.Contains(mySQL, "TRUE") || strings.Contains(mySQL, "FALSE") {
		t.Errorf("MySQL should use 1/0 not TRUE/FALSE\nSQL:\n%s", mySQL)
	}
}

func TestE2E_DataSerializerEmptyRows(t *testing.T) {
	t.Parallel()

	// SQL: empty rows → empty string.
	sql := SerializeRowsAsSQL(driver.PostgreSQL, "t", []string{"a"}, nil, 0)
	if sql != "" {
		t.Errorf("empty rows SQL = %q, want empty", sql)
	}

	// JSON: empty rows → valid JSON.
	data, err := SerializeRowsAsJSON([]string{"a"}, nil)
	if err != nil {
		t.Fatalf("serialize empty JSON: %v", err)
	}
	var parsed []map[string]interface{}
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("parse empty JSON: %v", err)
	}
	if len(parsed) != 0 {
		t.Errorf("empty JSON parsed = %d rows, want 0", len(parsed))
	}
}

func TestE2E_ConflictSkip(t *testing.T) {
	t.Parallel()

	_, importSvc, s := newTestServices(t)

	// Seed existing connection.
	seedConnections(t, s, []driver.ConnectionConfig{
		{ID: "existing-1", Name: "shared-conn", Type: driver.PostgreSQL, Host: "original-host", Port: 5432, Database: "origdb"},
	})

	// Prepare export file with same-named connection but different data.
	toImport := []driver.ConnectionConfig{
		{Name: "shared-conn", Type: driver.PostgreSQL, Host: "new-host", Port: 5432, Database: "newdb"},
	}
	data, err := SerializeWorkspace(toImport, nil, nil, "")
	if err != nil {
		t.Fatalf("serialize: %v", err)
	}
	filePath := filepath.Join(t.TempDir(), "skip.softdb")
	if err := os.WriteFile(filePath, data, 0644); err != nil {
		t.Fatalf("write: %v", err)
	}

	result, err := importSvc.ImportWorkspaceFromFile(filePath, "", ConflictSkip)
	if err != nil {
		t.Fatalf("import: %v", err)
	}

	if result.ConnectionsSkipped != 1 {
		t.Errorf("skipped = %d, want 1", result.ConnectionsSkipped)
	}
	if result.ConnectionsImported != 0 {
		t.Errorf("imported = %d, want 0", result.ConnectionsImported)
	}

	conn := loadConnectionByName(t, s, "shared-conn")
	if conn == nil {
		t.Fatal("connection not found")
	}
	if conn.Host != "original-host" {
		t.Errorf("host = %q, want original-host (skip should preserve original)", conn.Host)
	}
}

func TestE2E_ConflictReplace(t *testing.T) {
	t.Parallel()

	_, importSvc, s := newTestServices(t)

	seedConnections(t, s, []driver.ConnectionConfig{
		{ID: "existing-1", Name: "shared-conn", Type: driver.PostgreSQL, Host: "original-host", Port: 5432, Database: "origdb"},
	})

	toImport := []driver.ConnectionConfig{
		{Name: "shared-conn", Type: driver.PostgreSQL, Host: "replaced-host", Port: 5432, Database: "replaced-db"},
	}
	data, err := SerializeWorkspace(toImport, nil, nil, "")
	if err != nil {
		t.Fatalf("serialize: %v", err)
	}
	filePath := filepath.Join(t.TempDir(), "replace.softdb")
	if err := os.WriteFile(filePath, data, 0644); err != nil {
		t.Fatalf("write: %v", err)
	}

	result, err := importSvc.ImportWorkspaceFromFile(filePath, "", ConflictReplace)
	if err != nil {
		t.Fatalf("import: %v", err)
	}

	if result.ConnectionsImported != 1 {
		t.Errorf("imported = %d, want 1", result.ConnectionsImported)
	}

	conn := loadConnectionByName(t, s, "shared-conn")
	if conn == nil {
		t.Fatal("connection not found after replace")
	}
	if conn.Host != "replaced-host" {
		t.Errorf("host = %q, want replaced-host", conn.Host)
	}
	if conn.Database != "replaced-db" {
		t.Errorf("database = %q, want replaced-db", conn.Database)
	}
}

func TestE2E_ConflictRename(t *testing.T) {
	t.Parallel()

	_, importSvc, s := newTestServices(t)

	seedConnections(t, s, []driver.ConnectionConfig{
		{ID: "existing-1", Name: "shared-conn", Type: driver.PostgreSQL, Host: "original-host", Port: 5432, Database: "origdb"},
	})

	toImport := []driver.ConnectionConfig{
		{Name: "shared-conn", Type: driver.PostgreSQL, Host: "renamed-host", Port: 5432, Database: "renamed-db"},
	}
	data, err := SerializeWorkspace(toImport, nil, nil, "")
	if err != nil {
		t.Fatalf("serialize: %v", err)
	}
	filePath := filepath.Join(t.TempDir(), "rename.softdb")
	if err := os.WriteFile(filePath, data, 0644); err != nil {
		t.Fatalf("write: %v", err)
	}

	result, err := importSvc.ImportWorkspaceFromFile(filePath, "", ConflictRename)
	if err != nil {
		t.Fatalf("import: %v", err)
	}

	if result.ConnectionsImported != 1 {
		t.Errorf("imported = %d, want 1", result.ConnectionsImported)
	}

	// Original should still exist.
	original := loadConnectionByName(t, s, "shared-conn")
	if original == nil {
		t.Fatal("original connection should still exist")
	}
	if original.Host != "original-host" {
		t.Errorf("original host = %q, want original-host", original.Host)
	}

	// Renamed connection should exist.
	renamed := loadConnectionByName(t, s, "shared-conn (imported)")
	if renamed == nil {
		conns, _ := s.LoadConnections()
		names := make([]string, len(conns))
		for i, c := range conns {
			names[i] = c.Name
		}
		t.Fatalf("renamed connection not found; have: %v", names)
	}
	if renamed.Host != "renamed-host" {
		t.Errorf("renamed host = %q, want renamed-host", renamed.Host)
	}
}

func TestE2E_EmptyExport(t *testing.T) {
	t.Parallel()

	exportSvc, _, _ := newTestServices(t)
	_, importSvc, dstStore := newTestServices(t)

	// Export empty workspace (no connections, no snippets).
	filePath := filepath.Join(t.TempDir(), "empty.softdb")
	if err := exportSvc.ExportWorkspaceToFile(filePath, ""); err != nil {
		t.Fatalf("export empty workspace: %v", err)
	}

	// Verify file is valid JSON.
	data, err := os.ReadFile(filePath)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	var export WorkspaceExport
	if err := json.Unmarshal(data, &export); err != nil {
		t.Fatalf("parse exported JSON: %v", err)
	}
	if export.Version != 1 {
		t.Errorf("version = %d, want 1", export.Version)
	}
	if export.AppName != "SoftDB" {
		t.Errorf("appName = %q, want SoftDB", export.AppName)
	}

	// Import into fresh store → should succeed with zero imports.
	result, err := importSvc.ImportWorkspaceFromFile(filePath, "", ConflictSkip)
	if err != nil {
		t.Fatalf("import empty: %v", err)
	}
	if result.ConnectionsImported != 0 {
		t.Errorf("imported = %d, want 0", result.ConnectionsImported)
	}

	conns, err := dstStore.LoadConnections()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if len(conns) != 0 {
		t.Errorf("connections = %d, want 0", len(conns))
	}
}

func TestE2E_SpecialCharactersInConnectionNames(t *testing.T) {
	t.Parallel()

	exportSvc, _, srcStore := newTestServices(t)
	_, importSvc, dstStore := newTestServices(t)

	// Use connection names with unicode, spaces, special chars.
	conns := []driver.ConnectionConfig{
		{ID: "u1", Name: "Ünïcödé-DB 🚀", Type: driver.PostgreSQL, Host: "h1", Port: 5432, Database: "db1"},
		{ID: "u2", Name: "日本語テスト", Type: driver.MySQL, Host: "h2", Port: 3306, Database: "db2"},
		{ID: "u3", Name: `conn with "quotes" & <angle>`, Type: driver.SQLite, FilePath: "/tmp/test.db"},
		{ID: "u4", Name: "conn/with/slashes", Type: driver.PostgreSQL, Host: "h3", Port: 5432},
	}
	seedConnections(t, srcStore, conns)

	passphrase := "unicode-pass-日本語"
	filePath := filepath.Join(t.TempDir(), "special.softdb")
	if err := exportSvc.ExportWorkspaceToFile(filePath, passphrase); err != nil {
		t.Fatalf("export: %v", err)
	}

	result, err := importSvc.ImportWorkspaceFromFile(filePath, passphrase, ConflictSkip)
	if err != nil {
		t.Fatalf("import: %v", err)
	}
	if result.ConnectionsImported != 4 {
		t.Errorf("imported = %d, want 4", result.ConnectionsImported)
	}

	// Verify each name round-tripped.
	for _, c := range conns {
		found := loadConnectionByName(t, dstStore, c.Name)
		if found == nil {
			t.Errorf("connection %q not found after import", c.Name)
		}
	}
}

func TestE2E_DDLDropTable(t *testing.T) {
	t.Parallel()

	tests := []struct {
		dbType driver.DatabaseType
		want   string
	}{
		{driver.PostgreSQL, `DROP TABLE IF EXISTS "users";`},
		{driver.MySQL, "DROP TABLE IF EXISTS `users`;"},
	}

	for _, tt := range tests {
		t.Run(string(tt.dbType), func(t *testing.T) {
			t.Parallel()
			got := GenerateDropTableDDL(tt.dbType, "users")
			if got != tt.want {
				t.Errorf("got %q, want %q", got, tt.want)
			}
		})
	}
}

func TestE2E_WorkspaceValidation(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		export  *WorkspaceExport
		wantErr bool
	}{
		{
			name: "valid export",
			export: &WorkspaceExport{
				Version: 1,
				Connections: []ConnectionExport{
					{Name: "conn", Type: "postgresql"},
				},
			},
			wantErr: false,
		},
		{
			name: "invalid version",
			export: &WorkspaceExport{
				Version: 0,
			},
			wantErr: true,
		},
		{
			name: "missing connection name",
			export: &WorkspaceExport{
				Version: 1,
				Connections: []ConnectionExport{
					{Name: "", Type: "postgresql"},
				},
			},
			wantErr: true,
		},
		{
			name: "unknown database type",
			export: &WorkspaceExport{
				Version: 1,
				Connections: []ConnectionExport{
					{Name: "conn", Type: "oracle"},
				},
			},
			wantErr: true,
		},
		{
			name: "missing connection type",
			export: &WorkspaceExport{
				Version: 1,
				Connections: []ConnectionExport{
					{Name: "conn", Type: ""},
				},
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			err := ValidateWorkspaceExport(tt.export)
			if (err != nil) != tt.wantErr {
				t.Errorf("ValidateWorkspaceExport() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestE2E_SerializeDeserializeSymmetry(t *testing.T) {
	t.Parallel()

	// Verify that SerializeWorkspace → DeserializeWorkspace preserves data exactly.
	connections := []driver.ConnectionConfig{
		{
			Name: "test-conn", Type: driver.PostgreSQL,
			Host: "host.example.com", Port: 5432, Database: "mydb",
			Username: "user", Password: "p@ssw0rd!",
			SSLMode: "verify-full",
		},
	}
	settings := DefaultSettings()
	settings.Theme = "dark"
	settings.FontSize = 14

	snippets := []store.Snippet{
		{Title: "snippet-1", QueryText: "SELECT 1", Tags: []string{"test", "select"}},
	}

	passphrase := "round-trip-test"
	data, err := SerializeWorkspace(connections, &settings, snippets, passphrase)
	if err != nil {
		t.Fatalf("serialize: %v", err)
	}

	export, err := DeserializeWorkspace(data, passphrase)
	if err != nil {
		t.Fatalf("deserialize: %v", err)
	}

	if export.Version != 1 {
		t.Errorf("version = %d, want 1", export.Version)
	}
	if len(export.Connections) != 1 {
		t.Fatalf("connections = %d, want 1", len(export.Connections))
	}

	c := export.Connections[0]
	if c.Name != "test-conn" {
		t.Errorf("name = %q, want test-conn", c.Name)
	}
	if c.Password != "p@ssw0rd!" {
		t.Errorf("password = %q, want p@ssw0rd! (decrypted)", c.Password)
	}
	if c.Encrypted {
		t.Error("encrypted should be false after deserialization")
	}

	if export.Settings == nil {
		t.Fatal("settings is nil")
	}
	if export.Settings.Theme != "dark" {
		t.Errorf("theme = %q, want dark", export.Settings.Theme)
	}

	if len(export.Snippets) != 1 {
		t.Fatalf("snippets = %d, want 1", len(export.Snippets))
	}
	if export.Snippets[0].Title != "snippet-1" {
		t.Errorf("snippet title = %q, want snippet-1", export.Snippets[0].Title)
	}
}

func TestE2E_WrongPassphraseReturnsError(t *testing.T) {
	t.Parallel()

	connections := []driver.ConnectionConfig{
		{Name: "conn", Type: driver.PostgreSQL, Password: "secret"},
	}

	data, err := SerializeWorkspace(connections, nil, nil, "correct-pass")
	if err != nil {
		t.Fatalf("serialize: %v", err)
	}

	_, err = DeserializeWorkspace(data, "wrong-pass")
	if err == nil {
		t.Fatal("expected error with wrong passphrase")
	}
	if !strings.Contains(err.Error(), "decryption") && !strings.Contains(err.Error(), "wrong passphrase") {
		t.Errorf("error = %q, want mention of decryption failure", err)
	}
}

func TestE2E_UnsupportedVersionReturnsError(t *testing.T) {
	t.Parallel()

	raw := `{"version": 99, "appName": "SoftDB", "connections": []}`
	_, err := DeserializeWorkspace([]byte(raw), "")
	if err == nil {
		t.Fatal("expected error for unsupported version")
	}
	if !strings.Contains(err.Error(), "unsupported") {
		t.Errorf("error = %q, want mention of unsupported", err)
	}
}
