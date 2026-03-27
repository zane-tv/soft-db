package driver

import (
	"context"
	"database/sql"
	"fmt"
	"net"
	"net/url"
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

	dsn := postgresDSN(cfg.Username, cfg.Password, cfg.Host, cfg.Port, dbName, sslMode)

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

func (d *PostgresDriver) BeginTx(ctx context.Context, opts *sql.TxOptions) (*sql.Tx, error) {
	if d.db == nil {
		return nil, fmt.Errorf("not connected")
	}
	return d.db.BeginTx(ctx, opts)
}

func (d *PostgresDriver) GetStructureChangeCapabilities(ctx context.Context) (*StructureChangeCapabilities, error) {
	return &StructureChangeCapabilities{
		DatabaseType: PostgreSQL,
		CreateTable:  StructureOperationCapability{Supported: true},
		AddColumn:    StructureOperationCapability{Supported: true},
		RenameColumn: StructureOperationCapability{Supported: true},
		AlterColumnType: StructureOperationCapability{
			Supported:            true,
			RequiresConfirmation: true,
			Notes: []StructureCapabilityNote{{
				Code:     "type_change_review",
				Message:  "PostgreSQL type conversions can fail or require table rewrites depending on existing data",
				Severity: "warning",
			}},
		},
		AlterColumnDefault:     StructureOperationCapability{Supported: true},
		AlterColumnNullability: StructureOperationCapability{Supported: true},
		DropColumn: StructureOperationCapability{
			Supported:            true,
			Destructive:          true,
			RequiresConfirmation: true,
		},
	}, nil
}

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

// ─── ExportableDriver implementation ───

var _ ExportableDriver = (*PostgresDriver)(nil)

func (d *PostgresDriver) GetTableRowCount(table string) (int64, error) {
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

func (d *PostgresDriver) GetTableRows(table string, limit, offset int) (*QueryResult, error) {
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

func (d *PostgresDriver) GetCreateTableDDL(table string) (string, error) {
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

func (d *PostgresDriver) connectToDB(ctx context.Context, database string) (*sql.DB, error) {
	sslMode := d.config.SSLMode
	if sslMode == "" {
		sslMode = "disable"
	}

	dsn := postgresDSN(d.config.Username, d.config.Password, d.config.Host, d.config.Port, database, sslMode)

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

// ─── IndexIntrospector implementation ───

var _ IndexIntrospector = (*PostgresDriver)(nil)

func (d *PostgresDriver) GetIndexes(schema, table string) ([]IndexInfo, error) {
	if d.db == nil {
		return nil, fmt.Errorf("not connected")
	}
	if schema == "" {
		schema = "public"
	}

	query := `
		SELECT i.relname, ix.indisunique, ix.indisprimary, a.attname
		FROM pg_class t
		JOIN pg_index ix ON t.oid = ix.indrelid
		JOIN pg_class i ON ix.indexrelid = i.oid
		JOIN pg_namespace n ON t.relnamespace = n.oid
		JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, pos) ON TRUE
		JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
		WHERE n.nspname = $1 AND t.relname = $2 AND k.attnum > 0
		ORDER BY i.relname, k.pos`

	rows, err := d.db.Query(query, schema, table)
	if err != nil {
		return nil, fmt.Errorf("get indexes %q: %w", table, err)
	}
	defer rows.Close()

	order := []string{}
	byName := map[string]*IndexInfo{}
	for rows.Next() {
		var name, col string
		var isUnique, isPrimary bool
		if err := rows.Scan(&name, &isUnique, &isPrimary, &col); err != nil {
			return nil, err
		}
		if _, ok := byName[name]; !ok {
			byName[name] = &IndexInfo{Name: name, TableName: table, IsUnique: isUnique, IsPrimary: isPrimary}
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

var _ ForeignKeyIntrospector = (*PostgresDriver)(nil)

func (d *PostgresDriver) GetForeignKeys(schema, table string) ([]ForeignKeyInfo, error) {
	if d.db == nil {
		return nil, fmt.Errorf("not connected")
	}
	if schema == "" {
		schema = "public"
	}

	query := `
		SELECT
			tc.constraint_name,
			kcu.column_name,
			ccu.table_name AS referenced_table,
			ccu.column_name AS referenced_column,
			rc.update_rule,
			rc.delete_rule
		FROM information_schema.table_constraints tc
		JOIN information_schema.key_column_usage kcu
			ON tc.constraint_name = kcu.constraint_name
			AND tc.constraint_schema = kcu.constraint_schema
		JOIN information_schema.constraint_column_usage ccu
			ON tc.constraint_name = ccu.constraint_name
			AND tc.constraint_schema = ccu.constraint_schema
		JOIN information_schema.referential_constraints rc
			ON tc.constraint_name = rc.constraint_name
			AND tc.constraint_schema = rc.constraint_schema
		WHERE tc.constraint_type = 'FOREIGN KEY'
			AND tc.table_schema = $1
			AND tc.table_name = $2
		ORDER BY tc.constraint_name, kcu.ordinal_position`

	rows, err := d.db.Query(query, schema, table)
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

// ─── SchemaIntrospector implementation ───

var _ SchemaIntrospector = (*PostgresDriver)(nil)

func (d *PostgresDriver) GetSchemas(_ string) ([]string, error) {
	if d.db == nil {
		return nil, fmt.Errorf("not connected")
	}

	rows, err := d.db.Query(`
		SELECT schema_name
		FROM information_schema.schemata
		WHERE schema_name NOT LIKE 'pg_%'
			AND schema_name != 'information_schema'
		ORDER BY schema_name`)
	if err != nil {
		return nil, fmt.Errorf("get schemas: %w", err)
	}
	defer rows.Close()

	var schemas []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		schemas = append(schemas, name)
	}
	return schemas, nil
}

func postgresDSN(username, password, host string, port int, database, sslMode string) string {
	u := &url.URL{
		Scheme: "postgres",
		User:   url.UserPassword(username, password),
		Host:   net.JoinHostPort(host, fmt.Sprint(port)),
		Path:   database,
	}

	q := u.Query()
	q.Set("sslmode", sslMode)
	u.RawQuery = q.Encode()

	return u.String()
}
