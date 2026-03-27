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

// SendMessage sends a chat message and streams the response via events.
func (a *AIService) SendMessage(connectionID, message, model string) error {
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

	messages, err := a.buildMessages(connectionID)
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

// buildMessages constructs the full ChatMessage slice (system + history) for the provider.
func (a *AIService) buildMessages(connectionID string) ([]ChatMessage, error) {
	messages := []ChatMessage{
		{Role: "system", Content: a.buildSystemPrompt(connectionID)},
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

func (a *AIService) buildSystemPrompt(connectionID string) string {
	var sb strings.Builder

	dbType := a.connService.GetConnectionType(connectionID)
	isMongo := dbType == "mongodb"

	if isMongo {
		sb.WriteString("You are a MongoDB database assistant integrated into SoftDB, a database management tool.\n")
	} else {
		sb.WriteString("You are a database assistant integrated into SoftDB, a database management tool.\n")
	}

	tables, err := a.schemaService.GetTables(connectionID)
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
				cols, err := a.schemaService.GetColumns(connectionID, table.Name)
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
