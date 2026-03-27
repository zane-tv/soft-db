package services

import "soft-db/internal/driver"

// SafeConnectionInfo is a credential-stripped view of ConnectionConfig for MCP responses.
// It intentionally omits: Password, SSHPassword, SSHKeyPath, URI, Username.
type SafeConnectionInfo struct {
	ID         string              `json:"id"`
	Name       string              `json:"name"`
	Type       driver.DatabaseType `json:"type"`
	Host       string              `json:"host"`
	Port       int                 `json:"port"`
	Database   string              `json:"database"`
	SSLMode    string              `json:"sslMode,omitempty"`
	SSHEnabled bool                `json:"sshEnabled"`
	SafeMode   bool                `json:"safeMode"`
	MCPEnabled bool                `json:"mcpEnabled"`
	Connected  bool                `json:"connected"`
}

// ToSafeConnectionInfo converts a ConnectionConfig to a credential-free SafeConnectionInfo.
func ToSafeConnectionInfo(cfg driver.ConnectionConfig, connected bool) SafeConnectionInfo {
	return SafeConnectionInfo{
		ID:         cfg.ID,
		Name:       cfg.Name,
		Type:       cfg.Type,
		Host:       cfg.Host,
		Port:       cfg.Port,
		Database:   cfg.Database,
		SSLMode:    cfg.SSLMode,
		SSHEnabled: cfg.SSHEnabled,
		SafeMode:   cfg.SafeMode,
		MCPEnabled: cfg.MCPEnabled,
		Connected:  connected,
	}
}

// ToSafeConnectionInfoList converts a slice of ConnectionConfig to SafeConnectionInfo,
// using connectedIDs to determine connection status.
func ToSafeConnectionInfoList(cfgs []driver.ConnectionConfig, connectedIDs map[string]bool) []SafeConnectionInfo {
	result := make([]SafeConnectionInfo, 0, len(cfgs))
	for _, cfg := range cfgs {
		result = append(result, ToSafeConnectionInfo(cfg, connectedIDs[cfg.ID]))
	}
	return result
}

// UseConnectionInput is the input for the use_connection MCP tool.
type UseConnectionInput struct {
	ConnectionID string `json:"connection_id" jsonschema:"description=UUID of the connection to activate,required"`
}

// ListTablesInput is the input for the list_tables MCP tool.
type ListTablesInput struct {
	Database string `json:"database,omitempty" jsonschema:"description=Optional database name for multi-DB connections (PostgreSQL/MySQL/MongoDB)"`
}

// DescribeTableInput is the input for the describe_table MCP tool.
type DescribeTableInput struct {
	Table    string `json:"table" jsonschema:"description=Table name to describe,required"`
	Database string `json:"database,omitempty" jsonschema:"description=Optional database name for multi-DB connections"`
}

// ExecuteQueryInput is the input for the execute_query MCP tool.
type ExecuteQueryInput struct {
	Query string `json:"query" jsonschema:"description=Query to execute. Use SQL for relational databases. Use JSON query syntax for MongoDB. Use Redis commands for Redis.,required"`
}

// ReadTableInput is the input for the read_table MCP tool.
type ReadTableInput struct {
	Table    string `json:"table" jsonschema:"description=Table name to read,required"`
	Page     int    `json:"page,omitempty" jsonschema:"description=Page number (1-based). Defaults to 1."`
	PageSize int    `json:"page_size,omitempty" jsonschema:"description=Rows per page. Defaults to 50. Maximum 1000."`
	Database string `json:"database,omitempty" jsonschema:"description=Optional database name for multi-DB connections"`
}

// GetRelationshipsInput is the input for the get_relationships MCP tool.
type GetRelationshipsInput struct {
	Database string `json:"database,omitempty" jsonschema:"description=Optional database name for multi-DB connections"`
}
