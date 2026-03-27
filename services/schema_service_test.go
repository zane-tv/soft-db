package services

import (
	"context"
	"testing"

	"soft-db/internal/driver"
)

func newTestSchemaService(t *testing.T, connID string, drv driver.Driver) *SchemaService {
	t.Helper()
	cs := newConnServiceWithDriver(t, connID, drv)
	return NewSchemaService(cs)
}

func TestSchemaService_GetTables_Success(t *testing.T) {
	t.Parallel()
	drv := &mockDriver{
		dbType:      driver.PostgreSQL,
		isConnected: true,
		tablesFunc: func(_ context.Context) ([]driver.TableInfo, error) {
			return []driver.TableInfo{
				{Name: "users", Type: "table"},
				{Name: "orders", Type: "table"},
			}, nil
		},
	}
	ss := newTestSchemaService(t, "conn-1", drv)

	tables, err := ss.GetTables("conn-1")
	if err != nil {
		t.Fatalf("GetTables: %v", err)
	}
	if len(tables) != 2 {
		t.Errorf("expected 2 tables, got %d", len(tables))
	}
}

func TestSchemaService_GetTables_NoConnection(t *testing.T) {
	t.Parallel()
	ss := newTestSchemaService(t, "", nil)

	_, err := ss.GetTables("missing")
	if err == nil {
		t.Fatal("expected error for missing connection")
	}
}

func TestSchemaService_GetColumns_Success(t *testing.T) {
	t.Parallel()
	drv := &mockDriver{
		dbType:      driver.PostgreSQL,
		isConnected: true,
		columnsFunc: func(_ context.Context, _ string) ([]driver.ColumnInfo, error) {
			return []driver.ColumnInfo{
				{Name: "id", Type: "integer", PrimaryKey: true},
				{Name: "name", Type: "text"},
			}, nil
		},
	}
	ss := newTestSchemaService(t, "conn-1", drv)

	cols, err := ss.GetColumns("conn-1", "users")
	if err != nil {
		t.Fatalf("GetColumns: %v", err)
	}
	if len(cols) != 2 {
		t.Errorf("expected 2 columns, got %d", len(cols))
	}
}

func TestSchemaService_GetTableIndexes_DriverDoesNotImplement(t *testing.T) {
	t.Parallel()
	drv := &mockDriver{dbType: driver.PostgreSQL, isConnected: true}
	ss := newTestSchemaService(t, "conn-1", drv)

	indexes, err := ss.GetTableIndexes("conn-1", "public", "users")
	if err != nil {
		t.Fatalf("GetTableIndexes: %v", err)
	}
	if len(indexes) != 0 {
		t.Errorf("expected empty slice for non-introspecting driver, got %d", len(indexes))
	}
}

func TestSchemaService_GetTableIndexes_WithIntrospector(t *testing.T) {
	t.Parallel()
	drv := &mockIndexForeignKeyDriver{
		mockDriver: mockDriver{dbType: driver.PostgreSQL, isConnected: true},
		indexes: []driver.IndexInfo{
			{Name: "users_pkey", TableName: "users", Columns: []string{"id"}, IsPrimary: true},
			{Name: "users_email_idx", TableName: "users", Columns: []string{"email"}, IsUnique: true},
		},
	}
	ss := newTestSchemaService(t, "conn-1", drv)

	indexes, err := ss.GetTableIndexes("conn-1", "public", "users")
	if err != nil {
		t.Fatalf("GetTableIndexes: %v", err)
	}
	if len(indexes) != 2 {
		t.Errorf("expected 2 indexes, got %d", len(indexes))
	}
}

func TestSchemaService_GetTableForeignKeys_DriverDoesNotImplement(t *testing.T) {
	t.Parallel()
	drv := &mockDriver{dbType: driver.MySQL, isConnected: true}
	ss := newTestSchemaService(t, "conn-1", drv)

	fks, err := ss.GetTableForeignKeys("conn-1", "mydb", "orders")
	if err != nil {
		t.Fatalf("GetTableForeignKeys: %v", err)
	}
	if len(fks) != 0 {
		t.Errorf("expected empty slice, got %d", len(fks))
	}
}

func TestSchemaService_GetTableForeignKeys_WithIntrospector(t *testing.T) {
	t.Parallel()
	drv := &mockIndexForeignKeyDriver{
		mockDriver: mockDriver{dbType: driver.MySQL, isConnected: true},
		foreignKeys: []driver.ForeignKeyInfo{
			{Name: "fk_orders_user", TableName: "orders", ColumnName: "user_id", ReferencedTable: "users", ReferencedColumn: "id"},
		},
	}
	ss := newTestSchemaService(t, "conn-1", drv)

	fks, err := ss.GetTableForeignKeys("conn-1", "mydb", "orders")
	if err != nil {
		t.Fatalf("GetTableForeignKeys: %v", err)
	}
	if len(fks) != 1 {
		t.Errorf("expected 1 foreign key, got %d", len(fks))
	}
	if fks[0].ReferencedTable != "users" {
		t.Errorf("ReferencedTable = %q, want %q", fks[0].ReferencedTable, "users")
	}
}

func TestSchemaService_HasMultiDB_False(t *testing.T) {
	t.Parallel()
	drv := &mockDriver{dbType: driver.PostgreSQL, isConnected: true}
	ss := newTestSchemaService(t, "conn-1", drv)

	if ss.HasMultiDB("conn-1") {
		t.Error("HasMultiDB should be false for mockDriver (no MultiDatabaseDriver)")
	}
}

func TestSchemaService_HasMultiDB_True(t *testing.T) {
	t.Parallel()
	drv := &mockMultiDBDriver{
		mockDriver: mockDriver{dbType: driver.MySQL, isConnected: true},
		databases:  []driver.DatabaseInfo{{Name: "mydb"}, {Name: "testdb"}},
	}
	ss := newTestSchemaService(t, "conn-1", drv)

	if !ss.HasMultiDB("conn-1") {
		t.Error("HasMultiDB should be true for mockMultiDBDriver")
	}
}

func TestSchemaService_HasMultiDB_NoConnection(t *testing.T) {
	t.Parallel()
	ss := newTestSchemaService(t, "", nil)

	if ss.HasMultiDB("missing") {
		t.Error("HasMultiDB should be false for missing connection")
	}
}

func TestSchemaService_GetDatabases_NotSupported(t *testing.T) {
	t.Parallel()
	drv := &mockDriver{dbType: driver.PostgreSQL, isConnected: true}
	ss := newTestSchemaService(t, "conn-1", drv)

	_, err := ss.GetDatabases("conn-1")
	if err == nil {
		t.Fatal("expected error when driver does not support multi-db")
	}
}

func TestSchemaService_GetDatabases_Supported(t *testing.T) {
	t.Parallel()
	drv := &mockMultiDBDriver{
		mockDriver: mockDriver{dbType: driver.MySQL, isConnected: true},
		databases:  []driver.DatabaseInfo{{Name: "db1"}, {Name: "db2"}},
	}
	ss := newTestSchemaService(t, "conn-1", drv)

	dbs, err := ss.GetDatabases("conn-1")
	if err != nil {
		t.Fatalf("GetDatabases: %v", err)
	}
	if len(dbs) != 2 {
		t.Errorf("expected 2 databases, got %d", len(dbs))
	}
}

func TestSchemaService_GetDatabaseSchemas_NotSupported(t *testing.T) {
	t.Parallel()
	drv := &mockDriver{dbType: driver.MySQL, isConnected: true}
	ss := newTestSchemaService(t, "conn-1", drv)

	schemas, err := ss.GetDatabaseSchemas("conn-1", "mydb")
	if err != nil {
		t.Fatalf("GetDatabaseSchemas: %v", err)
	}
	if len(schemas) != 0 {
		t.Errorf("expected empty slice for non-introspecting driver, got %d", len(schemas))
	}
}

func TestSchemaService_DropTable_Redis_Fails(t *testing.T) {
	t.Parallel()
	drv := &mockDriver{dbType: driver.Redis, isConnected: true}
	ss := newTestSchemaService(t, "conn-1", drv)

	if err := ss.DropTable("conn-1", "mykey"); err == nil {
		t.Error("expected error when dropping table on Redis connection")
	}
}

func TestSchemaService_DropTable_SQL_Success(t *testing.T) {
	t.Parallel()
	drv := &mockDriver{
		dbType:      driver.PostgreSQL,
		isConnected: true,
		executeFunc: func(_ context.Context, _ string) (*driver.QueryResult, error) {
			return &driver.QueryResult{}, nil
		},
	}
	ss := newTestSchemaService(t, "conn-1", drv)

	if err := ss.DropTable("conn-1", "users"); err != nil {
		t.Errorf("DropTable: %v", err)
	}
}

func TestSchemaService_GetMongoValidator_NotSupported(t *testing.T) {
	t.Parallel()
	drv := &mockDriver{dbType: driver.PostgreSQL, isConnected: true}
	ss := newTestSchemaService(t, "conn-1", drv)

	_, err := ss.GetMongoValidator("conn-1", "mydb", "users")
	if err == nil {
		t.Fatal("expected error for non-MongoDB driver")
	}
}

func TestBuildCreateColumnDefinition_Basic(t *testing.T) {
	t.Parallel()
	col := StructureColumnDefinition{Name: "id", Type: "INTEGER", PrimaryKey: true, NotNull: true}
	def, err := buildCreateColumnDefinition(driver.PostgreSQL, col)
	if err != nil {
		t.Fatalf("buildCreateColumnDefinition: %v", err)
	}
	if def == "" {
		t.Error("expected non-empty column definition")
	}
}

func TestBuildCreateColumnDefinition_MissingName(t *testing.T) {
	t.Parallel()
	col := StructureColumnDefinition{Name: "", Type: "TEXT"}
	_, err := buildCreateColumnDefinition(driver.PostgreSQL, col)
	if err == nil {
		t.Error("expected error for missing column name")
	}
}

func TestBuildCreateColumnDefinition_MissingType(t *testing.T) {
	t.Parallel()
	col := StructureColumnDefinition{Name: "col", Type: ""}
	_, err := buildCreateColumnDefinition(driver.PostgreSQL, col)
	if err == nil {
		t.Error("expected error for missing column type")
	}
}

func TestBuildAlterColumnTypeStatement_PostgreSQL(t *testing.T) {
	t.Parallel()
	cur := driver.ColumnInfo{Name: "age", Type: "integer"}
	stmt, err := buildAlterColumnTypeStatement(driver.PostgreSQL, "users", cur, "bigint")
	if err != nil {
		t.Fatalf("buildAlterColumnTypeStatement: %v", err)
	}
	if stmt == "" {
		t.Error("expected non-empty statement")
	}
}

func TestBuildAlterColumnTypeStatement_SQLite_Unsupported(t *testing.T) {
	t.Parallel()
	cur := driver.ColumnInfo{Name: "age", Type: "integer"}
	_, err := buildAlterColumnTypeStatement(driver.SQLite, "users", cur, "bigint")
	if err == nil {
		t.Error("expected error for SQLite alter column type")
	}
}

func TestHasBlockingStructureWarnings(t *testing.T) {
	t.Parallel()
	warnings := []StructureChangeWarning{
		{Code: "unsupported_operation", Blocking: true},
	}
	if !hasBlockingStructureWarnings(warnings) {
		t.Error("expected true for blocking warning")
	}
}

func TestHasBlockingStructureWarnings_None(t *testing.T) {
	t.Parallel()
	warnings := []StructureChangeWarning{
		{Code: "risky_type_change", Blocking: false, Destructive: false},
	}
	if hasBlockingStructureWarnings(warnings) {
		t.Error("expected false for non-blocking warning")
	}
}

func TestRequiresStructureConfirmation_Destructive(t *testing.T) {
	t.Parallel()
	warnings := []StructureChangeWarning{
		{Code: "drop_column", Destructive: true, Blocking: false},
	}
	if !requiresStructureConfirmation(warnings) {
		t.Error("expected confirmation for destructive warning")
	}
}

func TestEngineHasLimitedDDLTransactions(t *testing.T) {
	t.Parallel()
	if !engineHasLimitedDDLTransactions(driver.MySQL) {
		t.Error("MySQL should have limited DDL transactions")
	}
	if engineHasLimitedDDLTransactions(driver.PostgreSQL) {
		t.Error("PostgreSQL should NOT have limited DDL transactions")
	}
}

func newCapabilitySchemaService(t *testing.T, connID string, drv driver.Driver) *SchemaService {
	t.Helper()
	cs := newConnServiceWithDriver(t, connID, drv)
	return NewSchemaService(cs)
}

func TestSchemaService_PreviewStructureChange_CreateTable_Success(t *testing.T) {
	t.Parallel()
	drv := &mockCapabilityDriver{
		mockDriver:   mockDriver{dbType: driver.PostgreSQL, isConnected: true},
		capabilities: allSupportedCapabilities(driver.PostgreSQL),
	}
	ss := newCapabilitySchemaService(t, "conn-1", drv)

	result, err := ss.PreviewStructureChange("conn-1", StructureChangeRequest{
		Mode: "createTable",
		CreateTable: &CreateTableRequest{
			Table: "products",
			Columns: []StructureColumnDefinition{
				{Name: "id", Type: "SERIAL", PrimaryKey: true},
				{Name: "name", Type: "TEXT", NotNull: true},
			},
		},
	})
	if err != nil {
		t.Fatalf("PreviewStructureChange: %v", err)
	}
	if !result.Supported {
		t.Errorf("expected Supported=true, warnings: %v", result.Warnings)
	}
	if len(result.Statements) == 0 {
		t.Error("expected at least one CREATE TABLE statement")
	}
}

func TestSchemaService_PreviewStructureChange_CreateTable_InvalidMode(t *testing.T) {
	t.Parallel()
	drv := &mockCapabilityDriver{
		mockDriver:   mockDriver{dbType: driver.PostgreSQL, isConnected: true},
		capabilities: allSupportedCapabilities(driver.PostgreSQL),
	}
	ss := newCapabilitySchemaService(t, "conn-1", drv)

	result, err := ss.PreviewStructureChange("conn-1", StructureChangeRequest{
		Mode: "unknownMode",
	})
	if err != nil {
		t.Fatalf("PreviewStructureChange: %v", err)
	}
	if result.Supported {
		t.Error("expected Supported=false for invalid mode")
	}
}

func TestSchemaService_PreviewStructureChange_CreateTable_MissingPayload(t *testing.T) {
	t.Parallel()
	drv := &mockCapabilityDriver{
		mockDriver:   mockDriver{dbType: driver.PostgreSQL, isConnected: true},
		capabilities: allSupportedCapabilities(driver.PostgreSQL),
	}
	ss := newCapabilitySchemaService(t, "conn-1", drv)

	result, err := ss.PreviewStructureChange("conn-1", StructureChangeRequest{
		Mode:        "createTable",
		CreateTable: nil,
	})
	if err != nil {
		t.Fatalf("PreviewStructureChange: %v", err)
	}
	if result.Supported {
		t.Error("expected Supported=false for nil createTable payload")
	}
}

func TestSchemaService_PreviewStructureChange_CreateTable_NoColumns(t *testing.T) {
	t.Parallel()
	drv := &mockCapabilityDriver{
		mockDriver:   mockDriver{dbType: driver.PostgreSQL, isConnected: true},
		capabilities: allSupportedCapabilities(driver.PostgreSQL),
	}
	ss := newCapabilitySchemaService(t, "conn-1", drv)

	result, err := ss.PreviewStructureChange("conn-1", StructureChangeRequest{
		Mode:        "createTable",
		CreateTable: &CreateTableRequest{Table: "empty_table", Columns: nil},
	})
	if err != nil {
		t.Fatalf("PreviewStructureChange: %v", err)
	}
	if result.Supported {
		t.Error("expected Supported=false for no columns")
	}
}

func TestSchemaService_PreviewStructureChange_AlterTable_AddColumn(t *testing.T) {
	t.Parallel()
	drv := &mockCapabilityDriver{
		mockDriver: mockDriver{
			dbType:      driver.PostgreSQL,
			isConnected: true,
			columnsFunc: func(_ context.Context, _ string) ([]driver.ColumnInfo, error) {
				return []driver.ColumnInfo{
					{Name: "id", Type: "integer", PrimaryKey: true},
					{Name: "name", Type: "text"},
				}, nil
			},
		},
		capabilities: allSupportedCapabilities(driver.PostgreSQL),
	}
	ss := newCapabilitySchemaService(t, "conn-1", drv)

	result, err := ss.PreviewStructureChange("conn-1", StructureChangeRequest{
		Mode: "alterTable",
		AlterTable: &AlterTableRequest{
			Table: "users",
			Operations: []StructureChangeOperation{
				{Kind: "addColumn", AddColumn: &AddColumnOperation{
					Column: StructureColumnDefinition{Name: "email", Type: "TEXT"},
				}},
			},
		},
	})
	if err != nil {
		t.Fatalf("PreviewStructureChange alterTable: %v", err)
	}
	if !result.Supported {
		t.Errorf("expected Supported=true, warnings: %v", result.Warnings)
	}
}

func TestSchemaService_PreviewStructureChange_AlterTable_RenameColumn(t *testing.T) {
	t.Parallel()
	drv := &mockCapabilityDriver{
		mockDriver: mockDriver{
			dbType:      driver.PostgreSQL,
			isConnected: true,
			columnsFunc: func(_ context.Context, _ string) ([]driver.ColumnInfo, error) {
				return []driver.ColumnInfo{
					{Name: "old_name", Type: "text"},
				}, nil
			},
		},
		capabilities: allSupportedCapabilities(driver.PostgreSQL),
	}
	ss := newCapabilitySchemaService(t, "conn-1", drv)

	result, err := ss.PreviewStructureChange("conn-1", StructureChangeRequest{
		Mode: "alterTable",
		AlterTable: &AlterTableRequest{
			Table: "users",
			Operations: []StructureChangeOperation{
				{Kind: "renameColumn", RenameColumn: &RenameColumnOperation{
					Column: "old_name", NewName: "new_name",
				}},
			},
		},
	})
	if err != nil {
		t.Fatalf("PreviewStructureChange renameColumn: %v", err)
	}
	if !result.Supported {
		t.Errorf("expected Supported=true, warnings: %v", result.Warnings)
	}
}

func TestSchemaService_PreviewStructureChange_AlterTable_DropColumn(t *testing.T) {
	t.Parallel()
	drv := &mockCapabilityDriver{
		mockDriver: mockDriver{
			dbType:      driver.PostgreSQL,
			isConnected: true,
			columnsFunc: func(_ context.Context, _ string) ([]driver.ColumnInfo, error) {
				return []driver.ColumnInfo{
					{Name: "id", Type: "integer", PrimaryKey: true},
					{Name: "temp_col", Type: "text"},
				}, nil
			},
		},
		capabilities: allSupportedCapabilities(driver.PostgreSQL),
	}
	ss := newCapabilitySchemaService(t, "conn-1", drv)

	result, err := ss.PreviewStructureChange("conn-1", StructureChangeRequest{
		Mode: "alterTable",
		AlterTable: &AlterTableRequest{
			Table: "users",
			Operations: []StructureChangeOperation{
				{Kind: "dropColumn", DropColumn: &DropColumnOperation{Column: "temp_col"}},
			},
		},
	})
	if err != nil {
		t.Fatalf("PreviewStructureChange dropColumn: %v", err)
	}
	if result.HasDestructiveChanges == false {
		t.Error("expected HasDestructiveChanges=true for DROP COLUMN")
	}
}

func TestSchemaService_PreviewStructureChange_AlterTable_AlterColumnType(t *testing.T) {
	t.Parallel()
	drv := &mockCapabilityDriver{
		mockDriver: mockDriver{
			dbType:      driver.PostgreSQL,
			isConnected: true,
			columnsFunc: func(_ context.Context, _ string) ([]driver.ColumnInfo, error) {
				return []driver.ColumnInfo{
					{Name: "age", Type: "integer"},
				}, nil
			},
		},
		capabilities: allSupportedCapabilities(driver.PostgreSQL),
	}
	ss := newCapabilitySchemaService(t, "conn-1", drv)

	result, err := ss.PreviewStructureChange("conn-1", StructureChangeRequest{
		Mode: "alterTable",
		AlterTable: &AlterTableRequest{
			Table: "users",
			Operations: []StructureChangeOperation{
				{Kind: "alterColumnType", AlterColumnType: &AlterColumnTypeOperation{
					Column: "age", NewType: "bigint",
				}},
			},
		},
	})
	if err != nil {
		t.Fatalf("PreviewStructureChange alterColumnType: %v", err)
	}
	if !result.Supported {
		t.Errorf("expected Supported=true, warnings: %v", result.Warnings)
	}
}

func TestSchemaService_PreviewStructureChange_AlterTable_AlterColumnDefault(t *testing.T) {
	t.Parallel()
	drv := &mockCapabilityDriver{
		mockDriver: mockDriver{
			dbType:      driver.PostgreSQL,
			isConnected: true,
			columnsFunc: func(_ context.Context, _ string) ([]driver.ColumnInfo, error) {
				return []driver.ColumnInfo{
					{Name: "status", Type: "text"},
				}, nil
			},
		},
		capabilities: allSupportedCapabilities(driver.PostgreSQL),
	}
	ss := newCapabilitySchemaService(t, "conn-1", drv)

	result, err := ss.PreviewStructureChange("conn-1", StructureChangeRequest{
		Mode: "alterTable",
		AlterTable: &AlterTableRequest{
			Table: "users",
			Operations: []StructureChangeOperation{
				{Kind: "alterColumnDefault", AlterColumnDefault: &AlterColumnDefaultOperation{
					Column: "status", HasDefault: true, DefaultValue: "'active'",
				}},
			},
		},
	})
	if err != nil {
		t.Fatalf("PreviewStructureChange alterColumnDefault: %v", err)
	}
	if !result.Supported {
		t.Errorf("expected Supported=true, warnings: %v", result.Warnings)
	}
}

func TestSchemaService_PreviewStructureChange_AlterTable_AlterColumnNullability(t *testing.T) {
	t.Parallel()
	drv := &mockCapabilityDriver{
		mockDriver: mockDriver{
			dbType:      driver.PostgreSQL,
			isConnected: true,
			columnsFunc: func(_ context.Context, _ string) ([]driver.ColumnInfo, error) {
				return []driver.ColumnInfo{
					{Name: "email", Type: "text", Nullable: true},
				}, nil
			},
		},
		capabilities: allSupportedCapabilities(driver.PostgreSQL),
	}
	ss := newCapabilitySchemaService(t, "conn-1", drv)

	result, err := ss.PreviewStructureChange("conn-1", StructureChangeRequest{
		Mode: "alterTable",
		AlterTable: &AlterTableRequest{
			Table: "users",
			Operations: []StructureChangeOperation{
				{Kind: "alterColumnNullability", AlterColumnNullability: &AlterColumnNullabilityOperation{
					Column: "email", NotNull: true,
				}},
			},
		},
	})
	if err != nil {
		t.Fatalf("PreviewStructureChange alterColumnNullability: %v", err)
	}
	if !result.Supported {
		t.Errorf("expected Supported=true, warnings: %v", result.Warnings)
	}
}

func TestSchemaService_PreviewStructureChange_AlterTable_UnknownColumn(t *testing.T) {
	t.Parallel()
	drv := &mockCapabilityDriver{
		mockDriver: mockDriver{
			dbType:      driver.PostgreSQL,
			isConnected: true,
			columnsFunc: func(_ context.Context, _ string) ([]driver.ColumnInfo, error) {
				return []driver.ColumnInfo{
					{Name: "id", Type: "integer", PrimaryKey: true},
				}, nil
			},
		},
		capabilities: allSupportedCapabilities(driver.PostgreSQL),
	}
	ss := newCapabilitySchemaService(t, "conn-1", drv)

	result, err := ss.PreviewStructureChange("conn-1", StructureChangeRequest{
		Mode: "alterTable",
		AlterTable: &AlterTableRequest{
			Table: "users",
			Operations: []StructureChangeOperation{
				{Kind: "dropColumn", DropColumn: &DropColumnOperation{Column: "nonexistent"}},
			},
		},
	})
	if err != nil {
		t.Fatalf("PreviewStructureChange unknownColumn: %v", err)
	}
	if result.Supported {
		t.Error("expected Supported=false for unknown column")
	}
}

func TestSchemaService_ApplyStructureChange_CreateTable(t *testing.T) {
	t.Parallel()
	drv := &mockCapabilityDriver{
		mockDriver: mockDriver{
			dbType:      driver.PostgreSQL,
			isConnected: true,
			executeFunc: func(_ context.Context, _ string) (*driver.QueryResult, error) {
				return &driver.QueryResult{}, nil
			},
		},
		capabilities: allSupportedCapabilities(driver.PostgreSQL),
	}
	ss := newCapabilitySchemaService(t, "conn-1", drv)

	result, err := ss.ApplyStructureChange("conn-1", StructureChangeRequest{
		Mode:         "createTable",
		ConfirmApply: true,
		CreateTable: &CreateTableRequest{
			Table: "new_table",
			Columns: []StructureColumnDefinition{
				{Name: "id", Type: "SERIAL", PrimaryKey: true},
			},
		},
	})
	if err != nil {
		t.Fatalf("ApplyStructureChange: %v", err)
	}
	if !result.Success {
		t.Errorf("expected Success=true, error: %s", result.Error)
	}
}

func TestSchemaService_ApplyStructureChange_NoCapabilityDriver(t *testing.T) {
	t.Parallel()
	drv := &mockDriver{dbType: driver.PostgreSQL, isConnected: true}
	ss := newCapabilitySchemaService(t, "conn-1", drv)

	_, err := ss.ApplyStructureChange("conn-1", StructureChangeRequest{Mode: "createTable"})
	if err == nil {
		t.Fatal("expected error when driver has no capability")
	}
}

func TestSchemaService_GetStructureChangeCapabilities_Supported(t *testing.T) {
	t.Parallel()
	drv := &mockCapabilityDriver{
		mockDriver:   mockDriver{dbType: driver.PostgreSQL, isConnected: true},
		capabilities: allSupportedCapabilities(driver.PostgreSQL),
	}
	ss := newCapabilitySchemaService(t, "conn-1", drv)

	caps, err := ss.GetStructureChangeCapabilities("conn-1")
	if err != nil {
		t.Fatalf("GetStructureChangeCapabilities: %v", err)
	}
	if !caps.CreateTable.Supported {
		t.Error("expected CreateTable to be supported")
	}
}

func TestSchemaService_GetStructureChangeCapabilities_NotSupported(t *testing.T) {
	t.Parallel()
	drv := &mockDriver{dbType: driver.PostgreSQL, isConnected: true}
	ss := newCapabilitySchemaService(t, "conn-1", drv)

	_, err := ss.GetStructureChangeCapabilities("conn-1")
	if err == nil {
		t.Fatal("expected error for non-capability driver")
	}
}

func TestBuildAlterColumnDefaultStatement_PostgreSQL_SetDefault(t *testing.T) {
	t.Parallel()
	cur := driver.ColumnInfo{Name: "status", Type: "text"}
	stmt, err := buildAlterColumnDefaultStatement(driver.PostgreSQL, "users", cur, AlterColumnDefaultOperation{
		HasDefault: true, DefaultValue: "'active'",
	})
	if err != nil {
		t.Fatalf("buildAlterColumnDefaultStatement: %v", err)
	}
	if stmt == "" {
		t.Error("expected non-empty statement")
	}
}

func TestBuildAlterColumnDefaultStatement_PostgreSQL_DropDefault(t *testing.T) {
	t.Parallel()
	cur := driver.ColumnInfo{Name: "status", Type: "text"}
	stmt, err := buildAlterColumnDefaultStatement(driver.PostgreSQL, "users", cur, AlterColumnDefaultOperation{
		HasDefault: false,
	})
	if err != nil {
		t.Fatalf("buildAlterColumnDefaultStatement drop: %v", err)
	}
	if stmt == "" {
		t.Error("expected non-empty statement")
	}
}

func TestBuildAlterColumnNullabilityStatement_PostgreSQL(t *testing.T) {
	t.Parallel()
	cur := driver.ColumnInfo{Name: "email", Type: "text", Nullable: true}
	stmt, err := buildAlterColumnNullabilityStatement(driver.PostgreSQL, "users", cur, true)
	if err != nil {
		t.Fatalf("buildAlterColumnNullabilityStatement: %v", err)
	}
	if stmt == "" {
		t.Error("expected non-empty statement")
	}
}

func TestBuildAlterColumnNullabilityStatement_SQLite_Unsupported(t *testing.T) {
	t.Parallel()
	cur := driver.ColumnInfo{Name: "email", Type: "text"}
	_, err := buildAlterColumnNullabilityStatement(driver.SQLite, "users", cur, true)
	if err == nil {
		t.Error("expected error for SQLite nullability change")
	}
}

func TestDedupeCapabilityNotes(t *testing.T) {
	t.Parallel()
	notes := []driver.StructureCapabilityNote{
		{Code: "a", Message: "msg", Severity: "warning"},
		{Code: "a", Message: "msg", Severity: "warning"},
		{Code: "b", Message: "other", Severity: "info"},
	}
	result := dedupeCapabilityNotes(notes)
	if len(result) != 2 {
		t.Errorf("expected 2 deduped notes, got %d", len(result))
	}
}
