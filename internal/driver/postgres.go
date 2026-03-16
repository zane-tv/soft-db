package driver

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
)

// PostgresDriver implements Driver for PostgreSQL
type PostgresDriver struct {
	db     *sql.DB
	config ConnectionConfig
}

func (d *PostgresDriver) Connect(ctx context.Context, cfg ConnectionConfig) error {
	d.config = cfg

	sslMode := cfg.SSLMode
	if sslMode == "" {
		sslMode = "disable"
	}

	// Default to "postgres" database if none specified (for multi-DB browsing)
	dbName := cfg.Database
	if dbName == "" {
		dbName = "postgres"
	}

	dsn := fmt.Sprintf("postgres://%s:%s@%s:%d/%s?sslmode=%s",
		cfg.Username, cfg.Password, cfg.Host, cfg.Port, dbName, sslMode)

	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return fmt.Errorf("failed to open postgres connection: %w", err)
	}

	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)

	if err := db.PingContext(ctx); err != nil {
		db.Close()
		return fmt.Errorf("failed to ping postgres: %w", err)
	}

	d.db = db
	return nil
}

func (d *PostgresDriver) Disconnect(ctx context.Context) error {
	if d.db != nil {
		return d.db.Close()
	}
	return nil
}

func (d *PostgresDriver) Ping(ctx context.Context) error {
	if d.db == nil {
		return fmt.Errorf("not connected")
	}
	return d.db.PingContext(ctx)
}

func (d *PostgresDriver) Execute(ctx context.Context, query string) (*QueryResult, error) {
	if d.db == nil {
		return nil, fmt.Errorf("not connected")
	}

	start := time.Now()
	trimmed := strings.TrimSpace(strings.ToUpper(query))

	if strings.HasPrefix(trimmed, "SELECT") || strings.HasPrefix(trimmed, "SHOW") ||
		strings.HasPrefix(trimmed, "EXPLAIN") || strings.HasPrefix(trimmed, "WITH") {
		return d.executeQuery(ctx, query, start)
	}

	return d.executeExec(ctx, query, start)
}

func (d *PostgresDriver) executeQuery(ctx context.Context, query string, start time.Time) (*QueryResult, error) {
	rows, err := d.db.QueryContext(ctx, query)
	if err != nil {
		return &QueryResult{Error: err.Error(), ExecutionTime: measureTime(start)}, nil
	}
	defer rows.Close()

	return scanRows(rows, start)
}

func (d *PostgresDriver) executeExec(ctx context.Context, query string, start time.Time) (*QueryResult, error) {
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

func (d *PostgresDriver) ExecuteArgs(ctx context.Context, query string, args ...interface{}) (*QueryResult, error) {
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

func (d *PostgresDriver) Tables(ctx context.Context) ([]TableInfo, error) {
	if d.db == nil {
		return nil, fmt.Errorf("not connected")
	}

	query := `SELECT table_name, table_type
		FROM information_schema.tables
		WHERE table_schema = 'public'
		ORDER BY table_name`

	rows, err := d.db.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tables []TableInfo
	for rows.Next() {
		var t TableInfo
		var tableType string
		if err := rows.Scan(&t.Name, &tableType); err != nil {
			return nil, err
		}
		if strings.Contains(tableType, "VIEW") {
			t.Type = "view"
		} else {
			t.Type = "table"
		}
		t.Schema = "public"
		tables = append(tables, t)
	}
	return tables, nil
}

func (d *PostgresDriver) Columns(ctx context.Context, table string) ([]ColumnInfo, error) {
	if d.db == nil {
		return nil, fmt.Errorf("not connected")
	}

	query := `SELECT c.column_name, c.data_type, c.is_nullable, c.column_default, c.ordinal_position,
		COALESCE(
			(SELECT 'YES' FROM information_schema.table_constraints tc
			 JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
			 WHERE tc.table_name = c.table_name AND kcu.column_name = c.column_name
			 AND tc.constraint_type = 'PRIMARY KEY' LIMIT 1), 'NO') as is_pk,
		COALESCE(
			(SELECT 'YES' FROM information_schema.table_constraints tc
			 JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
			 WHERE tc.table_name = c.table_name AND kcu.column_name = c.column_name
			 AND tc.constraint_type = 'UNIQUE' LIMIT 1), 'NO') as is_unique
		FROM information_schema.columns c
		WHERE c.table_schema = 'public' AND c.table_name = $1
		ORDER BY c.ordinal_position`

	rows, err := d.db.QueryContext(ctx, query, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var columns []ColumnInfo
	for rows.Next() {
		var c ColumnInfo
		var nullable, isPK, isUnique string
		var defaultVal sql.NullString
		if err := rows.Scan(&c.Name, &c.Type, &nullable, &defaultVal, &c.OrdinalPos, &isPK, &isUnique); err != nil {
			return nil, err
		}
		c.Nullable = nullable == "YES"
		c.PrimaryKey = isPK == "YES"
		c.Unique = isUnique == "YES" || c.PrimaryKey
		if defaultVal.Valid {
			c.DefaultValue = defaultVal.String
		}
		columns = append(columns, c)
	}
	return columns, nil
}

func (d *PostgresDriver) Views(ctx context.Context) ([]string, error) {
	if d.db == nil {
		return nil, fmt.Errorf("not connected")
	}

	rows, err := d.db.QueryContext(ctx,
		`SELECT table_name FROM information_schema.views WHERE table_schema = 'public' ORDER BY table_name`)
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

func (d *PostgresDriver) Functions(ctx context.Context) ([]FunctionInfo, error) {
	if d.db == nil {
		return nil, fmt.Errorf("not connected")
	}

	rows, err := d.db.QueryContext(ctx,
		`SELECT routine_name, routine_type FROM information_schema.routines
		 WHERE routine_schema = 'public' ORDER BY routine_name`)
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

func (d *PostgresDriver) Type() DatabaseType { return PostgreSQL }
func (d *PostgresDriver) IsConnected() bool  { return d.db != nil }

// ─── MultiDatabaseDriver implementation ───

func (d *PostgresDriver) Databases(ctx context.Context) ([]DatabaseInfo, error) {
	if d.db == nil {
		return nil, fmt.Errorf("not connected")
	}

	// If a specific database was configured, only return that one
	if d.config.Database != "" {
		return []DatabaseInfo{{Name: d.config.Database}}, nil
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

func (d *PostgresDriver) TablesInDB(ctx context.Context, database string) ([]TableInfo, error) {
	// PostgreSQL requires reconnect to query a different database
	db, err := d.connectToDB(ctx, database)
	if err != nil {
		return nil, err
	}
	defer db.Close()

	query := `SELECT table_name, table_type
		FROM information_schema.tables
		WHERE table_schema = 'public'
		ORDER BY table_name`

	rows, err := db.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tables []TableInfo
	for rows.Next() {
		var t TableInfo
		var tableType string
		if err := rows.Scan(&t.Name, &tableType); err != nil {
			return nil, err
		}
		if strings.Contains(tableType, "VIEW") {
			t.Type = "view"
		} else {
			t.Type = "table"
		}
		t.Schema = "public"
		tables = append(tables, t)
	}
	return tables, nil
}

func (d *PostgresDriver) ColumnsInDB(ctx context.Context, database string, table string) ([]ColumnInfo, error) {
	db, err := d.connectToDB(ctx, database)
	if err != nil {
		return nil, err
	}
	defer db.Close()

	query := `SELECT c.column_name, c.data_type, c.is_nullable, c.column_default, c.ordinal_position,
		COALESCE(
			(SELECT 'YES' FROM information_schema.table_constraints tc
			 JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
			 WHERE tc.table_name = c.table_name AND kcu.column_name = c.column_name
			 AND tc.constraint_type = 'PRIMARY KEY' LIMIT 1), 'NO') as is_pk,
		COALESCE(
			(SELECT 'YES' FROM information_schema.table_constraints tc
			 JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
			 WHERE tc.table_name = c.table_name AND kcu.column_name = c.column_name
			 AND tc.constraint_type = 'UNIQUE' LIMIT 1), 'NO') as is_unique
		FROM information_schema.columns c
		WHERE c.table_schema = 'public' AND c.table_name = $1
		ORDER BY c.ordinal_position`

	rows, err := db.QueryContext(ctx, query, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var columns []ColumnInfo
	for rows.Next() {
		var c ColumnInfo
		var nullable, isPK, isUnique string
		var defaultVal sql.NullString
		if err := rows.Scan(&c.Name, &c.Type, &nullable, &defaultVal, &c.OrdinalPos, &isPK, &isUnique); err != nil {
			return nil, err
		}
		c.Nullable = nullable == "YES"
		c.PrimaryKey = isPK == "YES"
		c.Unique = isUnique == "YES" || c.PrimaryKey
		if defaultVal.Valid {
			c.DefaultValue = defaultVal.String
		}
		columns = append(columns, c)
	}
	return columns, nil
}

func (d *PostgresDriver) SwitchDatabase(ctx context.Context, database string) error {
	// PostgreSQL requires a full reconnect to switch databases
	if d.db != nil {
		d.db.Close()
	}

	cfg := d.config
	cfg.Database = database
	return d.Connect(ctx, cfg)
}

// connectToDB creates a temporary connection to a specific database for cross-DB queries
func (d *PostgresDriver) connectToDB(ctx context.Context, database string) (*sql.DB, error) {
	sslMode := d.config.SSLMode
	if sslMode == "" {
		sslMode = "disable"
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
