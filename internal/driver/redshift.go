package driver

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
)

// RedshiftDriver implements Driver for Amazon Redshift
// Redshift uses the PostgreSQL wire protocol, so we reuse pgx
// with Redshift-specific schema queries
type RedshiftDriver struct {
	db     *sql.DB
	config ConnectionConfig
}

func (d *RedshiftDriver) Connect(ctx context.Context, cfg ConnectionConfig) error {
	d.config = cfg

	sslMode := cfg.SSLMode
	if sslMode == "" {
		sslMode = "require"
	}

	// Default to "dev" database if none specified (Redshift default)
	dbName := cfg.Database
	if dbName == "" {
		dbName = "dev"
	}

	dsn := fmt.Sprintf("postgres://%s:%s@%s:%d/%s?sslmode=%s",
		cfg.Username, cfg.Password, cfg.Host, cfg.Port, dbName, sslMode)

	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return fmt.Errorf("failed to open redshift connection: %w", err)
	}

	db.SetMaxOpenConns(5)
	db.SetMaxIdleConns(3)
	db.SetConnMaxLifetime(5 * time.Minute)

	if err := db.PingContext(ctx); err != nil {
		db.Close()
		return fmt.Errorf("failed to ping redshift: %w", err)
	}

	d.db = db
	return nil
}

func (d *RedshiftDriver) Disconnect(ctx context.Context) error {
	if d.db != nil {
		return d.db.Close()
	}
	return nil
}

func (d *RedshiftDriver) Ping(ctx context.Context) error {
	if d.db == nil {
		return fmt.Errorf("not connected")
	}
	return d.db.PingContext(ctx)
}

func (d *RedshiftDriver) Execute(ctx context.Context, query string) (*QueryResult, error) {
	if d.db == nil {
		return nil, fmt.Errorf("not connected")
	}

	start := time.Now()
	trimmed := strings.TrimSpace(strings.ToUpper(query))

	if strings.HasPrefix(trimmed, "SELECT") || strings.HasPrefix(trimmed, "SHOW") ||
		strings.HasPrefix(trimmed, "EXPLAIN") || strings.HasPrefix(trimmed, "WITH") {
		rows, err := d.db.QueryContext(ctx, query)
		if err != nil {
			return &QueryResult{Error: err.Error(), ExecutionTime: measureTime(start)}, nil
		}
		defer rows.Close()
		return scanRows(rows, start)
	}

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

func (d *RedshiftDriver) ExecuteArgs(ctx context.Context, query string, args ...interface{}) (*QueryResult, error) {
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

func (d *RedshiftDriver) Tables(ctx context.Context) ([]TableInfo, error) {
	if d.db == nil {
		return nil, fmt.Errorf("not connected")
	}

	query := `SELECT tablename AS name, 'table' AS type
		FROM pg_catalog.pg_tables
		WHERE schemaname = 'public'
		UNION ALL
		SELECT viewname AS name, 'view' AS type
		FROM pg_catalog.pg_views
		WHERE schemaname = 'public'
		ORDER BY name`

	rows, err := d.db.QueryContext(ctx, query)
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
		t.Schema = "public"
		tables = append(tables, t)
	}
	return tables, nil
}

func (d *RedshiftDriver) Columns(ctx context.Context, table string) ([]ColumnInfo, error) {
	if d.db == nil {
		return nil, fmt.Errorf("not connected")
	}

	query := `SELECT column_name, data_type, is_nullable, column_default, ordinal_position
		FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = $1
		ORDER BY ordinal_position`

	rows, err := d.db.QueryContext(ctx, query, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var columns []ColumnInfo
	for rows.Next() {
		var c ColumnInfo
		var nullable string
		var defaultVal sql.NullString
		if err := rows.Scan(&c.Name, &c.Type, &nullable, &defaultVal, &c.OrdinalPos); err != nil {
			return nil, err
		}
		c.Nullable = nullable == "YES"
		if defaultVal.Valid {
			c.DefaultValue = defaultVal.String
		}
		columns = append(columns, c)
	}
	return columns, nil
}

func (d *RedshiftDriver) Views(ctx context.Context) ([]string, error) {
	if d.db == nil {
		return nil, fmt.Errorf("not connected")
	}

	rows, err := d.db.QueryContext(ctx,
		`SELECT viewname FROM pg_catalog.pg_views WHERE schemaname = 'public' ORDER BY viewname`)
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

func (d *RedshiftDriver) Functions(ctx context.Context) ([]FunctionInfo, error) {
	// Redshift has limited stored procedure support
	return nil, nil
}

func (d *RedshiftDriver) Type() DatabaseType { return Redshift }
func (d *RedshiftDriver) IsConnected() bool  { return d.db != nil }

func (d *RedshiftDriver) GetStructureChangeCapabilities(ctx context.Context) (*StructureChangeCapabilities, error) {
	return &StructureChangeCapabilities{
		DatabaseType: Redshift,
		GeneralNotes: []StructureCapabilityNote{{
			Code:     "redshift_limited_ddl",
			Message:  "Redshift DDL support is narrower than PostgreSQL and multi-statement apply should be reviewed carefully",
			Severity: "warning",
		}},
		CreateTable:  StructureOperationCapability{Supported: true},
		AddColumn:    StructureOperationCapability{Supported: true},
		RenameColumn: StructureOperationCapability{Supported: true},
		AlterColumnType: StructureOperationCapability{
			Supported:            true,
			RequiresConfirmation: true,
			Notes: []StructureCapabilityNote{{
				Code:     "redshift_type_change_limits",
				Message:  "Redshift type changes are limited to specific conversions and may fail on existing data",
				Severity: "warning",
			}},
		},
		AlterColumnDefault:     StructureOperationCapability{Supported: false},
		AlterColumnNullability: StructureOperationCapability{Supported: false},
		DropColumn: StructureOperationCapability{
			Supported:            true,
			Destructive:          true,
			RequiresConfirmation: true,
		},
	}, nil
}

// ─── ExportableDriver implementation ───

var _ ExportableDriver = (*RedshiftDriver)(nil)

func (d *RedshiftDriver) GetTableRowCount(table string) (int64, error) {
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

func (d *RedshiftDriver) GetTableRows(table string, limit, offset int) (*QueryResult, error) {
	if d.db == nil {
		return nil, fmt.Errorf("not connected")
	}

	start := time.Now()
	query := fmt.Sprintf(`SELECT * FROM "%s" LIMIT $1 OFFSET $2`, table)
	rows, err := d.db.Query(query, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("table rows %q: %w", table, err)
	}
	defer rows.Close()

	return scanRows(rows, start)
}

func (d *RedshiftDriver) GetCreateTableDDL(table string) (string, error) {
	if d.db == nil {
		return "", fmt.Errorf("not connected")
	}

	query := `SELECT column_name, data_type, character_maximum_length,
			is_nullable, column_default
		FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = $1
		ORDER BY ordinal_position`

	rows, err := d.db.Query(query, table)
	if err != nil {
		return "", fmt.Errorf("create table DDL %q: %w", table, err)
	}
	defer rows.Close()

	var cols []string
	for rows.Next() {
		var name, dataType, nullable string
		var maxLen sql.NullInt64
		var defaultVal sql.NullString
		if err := rows.Scan(&name, &dataType, &maxLen, &nullable, &defaultVal); err != nil {
			return "", fmt.Errorf("scan column %q: %w", table, err)
		}

		colDef := fmt.Sprintf("  \"%s\" %s", name, dataType)
		if maxLen.Valid {
			colDef += fmt.Sprintf("(%d)", maxLen.Int64)
		}
		if nullable == "NO" {
			colDef += " NOT NULL"
		}
		if defaultVal.Valid {
			colDef += " DEFAULT " + defaultVal.String
		}
		cols = append(cols, colDef)
	}

	if len(cols) == 0 {
		return "", fmt.Errorf("table %q not found or has no columns", table)
	}

	ddl := fmt.Sprintf("CREATE TABLE \"%s\" (\n%s\n);", table, strings.Join(cols, ",\n"))
	return ddl, nil
}

// ─── MultiDatabaseDriver implementation ───

func (d *RedshiftDriver) Databases(ctx context.Context) ([]DatabaseInfo, error) {
	if d.db == nil {
		return nil, fmt.Errorf("not connected")
	}

	rows, err := d.db.QueryContext(ctx,
		`SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var databases []DatabaseInfo
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		databases = append(databases, DatabaseInfo{Name: name})
	}
	return databases, nil
}

func (d *RedshiftDriver) TablesInDB(ctx context.Context, database string) ([]TableInfo, error) {
	db, err := d.connectToDB(ctx, database)
	if err != nil {
		return nil, err
	}
	defer db.Close()

	query := `SELECT tablename AS name, 'table' AS type
		FROM pg_catalog.pg_tables
		WHERE schemaname = 'public'
		UNION ALL
		SELECT viewname AS name, 'view' AS type
		FROM pg_catalog.pg_views
		WHERE schemaname = 'public'
		ORDER BY name`

	rows, err := db.QueryContext(ctx, query)
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
		t.Schema = "public"
		tables = append(tables, t)
	}
	return tables, nil
}

func (d *RedshiftDriver) ColumnsInDB(ctx context.Context, database string, table string) ([]ColumnInfo, error) {
	db, err := d.connectToDB(ctx, database)
	if err != nil {
		return nil, err
	}
	defer db.Close()

	query := `SELECT column_name, data_type, is_nullable, column_default, ordinal_position
		FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = $1
		ORDER BY ordinal_position`

	rows, err := db.QueryContext(ctx, query, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var columns []ColumnInfo
	for rows.Next() {
		var c ColumnInfo
		var nullable string
		var defaultVal sql.NullString
		if err := rows.Scan(&c.Name, &c.Type, &nullable, &defaultVal, &c.OrdinalPos); err != nil {
			return nil, err
		}
		c.Nullable = nullable == "YES"
		if defaultVal.Valid {
			c.DefaultValue = defaultVal.String
		}
		columns = append(columns, c)
	}
	return columns, nil
}

func (d *RedshiftDriver) SwitchDatabase(ctx context.Context, database string) error {
	if d.db != nil {
		d.db.Close()
	}
	cfg := d.config
	cfg.Database = database
	return d.Connect(ctx, cfg)
}

func (d *RedshiftDriver) connectToDB(ctx context.Context, database string) (*sql.DB, error) {
	sslMode := d.config.SSLMode
	if sslMode == "" {
		sslMode = "require"
	}

	dsn := fmt.Sprintf("postgres://%s:%s@%s:%d/%s?sslmode=%s",
		d.config.Username, d.config.Password, d.config.Host, d.config.Port, database, sslMode)

	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to database %s: %w", database, err)
	}

	db.SetMaxOpenConns(2)
	db.SetMaxIdleConns(1)
	db.SetConnMaxLifetime(30 * time.Second)

	if err := db.PingContext(ctx); err != nil {
		db.Close()
		return nil, fmt.Errorf("failed to ping database %s: %w", database, err)
	}

	return db, nil
}
