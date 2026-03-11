package services

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"soft-db/internal/store"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// AIService proxies chat requests to OpenAI API with DB context injection
type AIService struct {
	oauthService  *OAuthService
	schemaService *SchemaService
	connService   *ConnectionService
	store         *store.Store
	app           *application.App

	// Track active streams for cancellation
	activeStreams map[string]context.CancelFunc
}

// ModelInfo describes an available AI model
type ModelInfo struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Category    string `json:"category"`
	Description string `json:"description"`
}

// openAIRequest represents the chat completions request body
type openAIRequest struct {
	Model    string          `json:"model"`
	Messages []openAIMessage `json:"messages"`
	Stream   bool            `json:"stream"`
}

type openAIMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// NewAIService creates the AI chat service
func NewAIService(oauth *OAuthService, schema *SchemaService, conn *ConnectionService, s *store.Store) *AIService {
	return &AIService{
		oauthService:  oauth,
		schemaService: schema,
		connService:   conn,
		store:         s,
		activeStreams:  make(map[string]context.CancelFunc),
	}
}

// SetApp sets the Wails application reference
func (a *AIService) SetApp(app *application.App) {
	a.app = app
}

// ─── Public Methods (Wails Bindings) ───

// SendMessage sends a chat message and streams the response via events
func (a *AIService) SendMessage(connectionID, message, model string) error {
	if model == "" {
		// Check persisted model selection
		saved, err := a.store.GetSetting(fmt.Sprintf("ai_model_%s", connectionID))
		if err == nil && saved != "" {
			model = saved
		} else {
			model = "gpt-5.3-codex"
		}
	}

	// Get OAuth token
	clientID, _ := a.store.GetSetting("openai_client_id")
	token, err := a.oauthService.GetValidToken(clientID)
	if err != nil {
		a.emitError(connectionID, "error", "Not authenticated. Please sign in with ChatGPT first.", 0)
		return err
	}

	// Save user message
	a.store.AddChatMessage(store.ChatMessage{
		ConnectionID: connectionID,
		Role:         "user",
		Content:      message,
		Model:        model,
	})

	// Build messages array with context
	messages, err := a.buildMessages(connectionID, message, model)
	if err != nil {
		return err
	}

	// Create cancellable context
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	a.activeStreams[connectionID] = cancel

	// Stream in background
	go func() {
		defer cancel()
		defer delete(a.activeStreams, connectionID)

		fullContent, err := a.streamChatCompletion(ctx, token, model, messages, connectionID)
		if err != nil {
			if ctx.Err() == context.Canceled {
				slog.Info("Stream cancelled by user", "connectionId", connectionID)
				return
			}
			slog.Error("Stream error", "error", err, "connectionId", connectionID)
			return
		}

		// Save assistant response
		a.store.AddChatMessage(store.ChatMessage{
			ConnectionID: connectionID,
			Role:         "assistant",
			Content:      fullContent,
			Model:        model,
		})

		// Emit done event
		a.emitEvent(connectionID, "ai:done", map[string]interface{}{
			"fullContent": fullContent,
		})
	}()

	return nil
}

// GetChatHistory returns persisted chat messages for a connection
func (a *AIService) GetChatHistory(connectionID string) ([]store.ChatMessage, error) {
	return a.store.ListChatMessages(connectionID, 100)
}

// ClearChatHistory deletes all chat messages for a connection
func (a *AIService) ClearChatHistory(connectionID string) error {
	return a.store.ClearChatMessages(connectionID)
}

// StopStreaming cancels an ongoing AI response stream
func (a *AIService) StopStreaming(connectionID string) {
	if cancel, ok := a.activeStreams[connectionID]; ok {
		cancel()
		delete(a.activeStreams, connectionID)
	}
}

// ListModels returns the available AI models
func (a *AIService) ListModels() []ModelInfo {
	return []ModelInfo{
		{ID: "gpt-5.3-codex", Name: "GPT-5.3 Codex", Category: "code", Description: "Optimized for SQL generation and code tasks"},
		{ID: "gpt-5.4", Name: "GPT-5.4", Category: "general", Description: "Latest flagship model — complex reasoning"},
		{ID: "gpt-5", Name: "GPT-5", Category: "general", Description: "Versatile, multimodal"},
		{ID: "gpt-5-mini", Name: "GPT-5 Mini", Category: "fast", Description: "Quick answers, cost-effective"},
		{ID: "gpt-5-nano", Name: "GPT-5 Nano", Category: "fast", Description: "Ultra-fast, simple completions"},
		{ID: "o4-mini", Name: "o4 Mini", Category: "reasoning", Description: "Deep analysis, code reasoning"},
		{ID: "o3", Name: "o3", Category: "reasoning", Description: "Advanced reasoning and optimization"},
	}
}

// GetSelectedModel returns the persisted model selection for a connection
func (a *AIService) GetSelectedModel(connectionID string) string {
	model, err := a.store.GetSetting(fmt.Sprintf("ai_model_%s", connectionID))
	if err != nil || model == "" {
		return "gpt-5.3-codex"
	}
	return model
}

// SetSelectedModel persists the model selection for a connection
func (a *AIService) SetSelectedModel(connectionID, modelID string) error {
	return a.store.SetSetting(fmt.Sprintf("ai_model_%s", connectionID), modelID)
}

// ─── Internal Methods ───

// buildMessages constructs the message array with DB context
func (a *AIService) buildMessages(connectionID, userMessage, model string) ([]openAIMessage, error) {
	var messages []openAIMessage

	// Build system prompt with DB context
	systemPrompt := a.buildSystemPrompt(connectionID)
	messages = append(messages, openAIMessage{Role: "system", Content: systemPrompt})

	// Load recent chat history for context
	history, _ := a.store.ListChatMessages(connectionID, 20)
	for _, msg := range history {
		// Skip the just-saved user message (last one)
		messages = append(messages, openAIMessage{Role: msg.Role, Content: msg.Content})
	}

	return messages, nil
}

// buildSystemPrompt creates the system prompt with DB schema context
func (a *AIService) buildSystemPrompt(connectionID string) string {
	var sb strings.Builder

	sb.WriteString("You are a database assistant integrated into SoftDB, a database management tool.\n")

	// Try to get schema info
	tables, err := a.schemaService.GetTables(connectionID)
	if err == nil && len(tables) > 0 {
		sb.WriteString("\nAvailable tables and their structure:\n")
		for i, table := range tables {
			if i >= 20 { // Limit to 20 tables to avoid context overflow
				sb.WriteString(fmt.Sprintf("\n... and %d more tables", len(tables)-20))
				break
			}
			sb.WriteString(fmt.Sprintf("\n- %s", table.Name))

			// Get columns for each table (limit to first 10 tables for detail)
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

	sb.WriteString("\n\nHelp the user write queries, explain schemas, and optimize SQL.")
	sb.WriteString("\nWhen generating SQL, format it in code blocks.")
	sb.WriteString("\nRespond in the same language the user writes in.")

	return sb.String()
}

// streamChatCompletion calls OpenAI API with streaming and emits chunk events
func (a *AIService) streamChatCompletion(ctx context.Context, token, model string, messages []openAIMessage, connectionID string) (string, error) {
	reqBody := openAIRequest{
		Model:    model,
		Messages: messages,
		Stream:   true,
	}

	bodyJSON, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("failed to marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", "https://api.openai.com/v1/chat/completions", strings.NewReader(string(bodyJSON)))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)

	client := &http.Client{Timeout: 3 * time.Minute}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("API request failed: %w", err)
	}
	defer resp.Body.Close()

	// Handle error responses
	if resp.StatusCode != 200 {
		return "", a.handleAPIError(resp, connectionID)
	}

	// Parse SSE stream
	var fullContent strings.Builder
	scanner := bufio.NewScanner(resp.Body)

	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		data := strings.TrimPrefix(line, "data: ")
		if data == "[DONE]" {
			break
		}

		var chunk struct {
			Choices []struct {
				Delta struct {
					Content string `json:"content"`
				} `json:"delta"`
			} `json:"choices"`
		}

		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			continue
		}

		if len(chunk.Choices) > 0 && chunk.Choices[0].Delta.Content != "" {
			content := chunk.Choices[0].Delta.Content
			fullContent.WriteString(content)

			// Emit chunk to frontend
			a.emitEvent(connectionID, "ai:chunk", map[string]interface{}{
				"content": content,
				"role":    "assistant",
			})
		}
	}

	return fullContent.String(), nil
}

// handleAPIError processes API error responses (429 rate limit vs quota)
func (a *AIService) handleAPIError(resp *http.Response, connectionID string) error {
	body, _ := io.ReadAll(resp.Body)
	bodyStr := string(body)

	if resp.StatusCode == 429 {
		// Distinguish billing_not_active vs quota vs rate limit
		if strings.Contains(bodyStr, "billing_not_active") {
			a.emitError(connectionID, "quota_exhausted",
				"Your OpenAI account is not active. Please check your billing details at platform.openai.com", 429)
		} else if strings.Contains(bodyStr, "insufficient_quota") {
			a.emitError(connectionID, "quota_exhausted",
				"ChatGPT usage limit reached. Please wait or upgrade your plan at openai.com", 429)
		} else {
			retryAfter := resp.Header.Get("x-ratelimit-reset-requests")
			if retryAfter == "" {
				retryAfter = resp.Header.Get("Retry-After")
			}
			msg := "Rate limited. Please wait"
			if retryAfter != "" {
				msg = fmt.Sprintf("Rate limited. Please wait %s", retryAfter)
			}
			a.emitError(connectionID, "rate_limited", msg, 429)
		}
		return fmt.Errorf("API error (429): %s", bodyStr)
	}

	if resp.StatusCode == 401 {
		a.emitError(connectionID, "auth_error",
			"Authentication failed. Please sign in again.", 401)
		return fmt.Errorf("API auth error (401)")
	}

	// Generic error
	a.emitError(connectionID, "error",
		fmt.Sprintf("API error (%d): %s", resp.StatusCode, bodyStr), resp.StatusCode)
	return fmt.Errorf("API error (%d): %s", resp.StatusCode, bodyStr)
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
