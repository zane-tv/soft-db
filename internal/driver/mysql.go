package driver

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	_ "github.com/go-sql-driver/mysql"
)

// MySQLDriver implements Driver for MySQL and MariaDB
type MySQLDriver struct {
	db     *sql.DB
	dbType DatabaseType
	config ConnectionConfig
}

func (d *MySQLDriver) Connect(ctx context.Context, cfg ConnectionConfig) error {
	d.config = cfg
	d.dbType = cfg.Type
	if d.dbType == "" {
		d.dbType = MySQL
	}

	dsn := fmt.Sprintf("%s:%s@tcp(%s:%d)/%s?parseTime=true",
		cfg.Username, cfg.Password, cfg.Host, cfg.Port, cfg.Database)

	db, err := sql.Open("mysql", dsn)
	if err != nil {
		return fmt.Errorf("failed to open mysql connection: %w", err)
	}

	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)

	if err := db.PingContext(ctx); err != nil {
		db.Close()
		return fmt.Errorf("failed to ping mysql: %w", err)
	}

	d.db = db
	return nil
}

func (d *MySQLDriver) Disconnect(ctx context.Context) error {
	if d.db != nil {
		return d.db.Close()
	}
	return nil
}

func (d *MySQLDriver) Ping(ctx context.Context) error {
	if d.db == nil {
		return fmt.Errorf("not connected")
	}
	return d.db.PingContext(ctx)
}

func (d *MySQLDriver) Execute(ctx context.Context, query string) (*QueryResult, error) {
	if d.db == nil {
		return nil, fmt.Errorf("not connected")
	}

	start := time.Now()
	trimmed := strings.TrimSpace(strings.ToUpper(query))

	// Check if it's a SELECT/SHOW/DESCRIBE query
	if strings.HasPrefix(trimmed, "SELECT") || strings.HasPrefix(trimmed, "SHOW") ||
		strings.HasPrefix(trimmed, "DESCRIBE") || strings.HasPrefix(trimmed, "EXPLAIN") {
		return d.executeQuery(ctx, query, start)
	}

	return d.executeExec(ctx, query, start)
}

func (d *MySQLDriver) executeQuery(ctx context.Context, query string, start time.Time) (*QueryResult, error) {
	rows, err := d.db.QueryContext(ctx, query)
	if err != nil {
		return &QueryResult{Error: err.Error(), ExecutionTime: measureTime(start)}, nil
	}
	defer rows.Close()

	return scanRows(rows, start)
}

func (d *MySQLDriver) executeExec(ctx context.Context, query string, start time.Time) (*QueryResult, error) {
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

func (d *MySQLDriver) ExecuteArgs(ctx context.Context, query string, args ...interface{}) (*QueryResult, error) {
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

func (d *MySQLDriver) Tables(ctx context.Context) ([]TableInfo, error) {
	if d.db == nil {
		return nil, fmt.Errorf("not connected")
	}

	query := `SELECT TABLE_NAME, TABLE_TYPE, TABLE_ROWS
		FROM information_schema.TABLES
		WHERE TABLE_SCHEMA = DATABASE()
		ORDER BY TABLE_NAME`

	rows, err := d.db.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tables []TableInfo
	for rows.Next() {
		var t TableInfo
		var tableType string
		var rowCount sql.NullInt64
		if err := rows.Scan(&t.Name, &tableType, &rowCount); err != nil {
			return nil, err
		}
		if strings.Contains(tableType, "VIEW") {
			t.Type = "view"
		} else {
			t.Type = "table"
		}
		if rowCount.Valid {
			t.RowCount = rowCount.Int64
		}
		tables = append(tables, t)
	}
	return tables, nil
}

func (d *MySQLDriver) Columns(ctx context.Context, table string) ([]ColumnInfo, error) {
	if d.db == nil {
		return nil, fmt.Errorf("not connected")
	}

	query := `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, EXTRA, ORDINAL_POSITION
		FROM information_schema.COLUMNS
		WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
		ORDER BY ORDINAL_POSITION`

	rows, err := d.db.QueryContext(ctx, query, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var columns []ColumnInfo
	for rows.Next() {
		var c ColumnInfo
		var nullable, key string
		var defaultVal, extra sql.NullString
		if err := rows.Scan(&c.Name, &c.Type, &nullable, &key, &defaultVal, &extra, &c.OrdinalPos); err != nil {
			return nil, err
		}
		c.Nullable = nullable == "YES"
		c.PrimaryKey = key == "PRI"
		c.Unique = key == "UNI" || key == "PRI"
		if defaultVal.Valid {
			c.DefaultValue = defaultVal.String
		}
		if extra.Valid {
			c.Extra = extra.String
		}
		columns = append(columns, c)
	}
	return columns, nil
}

func (d *MySQLDriver) Views(ctx context.Context) ([]string, error) {
	if d.db == nil {
		return nil, fmt.Errorf("not connected")
	}

	rows, err := d.db.QueryContext(ctx,
		`SELECT TABLE_NAME FROM information_schema.VIEWS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME`)
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

func (d *MySQLDriver) Functions(ctx context.Context) ([]FunctionInfo, error) {
	if d.db == nil {
		return nil, fmt.Errorf("not connected")
	}

	rows, err := d.db.QueryContext(ctx,
		`SELECT ROUTINE_NAME, ROUTINE_TYPE FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE() ORDER BY ROUTINE_NAME`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var funcs []FunctionInfo
	for rows.Next() {
		var f FunctionInfo
		if err := rows.Scan(&f.Name, &f.Type); err != nil {
			return nil, err
		}
		f.Type = strings.ToLower(f.Type)
		funcs = append(funcs, f)
	}
	return funcs, nil
}

func (d *MySQLDriver) Type() DatabaseType { return d.dbType }
func (d *MySQLDriver) IsConnected() bool  { return d.db != nil }

func (d *MySQLDriver) GetStructureChangeCapabilities(ctx context.Context) (*StructureChangeCapabilities, error) {
	return &StructureChangeCapabilities{
		DatabaseType: d.Type(),
		GeneralNotes: []StructureCapabilityNote{{
			Code:     "limited_ddl_transactions",
			Message:  "MySQL and MariaDB can auto-commit DDL, so multi-statement apply may leave partial changes behind",
			Severity: "warning",
		}},
		CreateTable: StructureOperationCapability{Supported: true},
		AddColumn:   StructureOperationCapability{Supported: true},
		RenameColumn: StructureOperationCapability{
			Supported: true,
			Notes: []StructureCapabilityNote{{
				Code:     "rename_column_version",
				Message:  "Rename-column syntax assumes a modern MySQL or MariaDB server",
				Severity: "warning",
			}},
		},
		AlterColumnType: StructureOperationCapability{
			Supported:            true,
			RequiresConfirmation: true,
			Notes: []StructureCapabilityNote{{
				Code:     "modify_column_rewrites_definition",
				Message:  "Type and nullability changes rebuild the full MySQL column definition from current schema metadata",
				Severity: "warning",
			}},
		},
		AlterColumnDefault: StructureOperationCapability{Supported: true},
		AlterColumnNullability: StructureOperationCapability{
			Supported: true,
			Notes: []StructureCapabilityNote{{
				Code:     "modify_column_rewrites_definition",
				Message:  "Nullability changes rebuild the full MySQL column definition from current schema metadata",
				Severity: "warning",
			}},
		},
		DropColumn: StructureOperationCapability{
			Supported:            true,
			Destructive:          true,
			RequiresConfirmation: true,
		},
	}, nil
}

// ─── MultiDatabaseDriver implementation ───

func (d *MySQLDriver) Databases(ctx context.Context) ([]DatabaseInfo, error) {
	if d.db == nil {
		return nil, fmt.Errorf("not connected")
	}

	// If a specific database was configured, only return that one
	if d.config.Database != "" {
		return []DatabaseInfo{{Name: d.config.Database}}, nil
	}

	systemDBs := map[string]bool{
		"information_schema": true, "performance_schema": true,
		"mysql": true, "sys": true,
	}

	rows, err := d.db.QueryContext(ctx, "SHOW DATABASES")
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
		if systemDBs[name] {
			continue
		}
		databases = append(databases, DatabaseInfo{Name: name})
	}
	return databases, nil
}

func (d *MySQLDriver) TablesInDB(ctx context.Context, database string) ([]TableInfo, error) {
	if d.db == nil {
		return nil, fmt.Errorf("not connected")
	}

	query := `SELECT TABLE_NAME, TABLE_TYPE, TABLE_ROWS
		FROM information_schema.TABLES
		WHERE TABLE_SCHEMA = ?
		ORDER BY TABLE_NAME`

	rows, err := d.db.QueryContext(ctx, query, database)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tables []TableInfo
	for rows.Next() {
		var t TableInfo
		var tableType string
		var rowCount sql.NullInt64
		if err := rows.Scan(&t.Name, &tableType, &rowCount); err != nil {
			return nil, err
		}
		if strings.Contains(tableType, "VIEW") {
			t.Type = "view"
		} else {
			t.Type = "table"
		}
		if rowCount.Valid {
			t.RowCount = rowCount.Int64
		}
		tables = append(tables, t)
	}
	return tables, nil
}

func (d *MySQLDriver) ColumnsInDB(ctx context.Context, database string, table string) ([]ColumnInfo, error) {
	if d.db == nil {
		return nil, fmt.Errorf("not connected")
	}

	query := `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, EXTRA, ORDINAL_POSITION
		FROM information_schema.COLUMNS
		WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
		ORDER BY ORDINAL_POSITION`

	rows, err := d.db.QueryContext(ctx, query, database, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var columns []ColumnInfo
	for rows.Next() {
		var c ColumnInfo
		var nullable, key string
		var defaultVal, extra sql.NullString
		if err := rows.Scan(&c.Name, &c.Type, &nullable, &key, &defaultVal, &extra, &c.OrdinalPos); err != nil {
			return nil, err
		}
		c.Nullable = nullable == "YES"
		c.PrimaryKey = key == "PRI"
		c.Unique = key == "UNI" || key == "PRI"
		if defaultVal.Valid {
			c.DefaultValue = defaultVal.String
		}
		if extra.Valid {
			c.Extra = extra.String
		}
		columns = append(columns, c)
	}
	return columns, nil
}

func (d *MySQLDriver) SwitchDatabase(ctx context.Context, database string) error {
	if d.db == nil {
		return fmt.Errorf("not connected")
	}
	_, err := d.db.ExecContext(ctx, "USE "+database)
	if err != nil {
		return fmt.Errorf("failed to switch database: %w", err)
	}
	d.config.Database = database
	return nil
}

// ─── ExportableDriver implementation ───

// Compile-time interface check
var _ ExportableDriver = (*MySQLDriver)(nil)

func (d *MySQLDriver) GetTableRowCount(table string) (int64, error) {
	if d.db == nil {
		return 0, fmt.Errorf("not connected")
	}

	var count int64
	query := fmt.Sprintf("SELECT COUNT(*) FROM `%s`", table)
	if err := d.db.QueryRow(query).Scan(&count); err != nil {
		return 0, fmt.Errorf("row count %q: %w", table, err)
	}
	return count, nil
}

func (d *MySQLDriver) GetTableRows(table string, limit, offset int) (*QueryResult, error) {
	if d.db == nil {
		return nil, fmt.Errorf("not connected")
	}

	start := time.Now()
	query := fmt.Sprintf("SELECT * FROM `%s` LIMIT ? OFFSET ?", table)
	rows, err := d.db.Query(query, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("table rows %q: %w", table, err)
	}
	defer rows.Close()

	return scanRows(rows, start)
}

func (d *MySQLDriver) GetCreateTableDDL(table string) (string, error) {
	if d.db == nil {
		return "", fmt.Errorf("not connected")
	}

	var tableName, ddl string
	query := fmt.Sprintf("SHOW CREATE TABLE `%s`", table)
	if err := d.db.QueryRow(query).Scan(&tableName, &ddl); err != nil {
		return "", fmt.Errorf("create table DDL %q: %w", table, err)
	}
	return ddl, nil
}
