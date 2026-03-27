package driver

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

// SQLiteDriver implements Driver for SQLite
type SQLiteDriver struct {
	db     *sql.DB
	config ConnectionConfig
}

func (d *SQLiteDriver) Connect(ctx context.Context, cfg ConnectionConfig) error {
	d.config = cfg

	dbPath := cfg.FilePath
	if dbPath == "" {
		dbPath = cfg.Database
	}
	if dbPath == "" {
		return fmt.Errorf("no database file path specified")
	}

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return fmt.Errorf("failed to open sqlite: %w", err)
	}

	// Enable WAL mode and foreign keys
	db.Exec("PRAGMA journal_mode=WAL")
	db.Exec("PRAGMA foreign_keys=ON")

	if err := db.PingContext(ctx); err != nil {
		db.Close()
		return fmt.Errorf("failed to ping sqlite: %w", err)
	}

	d.db = db
	return nil
}

func (d *SQLiteDriver) Disconnect(ctx context.Context) error {
	if d.db != nil {
		return d.db.Close()
	}
	return nil
}

func (d *SQLiteDriver) Ping(ctx context.Context) error {
	if d.db == nil {
		return fmt.Errorf("not connected")
	}
	return d.db.PingContext(ctx)
}

func (d *SQLiteDriver) Execute(ctx context.Context, query string) (*QueryResult, error) {
	if d.db == nil {
		return nil, fmt.Errorf("not connected")
	}

	start := time.Now()
	trimmed := strings.TrimSpace(strings.ToUpper(query))

	if strings.HasPrefix(trimmed, "SELECT") || strings.HasPrefix(trimmed, "PRAGMA") ||
		strings.HasPrefix(trimmed, "EXPLAIN") || strings.HasPrefix(trimmed, "WITH") {
		return d.executeQuery(ctx, query, start)
	}

	return d.executeExec(ctx, query, start)
}

func (d *SQLiteDriver) executeQuery(ctx context.Context, query string, start time.Time) (*QueryResult, error) {
	rows, err := d.db.QueryContext(ctx, query)
	if err != nil {
		return &QueryResult{Error: err.Error(), ExecutionTime: measureTime(start)}, nil
	}
	defer rows.Close()

	return scanRows(rows, start)
}

func (d *SQLiteDriver) executeExec(ctx context.Context, query string, start time.Time) (*QueryResult, error) {
	result, err := d.db.ExecContext(ctx, query)
	if err != nil {
		return &QueryResult{Error: err.Error(), ExecutionTime: measureTime(start)}, nil
	}

	affected, _ := result.RowsAffected()
	return &QueryResult{
		AffectedRows:  affected,
		ExecutionTime: measureTime(start),
	}, nil
}

func (d *SQLiteDriver) ExecuteArgs(ctx context.Context, query string, args ...interface{}) (*QueryResult, error) {
	if d.db == nil {
		return nil, fmt.Errorf("not connected")
	}

	start := time.Now()
	result, err := d.db.ExecContext(ctx, query, args...)
	if err != nil {
		return &QueryResult{Error: err.Error(), ExecutionTime: measureTime(start)}, nil
	}

	affected, _ := result.RowsAffected()
	return &QueryResult{
		AffectedRows:  affected,
		ExecutionTime: measureTime(start),
	}, nil
}

func (d *SQLiteDriver) Tables(ctx context.Context) ([]TableInfo, error) {
	if d.db == nil {
		return nil, fmt.Errorf("not connected")
	}

	rows, err := d.db.QueryContext(ctx,
		`SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tables []TableInfo
	for rows.Next() {
		var t TableInfo
		if err := rows.Scan(&t.Name, &t.Type); err != nil {
			return nil, err
		}
		tables = append(tables, t)
	}
	return tables, nil
}

func (d *SQLiteDriver) Columns(ctx context.Context, table string) ([]ColumnInfo, error) {
	if d.db == nil {
		return nil, fmt.Errorf("not connected")
	}

	rows, err := d.db.QueryContext(ctx, fmt.Sprintf("PRAGMA table_info('%s')", table))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var columns []ColumnInfo
	for rows.Next() {
		var c ColumnInfo
		var cid int
		var notNull int
		var pk int
		var defaultVal sql.NullString
		if err := rows.Scan(&cid, &c.Name, &c.Type, &notNull, &defaultVal, &pk); err != nil {
			return nil, err
		}
		c.OrdinalPos = cid + 1
		c.Nullable = notNull == 0
		c.PrimaryKey = pk > 0
		if defaultVal.Valid {
			c.DefaultValue = defaultVal.String
		}
		columns = append(columns, c)
	}
	return columns, nil
}

func (d *SQLiteDriver) Views(ctx context.Context) ([]string, error) {
	if d.db == nil {
		return nil, fmt.Errorf("not connected")
	}

	rows, err := d.db.QueryContext(ctx,
		`SELECT name FROM sqlite_master WHERE type = 'view' ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var views []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		views = append(views, name)
	}
	return views, nil
}

func (d *SQLiteDriver) Functions(ctx context.Context) ([]FunctionInfo, error) {
	// SQLite doesn't have stored functions
	return nil, nil
}

func (d *SQLiteDriver) Type() DatabaseType { return SQLite }
func (d *SQLiteDriver) IsConnected() bool  { return d.db != nil }

// ─── ExportableDriver implementation ───

var _ ExportableDriver = (*SQLiteDriver)(nil)

func (d *SQLiteDriver) GetTableRowCount(table string) (int64, error) {
	if d.db == nil {
		return 0, fmt.Errorf("not connected")
	}

	var count int64
	query := fmt.Sprintf(`SELECT COUNT(*) FROM "%s"`, table)
	if err := d.db.QueryRow(query).Scan(&count); err != nil {
		return 0, fmt.Errorf("row count %q: %w", table, err)
	}
	return count, nil
}

func (d *SQLiteDriver) GetTableRows(table string, limit, offset int) (*QueryResult, error) {
	if d.db == nil {
		return nil, fmt.Errorf("not connected")
	}

	start := time.Now()
	query := fmt.Sprintf(`SELECT * FROM "%s" LIMIT ? OFFSET ?`, table)
	rows, err := d.db.Query(query, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("table rows %q: %w", table, err)
	}
	defer rows.Close()

	return scanRows(rows, start)
}

func (d *SQLiteDriver) GetCreateTableDDL(table string) (string, error) {
	if d.db == nil {
		return "", fmt.Errorf("not connected")
	}

	var ddl sql.NullString
	err := d.db.QueryRow(
		`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`, table,
	).Scan(&ddl)
	if err != nil {
		return "", fmt.Errorf("create table DDL %q: %w", table, err)
	}
	if !ddl.Valid || ddl.String == "" {
		return "", fmt.Errorf("table %q not found", table)
	}
	return ddl.String + ";", nil
}

func (d *SQLiteDriver) GetStructureChangeCapabilities(ctx context.Context) (*StructureChangeCapabilities, error) {
	return &StructureChangeCapabilities{
		DatabaseType: SQLite,
		GeneralNotes: []StructureCapabilityNote{{
			Code:     "sqlite_limited_alter",
			Message:  "SQLite ALTER TABLE support is intentionally limited in v1; unsupported changes are blocked instead of rewritten",
			Severity: "warning",
		}},
		CreateTable: StructureOperationCapability{Supported: true},
		AddColumn: StructureOperationCapability{
			Supported: true,
			Notes: []StructureCapabilityNote{{
				Code:     "sqlite_add_column_limits",
				Message:  "SQLite add-column support is limited; primary keys, unique constraints, and NOT NULL without defaults are blocked",
				Severity: "warning",
			}},
		},
		RenameColumn:           StructureOperationCapability{Supported: true},
		AlterColumnType:        StructureOperationCapability{Supported: false},
		AlterColumnDefault:     StructureOperationCapability{Supported: false},
		AlterColumnNullability: StructureOperationCapability{Supported: false},
		DropColumn: StructureOperationCapability{
			Supported:            true,
			Destructive:          true,
			RequiresConfirmation: true,
			Notes: []StructureCapabilityNote{{
				Code:     "sqlite_drop_column_version",
				Message:  "SQLite drop-column support depends on modern engine versions and should be reviewed before apply",
				Severity: "warning",
			}},
		},
	}, nil
}
