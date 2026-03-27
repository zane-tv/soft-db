package services

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"sync"
	"time"

	"soft-db/internal/store"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func schema(s string) json.RawMessage {
	return json.RawMessage(s)
}

var (
	schemaEmpty = schema(`{"type":"object","properties":{}}`)

	schemaUseConnection = schema(`{"type":"object","properties":{"connection_id":{"type":"string","description":"UUID of the connection to activate"}},"required":["connection_id"]}`)

	schemaListTables = schema(`{"type":"object","properties":{"database":{"type":"string","description":"Optional database name for multi-DB connections"}}}`)

	schemaDescribeTable = schema(`{"type":"object","properties":{"table":{"type":"string","description":"Table name to describe"},"database":{"type":"string","description":"Optional database name for multi-DB connections"}},"required":["table"]}`)

	schemaExecuteQuery = schema(`{"type":"object","properties":{"query":{"type":"string","description":"Query to execute. SQL for relational databases, JSON for MongoDB, commands for Redis."}},"required":["query"]}`)

	schemaReadTable = schema(`{"type":"object","properties":{"table":{"type":"string","description":"Table name to read"},"page":{"type":"integer","description":"Page number (1-based), default 1"},"page_size":{"type":"integer","description":"Rows per page, default 50, max 1000"},"database":{"type":"string","description":"Optional database name for multi-DB connections"}},"required":["table"]}`)

	schemaGetRelationships = schema(`{"type":"object","properties":{"database":{"type":"string","description":"Optional database name for multi-DB connections"}}}`)
)

type MCPStatus struct {
	Running          bool   `json:"running"`
	Port             int    `json:"port"`
	ActiveConnection string `json:"activeConnection"`
}

type MCPService struct {
	connService     *ConnectionService
	queryService    *QueryService
	schemaService   *SchemaService
	settingsService *SettingsService
	store           *store.Store
	app             *application.App

	server     *mcp.Server
	httpServer *http.Server
	handlers   *MCPHandlers

	mu      sync.RWMutex
	running bool
	port    int
}

func NewMCPService(cs *ConnectionService, qs *QueryService, ss *SchemaService, sets *SettingsService, s *store.Store) *MCPService {
	svc := &MCPService{
		connService:     cs,
		queryService:    qs,
		schemaService:   ss,
		settingsService: sets,
		store:           s,
	}
	svc.handlers = newMCPHandlers(cs, qs, ss, sets)
	svc.initServer()
	return svc
}

func (s *MCPService) SetApp(app *application.App) {
	s.app = app
}

func (s *MCPService) initServer() {
	s.server = mcp.NewServer(&mcp.Implementation{
		Name:    "softdb-mcp",
		Version: "1.0.0",
	}, nil)

	h := s.handlers

	s.server.AddTool(&mcp.Tool{
		Name:        "list_connections",
		Description: "List all MCP-enabled database connections configured in SoftDB.",
		InputSchema: schemaEmpty,
	}, h.handleListConnections)

	s.server.AddTool(&mcp.Tool{
		Name:        "use_connection",
		Description: "Set the active database connection for subsequent tool calls. Auto-connects if not already connected.",
		InputSchema: schemaUseConnection,
	}, h.handleUseConnection)

	s.server.AddTool(&mcp.Tool{
		Name:        "list_databases",
		Description: "List all databases on the active connection. Only available for multi-database connections (PostgreSQL, MySQL, MongoDB).",
		InputSchema: schemaEmpty,
	}, h.handleListDatabases)

	s.server.AddTool(&mcp.Tool{
		Name:        "list_tables",
		Description: "List all tables in the active connection. Optionally specify a database for multi-DB connections.",
		InputSchema: schemaListTables,
	}, h.handleListTables)

	s.server.AddTool(&mcp.Tool{
		Name:        "describe_table",
		Description: "Get column definitions for a table including name, type, nullable, primary key, and default value.",
		InputSchema: schemaDescribeTable,
	}, h.handleDescribeTable)

	s.server.AddTool(&mcp.Tool{
		Name:        "execute_query",
		Description: "Execute a query on the active connection. Use SQL for relational databases, JSON query syntax for MongoDB, Redis commands for Redis. SafeMode blocks destructive operations.",
		InputSchema: schemaExecuteQuery,
	}, h.handleExecuteQuery)

	s.server.AddTool(&mcp.Tool{
		Name:        "read_table",
		Description: "Read data from a table with pagination. Default: page=1, page_size=50, max page_size=1000.",
		InputSchema: schemaReadTable,
	}, h.handleReadTable)

	s.server.AddTool(&mcp.Tool{
		Name:        "get_relationships",
		Description: "Get foreign key relationships between tables. Not available for MongoDB or Redis connections.",
		InputSchema: schemaGetRelationships,
	}, h.handleGetRelationships)
}

func (s *MCPService) StartServer() error {
	settings, err := s.settingsService.GetSettings()
	if err != nil {
		return fmt.Errorf("failed to get settings: %w", err)
	}

	port := settings.MCPPort
	if port < 1024 || port > 65535 {
		port = 9090
	}

	ln, err := net.Listen("tcp", fmt.Sprintf("0.0.0.0:%d", port))
	if err != nil {
		return fmt.Errorf("port %d is already in use: %w", port, err)
	}

	handler := mcp.NewStreamableHTTPHandler(func(r *http.Request) *mcp.Server {
		return s.server
	}, nil)

	httpSrv := &http.Server{Handler: handler}

	s.mu.Lock()
	s.httpServer = httpSrv
	s.running = true
	s.port = port
	s.mu.Unlock()

	go func() {
		if err := httpSrv.Serve(ln); err != nil && err != http.ErrServerClosed {
			s.mu.Lock()
			s.running = false
			s.mu.Unlock()
		}
	}()

	s.emitStatusChanged()
	return nil
}

func (s *MCPService) StopServer() error {
	s.mu.Lock()
	srv := s.httpServer
	s.running = false
	s.httpServer = nil
	s.mu.Unlock()

	if srv == nil {
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	err := srv.Shutdown(ctx)
	s.emitStatusChanged()
	return err
}

func (s *MCPService) GetStatus() MCPStatus {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return MCPStatus{
		Running:          s.running,
		Port:             s.port,
		ActiveConnection: globalMCPState.get(),
	}
}

func (s *MCPService) IsRunning() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.running
}

func (s *MCPService) emitStatusChanged() {
	if s.app == nil {
		return
	}
	s.app.Event.Emit("mcp:status-changed", s.GetStatus())
}

func (s *MCPService) GetMCPServer() *mcp.Server {
	return s.server
}
