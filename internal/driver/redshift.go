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

	dsn := fmt.Sprintf("postgres://%s:%s@%s:%d/%s?sslmode=%s",
		cfg.Username, cfg.Password, cfg.Host, cfg.Port, cfg.Database, sslMode)

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
