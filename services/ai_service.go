package services

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"regexp"
	"strings"
	"sync"
	"time"

	"soft-db/internal/driver"
	"soft-db/internal/store"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// AIProvider is the interface that every AI backend must implement.
type AIProvider interface {
	StreamChat(ctx context.Context, messages []ChatMessage, model string) (io.ReadCloser, error)
	ListModels(ctx context.Context) ([]ModelInfo, error)
	Name() string
}

// ChatMessage is the generic message type shared across all providers.
type ChatMessage struct {
	Role    string
	Content string
}

// normalizedDelta is the unified streaming event written by every provider.
type normalizedDelta struct {
	Delta string `json:"delta"`
}

// AIService proxies chat requests to the configured AI provider with DB context injection.
type AIService struct {
	oauthService    *OAuthService
	schemaService   *SchemaService
	connService     *ConnectionService
	settingsService *SettingsService
	store           *store.Store
	app             *application.App

	activeStreams   map[string]context.CancelFunc
	activeStreamsMu sync.RWMutex
}

// ModelInfo describes an available AI model.
type ModelInfo struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Category    string `json:"category"`
	Description string `json:"description"`
}

// NewAIService creates the AI chat service.
func NewAIService(oauth *OAuthService, schema *SchemaService, conn *ConnectionService, settings *SettingsService, s *store.Store) *AIService {
	return &AIService{
		oauthService:    oauth,
		schemaService:   schema,
		connService:     conn,
		settingsService: settings,
		store:           s,
		activeStreams:   make(map[string]context.CancelFunc),
	}
}

// SetApp sets the Wails application reference.
func (a *AIService) SetApp(app *application.App) {
	a.app = app
}

// getProvider returns the active AIProvider based on current settings.
func (a *AIService) getProvider() AIProvider {
	settings, _ := a.settingsService.GetSettings()
	switch settings.AIProvider {
	case "anthropic":
		baseURL := settings.AIBaseURL
		if baseURL == "" {
			baseURL = "https://api.anthropic.com"
		}
		return &anthropicProvider{apiKey: settings.AIAPIKey, baseURL: baseURL}
	case "ollama":
		baseURL := settings.AIBaseURL
		if baseURL == "" {
			baseURL = "http://localhost:11434"
		}
		return &ollamaProvider{baseURL: baseURL}
	default:
		clientID, _ := a.store.GetSetting("openai_client_id")
		return &openaiProvider{oauthService: a.oauthService, clientID: clientID}
	}
}

// ─── Public Methods (Wails Bindings) ───

func (a *AIService) GetMCPMode(connectionID string) bool {
	val, err := a.store.GetSetting(fmt.Sprintf("ai_mcp_mode_%s", connectionID))
	return err == nil && val == "true"
}

func (a *AIService) SetMCPMode(connectionID string, enabled bool) error {
	val := "false"
	if enabled {
		val = "true"
	}
	return a.store.SetSetting(fmt.Sprintf("ai_mcp_mode_%s", connectionID), val)
}

func (a *AIService) SendMessage(connectionID, message, model string, mcpMode bool, database ...string) error {
	db := ""
	if len(database) > 0 {
		db = database[0]
	}

	if model == "" {
		saved, err := a.store.GetSetting(fmt.Sprintf("ai_model_%s", connectionID))
		if err == nil && saved != "" {
			model = saved
		} else {
			settings, _ := a.settingsService.GetSettings()
			if settings.AIModel != "" {
				model = settings.AIModel
			} else {
				model = "gpt-5.3-codex"
			}
		}
	}

	a.store.AddChatMessage(store.ChatMessage{
		ConnectionID: connectionID,
		Role:         "user",
		Content:      message,
		Model:        model,
	})

	messages, err := a.buildMessages(connectionID, mcpMode, db)
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	func() {
		a.activeStreamsMu.Lock()
		defer a.activeStreamsMu.Unlock()
		a.activeStreams[connectionID] = cancel
	}()

	go func() {
		defer cancel()
		defer func() {
			a.activeStreamsMu.Lock()
			defer a.activeStreamsMu.Unlock()
			delete(a.activeStreams, connectionID)
		}()

		provider := a.getProvider()
		stream, err := provider.StreamChat(ctx, messages, model)
		if err != nil {
			if ctx.Err() == context.Canceled {
				slog.Info("Stream cancelled", "connectionId", connectionID)
				return
			}
			slog.Error("StreamChat error", "provider", provider.Name(), "error", err, "connectionId", connectionID)
			a.emitError(connectionID, "error", err.Error(), 0)
			return
		}

		fullContent, err := a.consumeStream(ctx, stream, connectionID)
		if err != nil {
			if ctx.Err() != context.Canceled {
				slog.Error("Stream consume error", "error", err, "connectionId", connectionID)
			}
			return
		}

		if mcpMode {
			if extra := a.autoExecuteReadOnlyBlocks(connectionID, fullContent); extra != "" {
				fullContent += extra
				a.emitEvent(connectionID, "ai:chunk", map[string]interface{}{
					"content": extra,
					"role":    "assistant",
				})
			}
		}

		a.store.AddChatMessage(store.ChatMessage{
			ConnectionID: connectionID,
			Role:         "assistant",
			Content:      fullContent,
			Model:        model,
		})

		a.emitEvent(connectionID, "ai:done", map[string]interface{}{
			"fullContent": fullContent,
		})
	}()

	return nil
}

// GetChatHistory returns persisted chat messages for a connection.
func (a *AIService) GetChatHistory(connectionID string) ([]store.ChatMessage, error) {
	return a.store.ListChatMessages(connectionID, 100)
}

// ClearChatHistory deletes all chat messages for a connection.
func (a *AIService) ClearChatHistory(connectionID string) error {
	return a.store.ClearChatMessages(connectionID)
}

// StopStreaming cancels an ongoing AI response stream.
func (a *AIService) StopStreaming(connectionID string) {
	a.activeStreamsMu.RLock()
	cancel, ok := a.activeStreams[connectionID]
	a.activeStreamsMu.RUnlock()

	if ok {
		cancel()
		func() {
			a.activeStreamsMu.Lock()
			defer a.activeStreamsMu.Unlock()
			delete(a.activeStreams, connectionID)
		}()
	}
}

// ListModels returns the available models for the currently configured provider.
func (a *AIService) ListModels() []ModelInfo {
	provider := a.getProvider()
	models, err := provider.ListModels(context.Background())
	if err != nil {
		slog.Warn("ListModels failed", "provider", provider.Name(), "error", err)
		return []ModelInfo{}
	}
	return models
}

// GetSelectedModel returns the persisted model selection for a connection.
func (a *AIService) GetSelectedModel(connectionID string) string {
	model, err := a.store.GetSetting(fmt.Sprintf("ai_model_%s", connectionID))
	if err == nil && model != "" {
		return model
	}
	settings, _ := a.settingsService.GetSettings()
	if settings.AIModel != "" {
		return settings.AIModel
	}
	return "gpt-5.3-codex"
}

// SetSelectedModel persists the model selection for a connection.
func (a *AIService) SetSelectedModel(connectionID, modelID string) error {
	return a.store.SetSetting(fmt.Sprintf("ai_model_%s", connectionID), modelID)
}

// ─── Internal Methods ───

// consumeStream reads a normalized provider stream (SSE-like deltas) and emits frontend events.
// Each line from the stream is expected to be "data: <json>" or "data: [DONE]".
func (a *AIService) consumeStream(ctx context.Context, stream io.ReadCloser, connectionID string) (string, error) {
	defer stream.Close()

	var fullContent strings.Builder
	scanner := bufio.NewScanner(stream)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	for scanner.Scan() {
		if ctx.Err() != nil {
			return fullContent.String(), nil
		}

		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		data := line[6:]
		if data == "[DONE]" {
			break
		}

		var evt normalizedDelta
		if err := json.Unmarshal([]byte(data), &evt); err != nil {
			continue
		}

		if evt.Delta != "" {
			fullContent.WriteString(evt.Delta)
			a.emitEvent(connectionID, "ai:chunk", map[string]interface{}{
				"content": evt.Delta,
				"role":    "assistant",
			})
		}
	}

	if err := scanner.Err(); err != nil && ctx.Err() == nil {
		return fullContent.String(), err
	}
	return fullContent.String(), nil
}

func (a *AIService) buildMessages(connectionID string, mcpMode bool, database string) ([]ChatMessage, error) {
	systemPrompt := a.buildSystemPrompt(connectionID, database)
	if mcpMode {
		systemPrompt = a.buildMCPSystemPrompt(connectionID, database)
	}
	messages := []ChatMessage{
		{Role: "system", Content: systemPrompt},
	}

	history, _ := a.store.ListChatMessages(connectionID, 20)
	for _, msg := range history {
		if msg.Role == "system" {
			continue
		}
		content := msg.Content
		if msg.Role == "user" {
			content = a.expandTableMentions(connectionID, content)
		}
		messages = append(messages, ChatMessage{Role: msg.Role, Content: content})
	}

	return messages, nil
}

var tableMentionRe = regexp.MustCompile(`@(\w+)`)

func (a *AIService) expandTableMentions(connectionID, message string) string {
	if !strings.Contains(message, "@") {
		return message
	}

	tables, err := a.schemaService.GetTables(connectionID)
	if err != nil {
		return message
	}
	tableSet := make(map[string]bool, len(tables))
	for _, t := range tables {
		tableSet[t.Name] = true
	}

	return tableMentionRe.ReplaceAllStringFunc(message, func(match string) string {
		tableName := match[1:]
		if !tableSet[tableName] {
			return match
		}

		cols, err := a.schemaService.GetColumns(connectionID, tableName)
		if err != nil || len(cols) == 0 {
			return fmt.Sprintf("[Table: %s]", tableName)
		}

		var parts []string
		for _, c := range cols {
			p := fmt.Sprintf("%s %s", c.Name, c.Type)
			if c.PrimaryKey {
				p += " PK"
			}
			parts = append(parts, p)
		}
		return fmt.Sprintf("[Table: %s (%s)]", tableName, strings.Join(parts, ", "))
	})
}

func (a *AIService) buildSystemPrompt(connectionID string, database string) string {
	var sb strings.Builder

	dbType := a.connService.GetConnectionType(connectionID)
	isMongo := dbType == "mongodb"

	if isMongo {
		sb.WriteString("You are a MongoDB database assistant integrated into SoftDB, a database management tool.\n")
	} else {
		sb.WriteString("You are a database assistant integrated into SoftDB, a database management tool.\n")
	}

	sb.WriteString(fmt.Sprintf("Database engine: %s\n", dbType))
	if database != "" {
		sb.WriteString(fmt.Sprintf("Active database: %s\n", database))
	}

	var tables []driver.TableInfo
	var err error
	if database != "" {
		tables, err = a.schemaService.GetTablesForDB(connectionID, database)
	} else {
		tables, err = a.schemaService.GetTables(connectionID)
	}

	if err == nil && len(tables) > 0 {
		if isMongo {
			sb.WriteString("\nAvailable collections and their fields:\n")
		} else {
			sb.WriteString("\nAvailable tables and their structure:\n")
		}
		for i, table := range tables {
			if i >= 20 {
				sb.WriteString(fmt.Sprintf("\n... and %d more", len(tables)-20))
				break
			}
			sb.WriteString(fmt.Sprintf("\n- %s", table.Name))

			if i < 10 {
				var cols []driver.ColumnInfo
				if database != "" {
					cols, err = a.schemaService.GetColumnsForDB(connectionID, database, table.Name)
				} else {
					cols, err = a.schemaService.GetColumns(connectionID, table.Name)
				}
				if err == nil {
					sb.WriteString(" (")
					for j, col := range cols {
						if j > 0 {
							sb.WriteString(", ")
						}
						sb.WriteString(fmt.Sprintf("%s %s", col.Name, col.Type))
						if col.PrimaryKey {
							sb.WriteString(" PK")
						}
					}
					sb.WriteString(")")
				}
			}
		}
	}

	if isMongo {
		sb.WriteString("\n\nHelp the user query and manage their MongoDB collections.")
		sb.WriteString("\nSoftDB uses a JSON query format. ALWAYS generate queries in this exact format:")
		sb.WriteString("\n")
		sb.WriteString("\nFind documents:")
		sb.WriteString("\n```json")
		sb.WriteString("\n{ \"collection\": \"users\", \"action\": \"find\", \"filter\": { \"active\": true }, \"limit\": 100 }")
		sb.WriteString("\n```")
		sb.WriteString("\n")
		sb.WriteString("\nCount documents:")
		sb.WriteString("\n```json")
		sb.WriteString("\n{ \"collection\": \"users\", \"action\": \"count\", \"filter\": { \"role\": \"admin\" } }")
		sb.WriteString("\n```")
		sb.WriteString("\n")
		sb.WriteString("\nInsert document:")
		sb.WriteString("\n```json")
		sb.WriteString("\n{ \"collection\": \"users\", \"action\": \"insert\", \"document\": { \"name\": \"John\", \"role\": \"user\" } }")
		sb.WriteString("\n```")
		sb.WriteString("\n")
		sb.WriteString("\nDelete documents:")
		sb.WriteString("\n```json")
		sb.WriteString("\n{ \"collection\": \"users\", \"action\": \"delete\", \"filter\": { \"active\": false } }")
		sb.WriteString("\n```")
		sb.WriteString("\n")
		sb.WriteString("\nSupported actions: find, count, insert, delete.")
		sb.WriteString("\nDo NOT use JavaScript syntax like db.collection.find(). Only use the JSON format shown above.")
		sb.WriteString("\nThe 'filter' field uses MongoDB query operators ($gt, $lt, $in, $regex, etc.).")
	} else {
		sb.WriteString("\n\nHelp the user write queries, explain schemas, and optimize SQL.")
		sb.WriteString("\nWhen generating SQL, format it in code blocks.")
	}
	sb.WriteString("\nRespond in the same language the user writes in.")

	return sb.String()
}

// ─── MCP Mode ───

func (a *AIService) buildMCPSystemPrompt(connectionID string, database string) string {
	base := a.buildSystemPrompt(connectionID, database)

	var sb strings.Builder
	sb.WriteString(base)

	sb.WriteString("\n\n--- MCP MODE (READ-ONLY DATABASE ACCESS) ---")
	sb.WriteString("\nYou have READ-ONLY access to the database. When you need to query data, write a SELECT query in a ```sql code block.")
	sb.WriteString("\nSoftDB will auto-execute it and append results below your response.")
	sb.WriteString("\nOnly SELECT, SHOW, DESCRIBE, EXPLAIN are executed. Write operations will NOT run.")

	tables, err := a.schemaService.GetTables(connectionID)
	if err != nil || len(tables) == 0 {
		return sb.String()
	}

	limit := 5
	if len(tables) < limit {
		limit = len(tables)
	}

	sb.WriteString("\n\nSample data from tables:")
	queryService := a.getQueryService()
	for i := 0; i < limit; i++ {
		t := tables[i]
		if queryService == nil {
			break
		}
		result, err := queryService.ExecuteQuery(connectionID, fmt.Sprintf("SELECT * FROM %s LIMIT 3", t.Name))
		if err != nil || result.Error != "" || len(result.Rows) == 0 {
			continue
		}
		sb.WriteString(fmt.Sprintf("\n\n%s (sample):\n", t.Name))
		sb.WriteString(formatQueryResultMarkdown(result, 3))
	}

	fks := a.collectForeignKeys(connectionID, tables)
	if len(fks) > 0 {
		sb.WriteString("\n\nForeign key relationships:")
		for _, fk := range fks {
			sb.WriteString(fmt.Sprintf("\n- %s.%s → %s.%s", fk.TableName, fk.ColumnName, fk.ReferencedTable, fk.ReferencedColumn))
		}
	}

	return sb.String()
}

func (a *AIService) collectForeignKeys(connectionID string, tables []driver.TableInfo) []driver.ForeignKeyInfo {
	var all []driver.ForeignKeyInfo
	for _, t := range tables {
		fks, err := a.schemaService.GetTableForeignKeys(connectionID, "", t.Name)
		if err != nil {
			continue
		}
		all = append(all, fks...)
	}
	return all
}

func (a *AIService) getQueryService() *QueryService {
	if a.connService == nil || a.settingsService == nil || a.store == nil {
		return nil
	}
	return NewQueryService(a.connService, a.settingsService, a.store)
}

var sqlBlockRe = regexp.MustCompile("(?s)```sql\\s*\n(.*?)```")

func extractSQLBlocks(content string) []string {
	matches := sqlBlockRe.FindAllStringSubmatch(content, -1)
	var blocks []string
	for _, m := range matches {
		q := strings.TrimSpace(m[1])
		if q != "" {
			blocks = append(blocks, q)
		}
	}
	return blocks
}

func isReadOnlyQuery(query string) bool {
	trimmed := strings.TrimSpace(strings.ToUpper(query))
	if trimmed == "" {
		return false
	}
	first := strings.Fields(trimmed)[0]
	switch first {
	case "SELECT", "SHOW", "DESCRIBE", "DESC", "EXPLAIN", "WITH", "PRAGMA":
		return true
	}
	return false
}

func (a *AIService) autoExecuteReadOnlyBlocks(connectionID, content string) string {
	blocks := extractSQLBlocks(content)
	if len(blocks) == 0 {
		return ""
	}

	queryService := a.getQueryService()
	if queryService == nil {
		return ""
	}

	var sb strings.Builder
	for _, sql := range blocks {
		if !isReadOnlyQuery(sql) {
			sb.WriteString(fmt.Sprintf("\n\n> ⚠️ `%s` — skipped (read-only mode: only SELECT/SHOW/DESCRIBE/EXPLAIN are auto-executed)\n", truncateStr(sql, 80)))
			continue
		}
		result, err := queryService.ExecuteQuery(connectionID, sql)
		if err != nil {
			sb.WriteString(fmt.Sprintf("\n\n> ❌ Query error: %s\n", err.Error()))
			continue
		}
		if result.Error != "" {
			sb.WriteString(fmt.Sprintf("\n\n> ❌ %s\n", result.Error))
			continue
		}
		sb.WriteString(fmt.Sprintf("\n\n**Query Results** (%d rows, %.1fms):\n", result.RowCount, result.ExecutionTime))
		sb.WriteString(formatQueryResultMarkdown(result, 20))
	}

	return sb.String()
}

func formatQueryResultMarkdown(result *driver.QueryResult, maxRows int) string {
	if len(result.Columns) == 0 {
		return "_No columns_\n"
	}

	var sb strings.Builder

	for i, col := range result.Columns {
		if i > 0 {
			sb.WriteString(" | ")
		}
		sb.WriteString(col.Name)
	}
	sb.WriteString("\n")

	for i := range result.Columns {
		if i > 0 {
			sb.WriteString(" | ")
		}
		sb.WriteString("---")
	}
	sb.WriteString("\n")

	rows := result.Rows
	if len(rows) > maxRows {
		rows = rows[:maxRows]
	}
	for _, row := range rows {
		for i, col := range result.Columns {
			if i > 0 {
				sb.WriteString(" | ")
			}
			v := row[col.Name]
			if v == nil {
				sb.WriteString("NULL")
			} else {
				sb.WriteString(fmt.Sprintf("%v", v))
			}
		}
		sb.WriteString("\n")
	}

	if int64(len(result.Rows)) > int64(maxRows) {
		sb.WriteString(fmt.Sprintf("_... and %d more rows_\n", int64(len(result.Rows))-int64(maxRows)))
	}

	return sb.String()
}

// ─── Event Helpers ───

func (a *AIService) emitEvent(connectionID, eventName string, data map[string]interface{}) {
	if a.app == nil {
		return
	}
	a.app.Event.Emit(fmt.Sprintf("%s:%s", eventName, connectionID), data)
}

func (a *AIService) emitError(connectionID, errorType, message string, code int) {
	if a.app == nil {
		return
	}
	a.app.Event.Emit(fmt.Sprintf("ai:error:%s", connectionID), map[string]interface{}{
		"type":    errorType,
		"message": message,
		"code":    code,
	})
}
