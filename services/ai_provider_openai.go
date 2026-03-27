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

type codexRequest struct {
	Model        string         `json:"model"`
	Instructions string         `json:"instructions,omitempty"`
	Input        []codexMessage `json:"input"`
	Stream       bool           `json:"stream"`
	Store        bool           `json:"store"`
}

type codexMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type openaiProvider struct {
	oauthService *OAuthService
	clientID     string
}

func (p *openaiProvider) Name() string { return "openai" }

func (p *openaiProvider) ListModels(_ context.Context) ([]ModelInfo, error) {
	return []ModelInfo{
		{ID: "gpt-5.3-codex", Name: "GPT-5.3 Codex", Category: "code", Description: "Optimized for SQL generation and code tasks"},
		{ID: "gpt-5.4", Name: "GPT-5.4", Category: "general", Description: "Latest flagship model — complex reasoning"},
		{ID: "gpt-5", Name: "GPT-5", Category: "general", Description: "Versatile, multimodal"},
		{ID: "gpt-5-mini", Name: "GPT-5 Mini", Category: "fast", Description: "Quick answers, cost-effective"},
		{ID: "gpt-5-nano", Name: "GPT-5 Nano", Category: "fast", Description: "Ultra-fast, simple completions"},
		{ID: "o4-mini", Name: "o4 Mini", Category: "reasoning", Description: "Deep analysis, code reasoning"},
		{ID: "o3", Name: "o3", Category: "reasoning", Description: "Advanced reasoning and optimization"},
	}, nil
}

func (p *openaiProvider) StreamChat(ctx context.Context, messages []ChatMessage, model string) (io.ReadCloser, error) {
	token, err := p.oauthService.GetValidToken(p.clientID)
	if err != nil {
		return nil, fmt.Errorf("not authenticated with OpenAI: %w", err)
	}

	var instructions string
	var input []codexMessage
	for _, msg := range messages {
		if msg.Role == "system" {
			instructions = msg.Content
		} else {
			input = append(input, codexMessage{Role: msg.Role, Content: msg.Content})
		}
	}

	reqBody := codexRequest{
		Model:        model,
		Instructions: instructions,
		Input:        input,
		Stream:       true,
		Store:        false,
	}
	bodyJSON, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST",
		"https://chatgpt.com/backend-api/codex/responses",
		strings.NewReader(string(bodyJSON)))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)

	client := &http.Client{Timeout: 3 * time.Minute}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("OpenAI request failed: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		return nil, fmt.Errorf("OpenAI error (%d): %s", resp.StatusCode, string(body))
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
			if data == "[DONE]" {
				break
			}

			var event struct {
				Type  string `json:"type"`
				Delta string `json:"delta"`
			}
			if err := json.Unmarshal([]byte(data), &event); err != nil {
				continue
			}

			switch event.Type {
			case "response.output_text.delta":
				if event.Delta != "" {
					encoded, _ := json.Marshal(normalizedDelta{Delta: event.Delta})
					pw.Write([]byte("data: "))
					pw.Write(encoded)
					pw.Write([]byte("\n"))
				}
			case "response.completed":
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
