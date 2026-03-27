package services

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"strings"
	"testing"

	"soft-db/internal/driver"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func listenRandomPort() (net.Listener, error) {
	return net.Listen("tcp", "127.0.0.1:0")
}

func newMCPHandlersForTest(t *testing.T, connID string, drv driver.Driver, safeModeOn bool) (*MCPHandlers, *ConnectionService) {
	t.Helper()
	cs := newConnServiceWithDriver(t, connID, drv)
	if connID != "" && safeModeOn {
		cs.mu.Lock()
		cfg := cs.configs[connID]
		cfg.SafeMode = true
		cs.configs[connID] = cfg
		cs.mu.Unlock()
	}
	s := newTestStore(t)
	ss := NewSettingsService(s)
	qs := NewQueryService(cs, ss, s)
	schemaS := NewSchemaService(cs)
	state := &mcpState{}
	return &MCPHandlers{
		connService:     cs,
		queryService:    qs,
		schemaService:   schemaS,
		settingsService: ss,
		state:           state,
	}, cs
}

func makeReq(args any) *mcp.CallToolRequest {
	req := &mcp.CallToolRequest{}
	if args != nil {
		b, _ := json.Marshal(args)
		req.Params = &mcp.CallToolParamsRaw{Arguments: b}
	}
	return req
}

func TestMCPHandlers_ListConnections_FiltersDisabled(t *testing.T) {
	t.Parallel()

	s := newTestStore(t)
	ss := NewSettingsService(s)
	cs := NewConnectionService(s, ss)

	cfg1 := driver.ConnectionConfig{ID: "conn-1", Name: "Enabled DB", Type: driver.PostgreSQL, MCPEnabled: true}
	cfg2 := driver.ConnectionConfig{ID: "conn-2", Name: "Disabled DB", Type: driver.MySQL, MCPEnabled: false}
	if _, err := cs.SaveConnection(cfg1); err != nil {
		t.Fatalf("save conn1: %v", err)
	}
	if _, err := cs.SaveConnection(cfg2); err != nil {
		t.Fatalf("save conn2: %v", err)
	}

	qs := NewQueryService(cs, ss, s)
	schemaS := NewSchemaService(cs)
	h := &MCPHandlers{connService: cs, queryService: qs, schemaService: schemaS, settingsService: ss, state: &mcpState{}}

	result, err := h.handleListConnections(context.Background(), makeReq(nil))
	if err != nil {
		t.Fatalf("handleListConnections: %v", err)
	}
	if result.IsError {
		t.Fatalf("unexpected error: %s", result.Content[0].(*mcp.TextContent).Text)
	}

	var conns []SafeConnectionInfo
	if err := json.Unmarshal([]byte(result.Content[0].(*mcp.TextContent).Text), &conns); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if len(conns) != 1 {
		t.Fatalf("expected 1 MCP-enabled connection, got %d", len(conns))
	}
	if conns[0].ID != "conn-1" {
		t.Errorf("expected conn-1, got %s", conns[0].ID)
	}
}

func TestMCPHandlers_ListConnections_NoCredentials(t *testing.T) {
	t.Parallel()

	s := newTestStore(t)
	ss := NewSettingsService(s)
	cs := NewConnectionService(s, ss)

	cfg := driver.ConnectionConfig{
		ID: "conn-1", Name: "Test", Type: driver.PostgreSQL, MCPEnabled: true,
		Password: "secret", SSHPassword: "sshsecret", SSHKeyPath: "/key",
	}
	if _, err := cs.SaveConnection(cfg); err != nil {
		t.Fatalf("save: %v", err)
	}

	qs := NewQueryService(cs, ss, s)
	schemaS := NewSchemaService(cs)
	h := &MCPHandlers{connService: cs, queryService: qs, schemaService: schemaS, settingsService: ss, state: &mcpState{}}

	result, _ := h.handleListConnections(context.Background(), makeReq(nil))
	text := result.Content[0].(*mcp.TextContent).Text

	if strings.Contains(text, "secret") {
		t.Error("response contains password 'secret'")
	}
	if strings.Contains(text, "sshsecret") {
		t.Error("response contains SSH password 'sshsecret'")
	}
	if strings.Contains(text, "/key") {
		t.Error("response contains SSH key path '/key'")
	}
}

func TestMCPHandlers_UseConnection_InvalidID(t *testing.T) {
	t.Parallel()

	h, _ := newMCPHandlersForTest(t, "conn-1", &mockDriver{dbType: driver.PostgreSQL, isConnected: true}, false)

	result, err := h.handleUseConnection(context.Background(), makeReq(UseConnectionInput{ConnectionID: "nonexistent"}))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.IsError {
		t.Fatal("expected error result for invalid connection ID")
	}
	text := result.Content[0].(*mcp.TextContent).Text
	if !strings.Contains(text, "not found") {
		t.Errorf("expected 'not found' in error, got: %s", text)
	}
}

func TestMCPHandlers_ExecuteQuery_SafeMode_Blocks(t *testing.T) {
	t.Parallel()

	s := newTestStore(t)
	ss := NewSettingsService(s)
	cs := NewConnectionService(s, ss)

	cfg := driver.ConnectionConfig{
		ID: "conn-safe", Name: "SafeDB", Type: driver.PostgreSQL,
		MCPEnabled: true, SafeMode: true,
	}
	if _, err := cs.SaveConnection(cfg); err != nil {
		t.Fatalf("save: %v", err)
	}

	drv := &mockDriver{dbType: driver.PostgreSQL, isConnected: true}
	cs.mu.Lock()
	cs.drivers["conn-safe"] = drv
	cs.configs["conn-safe"] = cfg
	cs.mu.Unlock()

	qs := NewQueryService(cs, ss, s)
	schemaS := NewSchemaService(cs)
	state := &mcpState{}
	state.set("conn-safe")
	h := &MCPHandlers{connService: cs, queryService: qs, schemaService: schemaS, settingsService: ss, state: state}

	result, err := h.handleExecuteQuery(context.Background(), makeReq(ExecuteQueryInput{Query: "DROP TABLE users"}))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.IsError {
		t.Fatal("expected SafeMode to block DROP TABLE")
	}
	text := result.Content[0].(*mcp.TextContent).Text
	if !strings.Contains(text, "SafeMode") {
		t.Errorf("expected 'SafeMode' in error message, got: %s", text)
	}
}

func TestMCPHandlers_ExecuteQuery_SafeMode_AllowsSelect(t *testing.T) {
	t.Parallel()

	drv := &mockDriver{
		dbType:      driver.PostgreSQL,
		isConnected: true,
		executeFunc: func(_ context.Context, _ string) (*driver.QueryResult, error) {
			return &driver.QueryResult{
				Columns:  []driver.ColumnMeta{{Name: "result", Type: "integer"}},
				Rows:     []map[string]interface{}{{"result": 1}},
				RowCount: 1,
			}, nil
		},
	}
	h, cs := newMCPHandlersForTest(t, "conn-1", drv, true)

	cs.mu.Lock()
	cfg := cs.configs["conn-1"]
	cfg.MCPEnabled = true
	cs.configs["conn-1"] = cfg
	cs.mu.Unlock()

	h.state.set("conn-1")

	result, err := h.handleExecuteQuery(context.Background(), makeReq(ExecuteQueryInput{Query: "SELECT 1"}))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.IsError {
		t.Fatalf("SELECT should not be blocked by SafeMode: %s", result.Content[0].(*mcp.TextContent).Text)
	}
}

func TestMCPHandlers_ExecuteQuery_RowCap(t *testing.T) {
	t.Parallel()

	rows := make([]map[string]interface{}, 5000)
	for i := range rows {
		rows[i] = map[string]interface{}{"id": i}
	}

	drv := &mockDriver{
		dbType:      driver.PostgreSQL,
		isConnected: true,
		executeFunc: func(_ context.Context, _ string) (*driver.QueryResult, error) {
			return &driver.QueryResult{
				Columns:  []driver.ColumnMeta{{Name: "id", Type: "integer"}},
				Rows:     rows,
				RowCount: 5000,
			}, nil
		},
	}
	h, cs := newMCPHandlersForTest(t, "conn-1", drv, false)

	cs.mu.Lock()
	cfg := cs.configs["conn-1"]
	cfg.MCPEnabled = true
	cs.configs["conn-1"] = cfg
	cs.mu.Unlock()

	h.state.set("conn-1")

	result, err := h.handleExecuteQuery(context.Background(), makeReq(ExecuteQueryInput{Query: "SELECT * FROM big_table"}))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.IsError {
		t.Fatalf("unexpected error result: %s", result.Content[0].(*mcp.TextContent).Text)
	}

	var resp map[string]any
	if err := json.Unmarshal([]byte(result.Content[0].(*mcp.TextContent).Text), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	rowCount, _ := resp["row_count"].(float64)
	if int(rowCount) != mcpMaxRows {
		t.Errorf("expected row_count=%d, got %d", mcpMaxRows, int(rowCount))
	}

	truncated, _ := resp["truncated"].(bool)
	if !truncated {
		t.Error("expected truncated=true")
	}

	msg, _ := resp["truncation_message"].(string)
	if !strings.Contains(msg, "truncated") {
		t.Errorf("expected truncation message, got: %s", msg)
	}
}

func TestMCPHandlers_NoActiveConnection(t *testing.T) {
	t.Parallel()

	h, _ := newMCPHandlersForTest(t, "", nil, false)

	result, err := h.handleListTables(context.Background(), makeReq(ListTablesInput{}))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.IsError {
		t.Fatal("expected error when no active connection")
	}
	text := result.Content[0].(*mcp.TextContent).Text
	if !strings.Contains(text, "No active connection") {
		t.Errorf("expected 'No active connection', got: %s", text)
	}
}

func TestMCPIntegration_HTTP_ServerResponds(t *testing.T) {
	t.Parallel()

	s := newTestStore(t)
	ss := NewSettingsService(s)
	cs := NewConnectionService(s, ss)
	qs := NewQueryService(cs, ss, s)
	schemaS := NewSchemaService(cs)
	mcpSvc := NewMCPService(cs, qs, schemaS, ss, s)

	handler := mcp.NewStreamableHTTPHandler(func(r *http.Request) *mcp.Server {
		return mcpSvc.server
	}, nil)

	srv := &http.Server{Handler: handler}
	ln, err := listenRandomPort()
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer ln.Close()

	go srv.Serve(ln)
	defer srv.Close()

	url := fmt.Sprintf("http://%s/mcp", ln.Addr().String())
	client := &http.Client{}

	initBody := `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}`
	req, _ := http.NewRequest("POST", url, strings.NewReader(initBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")

	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("POST initialize: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}

	ct := resp.Header.Get("Content-Type")
	if !strings.Contains(ct, "event-stream") && !strings.Contains(ct, "application/json") {
		t.Errorf("unexpected Content-Type: %s", ct)
	}
}
