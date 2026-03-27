package driver

import (
	"context"
	"crypto/tls"
	"database/sql"
	"fmt"
	"strings"
	"time"

	mysql "github.com/go-sql-driver/mysql"
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

	tlsConfig, err := mysqlTLSConfig(cfg)
	if err != nil {
		return err
	}

	dsnConfig := mysql.NewConfig()
	dsnConfig.User = cfg.Username
	dsnConfig.Passwd = cfg.Password
	dsnConfig.Net = "tcp"
	dsnConfig.Addr = fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)
	dsnConfig.DBName = cfg.Database
	dsnConfig.ParseTime = true
	dsnConfig.TLSConfig = tlsConfig

	dsn := dsnConfig.FormatDSN()

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

func mysqlTLSConfig(cfg ConnectionConfig) (string, error) {
	switch cfg.SSLMode {
	case "", "disable":
		return "false", nil
	case "require":
		return "true", nil
	case "verify-ca", "verify-full":
		const tlsConfigName = "softdb-custom"
		if err := mysql.RegisterTLSConfig(tlsConfigName, &tls.Config{ServerName: cfg.Host}); err != nil && !strings.Contains(err.Error(), "already exists") {
			return "", fmt.Errorf("register mysql TLS config: %w", err)
		}
		return tlsConfigName, nil
	default:
		return cfg.SSLMode, nil
	}
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

func (d *MySQLDriver) BeginTx(ctx context.Context, opts *sql.TxOptions) (*sql.Tx, error) {
	if d.db == nil {
		return nil, fmt.Errorf("not connected")
	}
	return d.db.BeginTx(ctx, opts)
}

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

// ─── IndexIntrospector implementation ───

var _ IndexIntrospector = (*MySQLDriver)(nil)

func (d *MySQLDriver) GetIndexes(database, table string) ([]IndexInfo, error) {
	if d.db == nil {
		return nil, fmt.Errorf("not connected")
	}
	if database == "" {
		database = d.config.Database
	}

	query := `
		SELECT INDEX_NAME, NON_UNIQUE, COLUMN_NAME
		FROM information_schema.STATISTICS
		WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
		ORDER BY INDEX_NAME, SEQ_IN_INDEX`

	rows, err := d.db.Query(query, database, table)
	if err != nil {
		return nil, fmt.Errorf("get indexes %q: %w", table, err)
	}
	defer rows.Close()

	order := []string{}
	byName := map[string]*IndexInfo{}
	for rows.Next() {
		var name, col string
		var nonUnique int
		if err := rows.Scan(&name, &nonUnique, &col); err != nil {
			return nil, err
		}
		if _, ok := byName[name]; !ok {
			byName[name] = &IndexInfo{
				Name:      name,
				TableName: table,
				IsUnique:  nonUnique == 0,
				IsPrimary: name == "PRIMARY",
			}
			order = append(order, name)
		}
		byName[name].Columns = append(byName[name].Columns, col)
	}
	result := make([]IndexInfo, 0, len(order))
	for _, name := range order {
		result = append(result, *byName[name])
	}
	return result, nil
}

// ─── ForeignKeyIntrospector implementation ───

var _ ForeignKeyIntrospector = (*MySQLDriver)(nil)

func (d *MySQLDriver) GetForeignKeys(database, table string) ([]ForeignKeyInfo, error) {
	if d.db == nil {
		return nil, fmt.Errorf("not connected")
	}
	if database == "" {
		database = d.config.Database
	}

	query := `
		SELECT
			kcu.CONSTRAINT_NAME,
			kcu.COLUMN_NAME,
			kcu.REFERENCED_TABLE_NAME,
			kcu.REFERENCED_COLUMN_NAME,
			rc.UPDATE_RULE,
			rc.DELETE_RULE
		FROM information_schema.KEY_COLUMN_USAGE kcu
		JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
			ON kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
			AND kcu.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA
		WHERE kcu.TABLE_SCHEMA = ?
			AND kcu.TABLE_NAME = ?
			AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
		ORDER BY kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION`

	rows, err := d.db.Query(query, database, table)
	if err != nil {
		return nil, fmt.Errorf("get foreign keys %q: %w", table, err)
	}
	defer rows.Close()

	var fks []ForeignKeyInfo
	for rows.Next() {
		var fk ForeignKeyInfo
		fk.TableName = table
		if err := rows.Scan(&fk.Name, &fk.ColumnName, &fk.ReferencedTable, &fk.ReferencedColumn, &fk.OnUpdate, &fk.OnDelete); err != nil {
			return nil, err
		}
		fks = append(fks, fk)
	}
	return fks, nil
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
