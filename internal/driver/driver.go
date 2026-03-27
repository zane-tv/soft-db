package driver

import (
	"context"
	"database/sql"
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
	Redis      DatabaseType = "redis"
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
	FilePath string       `json:"filePath,omitempty"`
	URI      string       `json:"uri,omitempty"`
	SSLMode  string       `json:"sslMode,omitempty"`
	Status   string       `json:"status"`
	LastUsed string       `json:"lastUsed,omitempty"`

	SSHEnabled  bool   `json:"sshEnabled,omitempty"`
	SSHHost     string `json:"sshHost,omitempty"`
	SSHPort     int    `json:"sshPort,omitempty"`
	SSHUser     string `json:"sshUser,omitempty"`
	SSHPassword string `json:"sshPassword,omitempty"`
	SSHKeyPath  string `json:"sshKeyPath,omitempty"`

	SafeMode   bool `json:"safeMode,omitempty"`
	MCPEnabled bool `json:"mcpEnabled,omitempty"`
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

type StructureCapabilityNote struct {
	Code     string `json:"code"`
	Message  string `json:"message"`
	Severity string `json:"severity"`
}

type StructureOperationCapability struct {
	Supported            bool                      `json:"supported"`
	Destructive          bool                      `json:"destructive"`
	RequiresConfirmation bool                      `json:"requiresConfirmation"`
	Notes                []StructureCapabilityNote `json:"notes,omitempty"`
}

type StructureChangeCapabilities struct {
	DatabaseType           DatabaseType                 `json:"databaseType"`
	GeneralNotes           []StructureCapabilityNote    `json:"generalNotes,omitempty"`
	CreateTable            StructureOperationCapability `json:"createTable"`
	AddColumn              StructureOperationCapability `json:"addColumn"`
	RenameColumn           StructureOperationCapability `json:"renameColumn"`
	AlterColumnType        StructureOperationCapability `json:"alterColumnType"`
	AlterColumnDefault     StructureOperationCapability `json:"alterColumnDefault"`
	AlterColumnNullability StructureOperationCapability `json:"alterColumnNullability"`
	DropColumn             StructureOperationCapability `json:"dropColumn"`
}

type StructureChangeCapabilityDriver interface {
	GetStructureChangeCapabilities(ctx context.Context) (*StructureChangeCapabilities, error)
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
	case Redis:
		return &RedisDriver{}, nil
	default:
		return nil, fmt.Errorf("unsupported database type: %s", dbType)
	}
}

// measureTime returns elapsed milliseconds since start
func measureTime(start time.Time) float64 {
	return float64(time.Since(start).Microseconds()) / 1000.0
}

// TransactionalDriver is an optional interface for SQL drivers that support
// explicit transaction management. PostgreSQL, MySQL/MariaDB, and SQLite all
// implement this interface; MongoDB does not.
// Use type assertion drv.(TransactionalDriver) to check capability.
type TransactionalDriver interface {
	BeginTx(ctx context.Context, opts *sql.TxOptions) (*sql.Tx, error)
}

// IndexInfo describes a database index
type IndexInfo struct {
	Name      string   `json:"name"`
	TableName string   `json:"tableName"`
	Columns   []string `json:"columns"`
	IsUnique  bool     `json:"isUnique"`
	IsPrimary bool     `json:"isPrimary"`
}

// ForeignKeyInfo describes a foreign key constraint
type ForeignKeyInfo struct {
	Name             string `json:"name"`
	TableName        string `json:"tableName"`
	ColumnName       string `json:"columnName"`
	ReferencedTable  string `json:"referencedTable"`
	ReferencedColumn string `json:"referencedColumn"`
	OnUpdate         string `json:"onUpdate"`
	OnDelete         string `json:"onDelete"`
}

// IndexIntrospector is an optional interface for drivers that can enumerate indexes.
// database semantics are driver-specific: schema name for PostgreSQL, database name for MySQL,
// ignored for SQLite. Use type assertion drv.(IndexIntrospector) to check capability.
type IndexIntrospector interface {
	GetIndexes(database, table string) ([]IndexInfo, error)
}

// ForeignKeyIntrospector is an optional interface for drivers that can enumerate foreign keys.
// database semantics mirror IndexIntrospector conventions.
// Use type assertion drv.(ForeignKeyIntrospector) to check capability.
type ForeignKeyIntrospector interface {
	GetForeignKeys(database, table string) ([]ForeignKeyInfo, error)
}

// SchemaIntrospector is an optional interface for drivers that expose named schemas
// within a database (e.g. PostgreSQL schemas). The database parameter is accepted for
// API consistency but may be ignored by drivers already connected to a single database.
// Use type assertion drv.(SchemaIntrospector) to check capability.
type SchemaIntrospector interface {
	GetSchemas(database string) ([]string, error)
}

// ExportableDriver provides chunked data export capability
type ExportableDriver interface {
	// GetTableRowCount returns total row count for a table (for progress tracking)
	GetTableRowCount(table string) (int64, error)
	// GetTableRows returns rows for a table with LIMIT/OFFSET pagination
	GetTableRows(table string, limit, offset int) (*QueryResult, error)
	// GetCreateTableDDL returns CREATE TABLE DDL for SQL engines (empty string for MongoDB)
	GetCreateTableDDL(table string) (string, error)
}
