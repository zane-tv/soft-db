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
	URI      string       `json:"uri,omitempty"`      // Direct connection string (MongoDB)
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
	// ExecuteArgs runs a parameterized query with args (for safe mutations)
	ExecuteArgs(ctx context.Context, query string, args ...interface{}) (*QueryResult, error)
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

// DatabaseInfo describes a database on the server
type DatabaseInfo struct {
	Name      string `json:"name"`
	SizeBytes int64  `json:"sizeBytes,omitempty"`
	Empty     bool   `json:"empty,omitempty"`
}

// MultiDatabaseDriver is an optional interface that drivers implement
// to support browsing and switching between multiple databases on a server.
// Use type assertion drv.(MultiDatabaseDriver) to check capability.
type MultiDatabaseDriver interface {
	// Databases returns all databases on the connected server
	Databases(ctx context.Context) ([]DatabaseInfo, error)
	// TablesInDB returns tables for a specific database
	TablesInDB(ctx context.Context, database string) ([]TableInfo, error)
	// ColumnsInDB returns columns for a table in a specific database
	ColumnsInDB(ctx context.Context, database string, table string) ([]ColumnInfo, error)
	// SwitchDatabase changes the active database for subsequent queries
	SwitchDatabase(ctx context.Context, database string) error
}

// SchemaValidationDriver is an optional interface for drivers that support
// schema validation (e.g. MongoDB JSON Schema Validation).
// Use type assertion drv.(SchemaValidationDriver) to check capability.
type SchemaValidationDriver interface {
	// GetCollectionValidator retrieves the current JSON Schema validator
	GetCollectionValidator(ctx context.Context, database, collection string) (map[string]interface{}, error)
	// SetCollectionValidator applies a JSON Schema validator
	SetCollectionValidator(ctx context.Context, database, collection string, schema map[string]interface{}) error
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
