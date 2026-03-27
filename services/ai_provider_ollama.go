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

type ollamaProvider struct {
	baseURL string
}

func (p *ollamaProvider) Name() string { return "ollama" }

func (p *ollamaProvider) ListModels(ctx context.Context) ([]ModelInfo, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", p.baseURL+"/api/tags", nil)
	if err != nil {
		return nil, err
	}

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("Ollama not reachable at %s: %w", p.baseURL, err)
	}
	defer resp.Body.Close()

	var result struct {
		Models []struct {
			Name string `json:"name"`
		} `json:"models"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode Ollama model list: %w", err)
	}

	models := make([]ModelInfo, 0, len(result.Models))
	for _, m := range result.Models {
		models = append(models, ModelInfo{
			ID:       m.Name,
			Name:     m.Name,
			Category: "local",
		})
	}
	return models, nil
}

func (p *ollamaProvider) StreamChat(ctx context.Context, messages []ChatMessage, model string) (io.ReadCloser, error) {
	type ollamaMessage struct {
		Role    string `json:"role"`
		Content string `json:"content"`
	}
	type ollamaRequest struct {
		Model    string          `json:"model"`
		Messages []ollamaMessage `json:"messages"`
		Stream   bool            `json:"stream"`
	}

	apiMessages := make([]ollamaMessage, 0, len(messages))
	for _, msg := range messages {
		apiMessages = append(apiMessages, ollamaMessage{Role: msg.Role, Content: msg.Content})
	}

	reqBody := ollamaRequest{
		Model:    model,
		Messages: apiMessages,
		Stream:   true,
	}
	bodyJSON, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST",
		p.baseURL+"/api/chat",
		strings.NewReader(string(bodyJSON)))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 3 * time.Minute}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("Ollama request failed: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		return nil, fmt.Errorf("Ollama error (%d): %s", resp.StatusCode, string(body))
	}

	pr, pw := io.Pipe()
	go func() {
		defer resp.Body.Close()

		scanner := bufio.NewScanner(resp.Body)
		scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

		for scanner.Scan() {
			line := scanner.Text()
			if line == "" {
				continue
			}

			var event struct {
				Message *struct {
					Role    string `json:"role"`
					Content string `json:"content"`
				} `json:"message"`
				Done bool `json:"done"`
			}
			if err := json.Unmarshal([]byte(line), &event); err != nil {
				continue
			}

			if event.Message != nil && event.Message.Content != "" {
				encoded, _ := json.Marshal(normalizedDelta{Delta: event.Message.Content})
				pw.Write([]byte("data: "))
				pw.Write(encoded)
				pw.Write([]byte("\n"))
			}

			if event.Done {
				break
			}
		}

		if err := scanner.Err(); err != nil {
			pw.CloseWithError(err)
			return
		}
		pw.Write([]byte("data: [DONE]\n"))
		pw.Close()
	}()

	return pr, nil
}
