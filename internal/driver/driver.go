package driver

import (
	"context"
	"fmt"
	"time"
)

// DatabaseType represents supported database types
type DatabaseType string

const (
	MySQL      DatabaseType = "mysql"
	MariaDB    DatabaseType = "mariadb"
	PostgreSQL DatabaseType = "postgresql"
	SQLite     DatabaseType = "sqlite"
	MongoDB    DatabaseType = "mongodb"
	Redshift   DatabaseType = "redshift"
)

// ConnectionConfig holds connection parameters
type ConnectionConfig struct {
	ID       string       `json:"id"`
	Name     string       `json:"name"`
	Type     DatabaseType `json:"type"`
	Host     string       `json:"host"`
	Port     int          `json:"port"`
	Database string       `json:"database"`
	Username string       `json:"username"`
	Password string       `json:"password"`
	FilePath string       `json:"filePath,omitempty"` // For SQLite
	SSLMode  string       `json:"sslMode,omitempty"`
	Status   string       `json:"status"` // connected, idle, offline
	LastUsed string       `json:"lastUsed,omitempty"`
}

// QueryResult is returned from query execution
type QueryResult struct {
	Columns       []ColumnMeta             `json:"columns"`
	Rows          []map[string]interface{} `json:"rows"`
	RowCount      int64                    `json:"rowCount"`
	AffectedRows  int64                    `json:"affectedRows"`
	ExecutionTime float64                  `json:"executionTime"` // milliseconds
	Error         string                   `json:"error,omitempty"`
}

// ColumnMeta describes a result column
type ColumnMeta struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

// TableInfo describes a table or view
type TableInfo struct {
	Name     string `json:"name"`
	Type     string `json:"type"` // table, view
	Schema   string `json:"schema,omitempty"`
	RowCount int64  `json:"rowCount,omitempty"`
}

// ColumnInfo describes a table column's schema
type ColumnInfo struct {
	Name         string `json:"name"`
	Type         string `json:"type"`
	Nullable     bool   `json:"nullable"`
	PrimaryKey   bool   `json:"primaryKey"`
	Unique       bool   `json:"unique"`
	DefaultValue string `json:"defaultValue,omitempty"`
	Extra        string `json:"extra,omitempty"`
	OrdinalPos   int    `json:"ordinalPos"`
}

// FunctionInfo describes a stored function/procedure
type FunctionInfo struct {
	Name string `json:"name"`
	Type string `json:"type"` // function, procedure
}

// Driver is the unified interface all database adapters implement
type Driver interface {
	// Connect opens a connection using the config
	Connect(ctx context.Context, cfg ConnectionConfig) error
	// Disconnect closes the connection
	Disconnect(ctx context.Context) error
	// Ping tests the connection
	Ping(ctx context.Context) error
	// Execute runs a query and returns results
	Execute(ctx context.Context, query string) (*QueryResult, error)
	// Tables returns all tables in the database
	Tables(ctx context.Context) ([]TableInfo, error)
	// Columns returns columns for a given table
	Columns(ctx context.Context, table string) ([]ColumnInfo, error)
	// Views returns all views
	Views(ctx context.Context) ([]string, error)
	// Functions returns all functions/procedures
	Functions(ctx context.Context) ([]FunctionInfo, error)
	// Type returns the database type
	Type() DatabaseType
	// IsConnected returns whether the driver has an active connection
	IsConnected() bool
}

// NewDriver creates a new driver instance for the given database type
func NewDriver(dbType DatabaseType) (Driver, error) {
	switch dbType {
	case MySQL, MariaDB:
		return &MySQLDriver{}, nil
	case PostgreSQL:
		return &PostgresDriver{}, nil
	case SQLite:
		return &SQLiteDriver{}, nil
	case MongoDB:
		return &MongoDriver{}, nil
	case Redshift:
		return &RedshiftDriver{}, nil
	default:
		return nil, fmt.Errorf("unsupported database type: %s", dbType)
	}
}

// measureTime returns elapsed milliseconds since start
func measureTime(start time.Time) float64 {
	return float64(time.Since(start).Microseconds()) / 1000.0
}
