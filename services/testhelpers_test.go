package services

import (
	"context"
	"database/sql"
	"testing"

	"soft-db/internal/driver"

	_ "modernc.org/sqlite"
)

// ─── mockDriver ───────────────────────────────────────────────────────────────
// Implements driver.Driver. Does NOT implement TransactionalDriver.

type mockDriver struct {
	dbType          driver.DatabaseType
	isConnected     bool
	executeFunc     func(ctx context.Context, query string) (*driver.QueryResult, error)
	executeArgsFunc func(ctx context.Context, query string, args ...interface{}) (*driver.QueryResult, error)
	columnsFunc     func(ctx context.Context, table string) ([]driver.ColumnInfo, error)
	tablesFunc      func(ctx context.Context) ([]driver.TableInfo, error)
	pingErr         error
	disconnectErr   error
}

func (m *mockDriver) Connect(_ context.Context, _ driver.ConnectionConfig) error {
	m.isConnected = true
	return nil
}
func (m *mockDriver) Disconnect(_ context.Context) error {
	m.isConnected = false
	return m.disconnectErr
}
func (m *mockDriver) Ping(_ context.Context) error { return m.pingErr }
func (m *mockDriver) Execute(ctx context.Context, query string) (*driver.QueryResult, error) {
	if m.executeFunc != nil {
		return m.executeFunc(ctx, query)
	}
	return &driver.QueryResult{}, nil
}
func (m *mockDriver) ExecuteArgs(ctx context.Context, query string, args ...interface{}) (*driver.QueryResult, error) {
	if m.executeArgsFunc != nil {
		return m.executeArgsFunc(ctx, query, args...)
	}
	return &driver.QueryResult{AffectedRows: 1}, nil
}
func (m *mockDriver) Tables(ctx context.Context) ([]driver.TableInfo, error) {
	if m.tablesFunc != nil {
		return m.tablesFunc(ctx)
	}
	return []driver.TableInfo{}, nil
}
func (m *mockDriver) Columns(ctx context.Context, table string) ([]driver.ColumnInfo, error) {
	if m.columnsFunc != nil {
		return m.columnsFunc(ctx, table)
	}
	return []driver.ColumnInfo{}, nil
}
func (m *mockDriver) Views(_ context.Context) ([]string, error) { return []string{}, nil }
func (m *mockDriver) Functions(_ context.Context) ([]driver.FunctionInfo, error) {
	return []driver.FunctionInfo{}, nil
}
func (m *mockDriver) Type() driver.DatabaseType { return m.dbType }
func (m *mockDriver) IsConnected() bool         { return m.isConnected }

// ─── mockIndexForeignKeyDriver ────────────────────────────────────────────────
// Extends mockDriver with IndexIntrospector + ForeignKeyIntrospector.

type mockIndexForeignKeyDriver struct {
	mockDriver
	indexes     []driver.IndexInfo
	foreignKeys []driver.ForeignKeyInfo
	indexErr    error
	fkErr       error
}

func (m *mockIndexForeignKeyDriver) GetIndexes(_, _ string) ([]driver.IndexInfo, error) {
	return m.indexes, m.indexErr
}
func (m *mockIndexForeignKeyDriver) GetForeignKeys(_, _ string) ([]driver.ForeignKeyInfo, error) {
	return m.foreignKeys, m.fkErr
}

// ─── mockMultiDBDriver ────────────────────────────────────────────────────────
// Extends mockDriver with MultiDatabaseDriver.

type mockMultiDBDriver struct {
	mockDriver
	databases []driver.DatabaseInfo
}

func (m *mockMultiDBDriver) Databases(_ context.Context) ([]driver.DatabaseInfo, error) {
	return m.databases, nil
}
func (m *mockMultiDBDriver) TablesInDB(_ context.Context, _ string) ([]driver.TableInfo, error) {
	return []driver.TableInfo{}, nil
}
func (m *mockMultiDBDriver) ColumnsInDB(ctx context.Context, _ string, table string) ([]driver.ColumnInfo, error) {
	if m.mockDriver.columnsFunc != nil {
		return m.mockDriver.columnsFunc(ctx, table)
	}
	return []driver.ColumnInfo{}, nil
}
func (m *mockMultiDBDriver) SwitchDatabase(_ context.Context, _ string) error { return nil }

// ─── transactionalMockDriver ──────────────────────────────────────────────────
// Wraps an in-memory SQLite db so we can test the transactional BatchUpdateCells path.

type transactionalMockDriver struct {
	mockDriver
	db *sql.DB
}

func newSQLiteTransactionalMock(t *testing.T) *transactionalMockDriver {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	if _, err = db.Exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)`); err != nil {
		t.Fatalf("create table: %v", err)
	}
	if _, err = db.Exec(`INSERT INTO users VALUES (1, 'Alice'), (2, 'Bob')`); err != nil {
		t.Fatalf("insert rows: %v", err)
	}
	return &transactionalMockDriver{
		mockDriver: mockDriver{dbType: driver.SQLite, isConnected: true},
		db:         db,
	}
}

func (m *transactionalMockDriver) BeginTx(ctx context.Context, opts *sql.TxOptions) (*sql.Tx, error) {
	return m.db.BeginTx(ctx, opts)
}

type mockCapabilityDriver struct {
	mockDriver
	capabilities *driver.StructureChangeCapabilities
	capErr       error
}

func (m *mockCapabilityDriver) GetStructureChangeCapabilities(_ context.Context) (*driver.StructureChangeCapabilities, error) {
	return m.capabilities, m.capErr
}

func allSupportedCapabilities(dbType driver.DatabaseType) *driver.StructureChangeCapabilities {
	op := driver.StructureOperationCapability{Supported: true}
	return &driver.StructureChangeCapabilities{
		DatabaseType:           dbType,
		CreateTable:            op,
		AddColumn:              op,
		RenameColumn:           op,
		AlterColumnType:        driver.StructureOperationCapability{Supported: true},
		AlterColumnDefault:     op,
		AlterColumnNullability: op,
		DropColumn:             driver.StructureOperationCapability{Supported: true, Destructive: true},
	}
}

// ─── helpers ──────────────────────────────────────────────────────────────────

// newConnServiceWithDriver returns a ConnectionService that already has drv injected
// for connID (ready to use via GetDriver without going through Connect).
func newConnServiceWithDriver(t *testing.T, connID string, drv driver.Driver) *ConnectionService {
	t.Helper()
	s := newTestStore(t)
	ss := NewSettingsService(newTestStore(t))
	cs := NewConnectionService(s, ss)
	if drv != nil && connID != "" {
		cs.mu.Lock()
		cs.drivers[connID] = drv
		cs.configs[connID] = driver.ConnectionConfig{
			ID:   connID,
			Type: drv.Type(),
		}
		cs.mu.Unlock()
	}
	return cs
}
