package services

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"

	"soft-db/internal/driver"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const mcpMaxRows = 1000

type mcpState struct {
	mu                 sync.RWMutex
	activeConnectionID string
}

var globalMCPState = &mcpState{}

func (s *mcpState) get() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.activeConnectionID
}

func (s *mcpState) set(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.activeConnectionID = id
}

type MCPHandlers struct {
	connService     *ConnectionService
	queryService    *QueryService
	schemaService   *SchemaService
	settingsService *SettingsService
	state           *mcpState
}

func newMCPHandlers(cs *ConnectionService, qs *QueryService, ss *SchemaService, sets *SettingsService) *MCPHandlers {
	return &MCPHandlers{
		connService:     cs,
		queryService:    qs,
		schemaService:   ss,
		settingsService: sets,
		state:           globalMCPState,
	}
}

func (h *MCPHandlers) activeID() string {
	return h.state.get()
}

func toolError(msg string) *mcp.CallToolResult {
	return &mcp.CallToolResult{
		Content: []mcp.Content{&mcp.TextContent{Text: msg}},
		IsError: true,
	}
}

func toolText(text string) *mcp.CallToolResult {
	return &mcp.CallToolResult{
		Content: []mcp.Content{&mcp.TextContent{Text: text}},
	}
}

func noActiveConnectionResult() *mcp.CallToolResult {
	return toolError("No active connection. Call use_connection first.")
}

func jsonText(v any) *mcp.CallToolResult {
	b, err := json.Marshal(v)
	if err != nil {
		return toolError(fmt.Sprintf("failed to marshal response: %v", err))
	}
	return toolText(string(b))
}

func parseArgs[T any](req *mcp.CallToolRequest) (T, error) {
	var input T
	if req.Params == nil || len(req.Params.Arguments) == 0 {
		return input, nil
	}
	if err := json.Unmarshal(req.Params.Arguments, &input); err != nil {
		return input, fmt.Errorf("invalid arguments: %w", err)
	}
	return input, nil
}

func (h *MCPHandlers) handleListConnections(ctx context.Context, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	conns, err := h.connService.ListConnections()
	if err != nil {
		return toolError(fmt.Sprintf("failed to list connections: %v", err)), nil
	}

	connectedIDs := make(map[string]bool)
	for _, c := range conns {
		connectedIDs[c.ID] = c.Status == "connected"
	}

	mcpConns := make([]SafeConnectionInfo, 0)
	for _, c := range conns {
		if c.MCPEnabled {
			mcpConns = append(mcpConns, ToSafeConnectionInfo(c, connectedIDs[c.ID]))
		}
	}

	return jsonText(mcpConns), nil
}

func (h *MCPHandlers) handleUseConnection(ctx context.Context, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	input, err := parseArgs[UseConnectionInput](req)
	if err != nil {
		return toolError(err.Error()), nil
	}
	if input.ConnectionID == "" {
		return toolError("connection_id is required"), nil
	}

	conns, err := h.connService.ListConnections()
	if err != nil {
		return toolError(fmt.Sprintf("failed to list connections: %v", err)), nil
	}

	var found *driver.ConnectionConfig
	for i, c := range conns {
		if c.ID == input.ConnectionID {
			found = &conns[i]
			break
		}
	}

	if found == nil {
		var available []string
		for _, c := range conns {
			if c.MCPEnabled {
				available = append(available, fmt.Sprintf("%s (%s)", c.Name, c.ID))
			}
		}
		msg := fmt.Sprintf("connection not found: %s", input.ConnectionID)
		if len(available) > 0 {
			msg += ". Available MCP-enabled connections: " + strings.Join(available, ", ")
		}
		return toolError(msg), nil
	}

	if !found.MCPEnabled {
		return toolError(fmt.Sprintf("connection %q is not enabled for MCP. Enable it in the app settings.", found.Name)), nil
	}

	if found.Status != "connected" {
		if err := h.connService.Connect(found.ID); err != nil {
			return toolError(fmt.Sprintf("failed to connect to %q: %v", found.Name, err)), nil
		}
	}

	h.state.set(found.ID)

	info := ToSafeConnectionInfo(*found, true)
	return jsonText(map[string]any{
		"message":    fmt.Sprintf("Connected to %q (%s)", found.Name, found.Type),
		"connection": info,
	}), nil
}

func (h *MCPHandlers) handleListDatabases(ctx context.Context, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	id := h.activeID()
	if id == "" {
		return noActiveConnectionResult(), nil
	}

	dbs, err := h.schemaService.GetDatabases(id)
	if err != nil {
		if strings.Contains(err.Error(), "does not support multi-database") {
			return jsonText(map[string]any{
				"message":   "This connection type does not support multiple databases.",
				"databases": []any{},
			}), nil
		}
		return toolError(fmt.Sprintf("failed to list databases: %v", err)), nil
	}

	return jsonText(map[string]any{
		"databases": dbs,
	}), nil
}

func (h *MCPHandlers) handleListTables(ctx context.Context, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	id := h.activeID()
	if id == "" {
		return noActiveConnectionResult(), nil
	}

	input, err := parseArgs[ListTablesInput](req)
	if err != nil {
		return toolError(err.Error()), nil
	}

	var tables []driver.TableInfo

	if input.Database != "" {
		tables, err = h.schemaService.GetTablesForDB(id, input.Database)
		if err != nil && strings.Contains(err.Error(), "does not support multi-database") {
			tables, err = h.schemaService.GetTables(id)
		}
	} else {
		tables, err = h.schemaService.GetTables(id)
	}

	if err != nil {
		return toolError(fmt.Sprintf("failed to list tables: %v", err)), nil
	}

	if tables == nil {
		tables = []driver.TableInfo{}
	}

	return jsonText(map[string]any{
		"tables": tables,
		"count":  len(tables),
	}), nil
}

func (h *MCPHandlers) handleDescribeTable(ctx context.Context, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	id := h.activeID()
	if id == "" {
		return noActiveConnectionResult(), nil
	}

	input, err := parseArgs[DescribeTableInput](req)
	if err != nil {
		return toolError(err.Error()), nil
	}
	if input.Table == "" {
		return toolError("table is required"), nil
	}

	var cols []driver.ColumnInfo

	if input.Database != "" {
		cols, err = h.schemaService.GetColumnsForDB(id, input.Database, input.Table)
		if err != nil && strings.Contains(err.Error(), "does not support multi-database") {
			cols, err = h.schemaService.GetColumns(id, input.Table)
		}
	} else {
		cols, err = h.schemaService.GetColumns(id, input.Table)
	}

	if err != nil {
		return toolError(fmt.Sprintf("failed to describe table %q: %v", input.Table, err)), nil
	}

	if cols == nil {
		cols = []driver.ColumnInfo{}
	}

	return jsonText(map[string]any{
		"table":   input.Table,
		"columns": cols,
		"count":   len(cols),
	}), nil
}

func (h *MCPHandlers) handleExecuteQuery(ctx context.Context, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	id := h.activeID()
	if id == "" {
		return noActiveConnectionResult(), nil
	}

	input, err := parseArgs[ExecuteQueryInput](req)
	if err != nil {
		return toolError(err.Error()), nil
	}
	if input.Query == "" {
		return toolError("query is required"), nil
	}

	conns, err := h.connService.ListConnections()
	if err != nil {
		return toolError(fmt.Sprintf("failed to get connection config: %v", err)), nil
	}

	var cfg *driver.ConnectionConfig
	for i, c := range conns {
		if c.ID == id {
			cfg = &conns[i]
			break
		}
	}

	if cfg != nil && cfg.SafeMode {
		if isDestructiveQuery(input.Query, cfg.Type) {
			return toolError(fmt.Sprintf(
				"query blocked by SafeMode: destructive operations (DROP, TRUNCATE, DELETE/UPDATE without WHERE) are not allowed. Query: %q",
				truncateStr(input.Query, 200),
			)), nil
		}
	}

	result, err := h.queryService.ExecuteQuery(id, input.Query)
	if err != nil {
		return toolError(fmt.Sprintf("query failed: %v", err)), nil
	}

	if result.Error != "" {
		return toolError(fmt.Sprintf("query error: %s", result.Error)), nil
	}

	rows := result.Rows
	totalRows := result.RowCount
	truncated := false
	truncationMsg := ""

	if int64(len(rows)) > mcpMaxRows {
		rows = rows[:mcpMaxRows]
		truncated = true
		truncationMsg = fmt.Sprintf("[truncated: showing %d of %d rows]", mcpMaxRows, totalRows)
	}

	response := map[string]any{
		"columns":        result.Columns,
		"rows":           rows,
		"row_count":      len(rows),
		"affected_rows":  result.AffectedRows,
		"execution_time": result.ExecutionTime,
	}
	if truncated {
		response["truncated"] = true
		response["total_rows"] = totalRows
		response["truncation_message"] = truncationMsg
	}

	return jsonText(response), nil
}

func (h *MCPHandlers) handleReadTable(ctx context.Context, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	id := h.activeID()
	if id == "" {
		return noActiveConnectionResult(), nil
	}

	input, err := parseArgs[ReadTableInput](req)
	if err != nil {
		return toolError(err.Error()), nil
	}
	if input.Table == "" {
		return toolError("table is required"), nil
	}

	page := input.Page
	if page < 1 {
		page = 1
	}
	pageSize := input.PageSize
	if pageSize < 1 {
		pageSize = 50
	}
	if pageSize > mcpMaxRows {
		pageSize = mcpMaxRows
	}

	result, err := h.queryService.ExecutePaginatedQuery(id, input.Table, page, pageSize)
	if err != nil {
		return toolError(fmt.Sprintf("failed to read table %q: %v", input.Table, err)), nil
	}

	return jsonText(map[string]any{
		"table":       input.Table,
		"columns":     result.Columns,
		"rows":        result.Rows,
		"row_count":   len(result.Rows),
		"total_rows":  result.TotalRows,
		"page":        result.Page,
		"page_size":   result.PageSize,
		"total_pages": result.TotalPages,
	}), nil
}

func (h *MCPHandlers) handleGetRelationships(ctx context.Context, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	id := h.activeID()
	if id == "" {
		return noActiveConnectionResult(), nil
	}

	input, err := parseArgs[GetRelationshipsInput](req)
	if err != nil {
		return toolError(err.Error()), nil
	}

	conns, err := h.connService.ListConnections()
	if err != nil {
		return toolError(fmt.Sprintf("failed to get connection info: %v", err)), nil
	}

	var connType driver.DatabaseType
	for _, c := range conns {
		if c.ID == id {
			connType = c.Type
			break
		}
	}

	if connType == driver.MongoDB || connType == driver.Redis {
		return jsonText(map[string]any{
			"message":       fmt.Sprintf("Foreign key relationships are not available for %s connections.", connType),
			"relationships": []any{},
		}), nil
	}

	tables, err := h.schemaService.GetTables(id)
	if err != nil {
		return toolError(fmt.Sprintf("failed to list tables: %v", err)), nil
	}

	db := input.Database
	allFKs := make([]driver.ForeignKeyInfo, 0)
	for _, t := range tables {
		fks, err := h.schemaService.GetTableForeignKeys(id, db, t.Name)
		if err != nil {
			continue
		}
		allFKs = append(allFKs, fks...)
	}

	return jsonText(map[string]any{
		"relationships": allFKs,
		"count":         len(allFKs),
	}), nil
}

func truncateStr(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max] + "..."
}
