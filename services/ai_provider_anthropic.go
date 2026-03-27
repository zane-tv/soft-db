package services

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type anthropicProvider struct {
	apiKey  string
	baseURL string
}

func (p *anthropicProvider) Name() string { return "anthropic" }

func (p *anthropicProvider) ListModels(_ context.Context) ([]ModelInfo, error) {
	return []ModelInfo{
		{ID: "claude-opus-4-5", Name: "Claude Opus 4.5", Category: "general", Description: "Most capable Claude model"},
		{ID: "claude-sonnet-4-5", Name: "Claude Sonnet 4.5", Category: "general", Description: "Balanced performance and speed"},
		{ID: "claude-haiku-4-5", Name: "Claude Haiku 4.5", Category: "fast", Description: "Fast and cost-effective"},
		{ID: "claude-3-5-sonnet-20241022", Name: "Claude 3.5 Sonnet", Category: "general", Description: "High-capability model"},
		{ID: "claude-3-5-haiku-20241022", Name: "Claude 3.5 Haiku", Category: "fast", Description: "Fastest Claude 3.5 model"},
	}, nil
}

func (p *anthropicProvider) StreamChat(ctx context.Context, messages []ChatMessage, model string) (io.ReadCloser, error) {
	if p.apiKey == "" {
		return nil, fmt.Errorf("Anthropic API key not configured")
	}

	type anthropicMessage struct {
		Role    string `json:"role"`
		Content string `json:"content"`
	}
	type anthropicRequest struct {
		Model     string             `json:"model"`
		MaxTokens int                `json:"max_tokens"`
		System    string             `json:"system,omitempty"`
		Messages  []anthropicMessage `json:"messages"`
		Stream    bool               `json:"stream"`
	}

	var systemPrompt string
	var apiMessages []anthropicMessage
	for _, msg := range messages {
		if msg.Role == "system" {
			systemPrompt = msg.Content
		} else {
			apiMessages = append(apiMessages, anthropicMessage{Role: msg.Role, Content: msg.Content})
		}
	}

	reqBody := anthropicRequest{
		Model:     model,
		MaxTokens: 4096,
		System:    systemPrompt,
		Messages:  apiMessages,
		Stream:    true,
	}
	bodyJSON, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST",
		p.baseURL+"/v1/messages",
		strings.NewReader(string(bodyJSON)))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", p.apiKey)
	req.Header.Set("anthropic-version", "2023-06-01")

	client := &http.Client{Timeout: 3 * time.Minute}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("Anthropic request failed: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		return nil, fmt.Errorf("Anthropic error (%d): %s", resp.StatusCode, string(body))
	}

	pr, pw := io.Pipe()
	go func() {
		defer resp.Body.Close()

		scanner := bufio.NewScanner(resp.Body)
		scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

		for scanner.Scan() {
			line := scanner.Text()
			if !strings.HasPrefix(line, "data: ") {
				continue
			}
			data := line[6:]

			var event struct {
				Type  string `json:"type"`
				Delta *struct {
					Type string `json:"type"`
					Text string `json:"text"`
				} `json:"delta"`
			}
			if err := json.Unmarshal([]byte(data), &event); err != nil {
				continue
			}

			switch event.Type {
			case "content_block_delta":
				if event.Delta != nil && event.Delta.Type == "text_delta" && event.Delta.Text != "" {
					encoded, _ := json.Marshal(normalizedDelta{Delta: event.Delta.Text})
					pw.Write([]byte("data: "))
					pw.Write(encoded)
					pw.Write([]byte("\n"))
				}
			case "message_stop":
				goto done
			}
		}
	done:
		if err := scanner.Err(); err != nil {
			pw.CloseWithError(err)
			return
		}
		pw.Write([]byte("data: [DONE]\n"))
		pw.Close()
	}()

	return pr, nil
}
