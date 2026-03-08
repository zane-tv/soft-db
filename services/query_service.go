package services

import (
	"context"
	"strings"
	"time"

	"soft-db/internal/driver"
	"soft-db/internal/store"
)

// QueryService handles query execution (bound to Wails frontend)
type QueryService struct {
	connService *ConnectionService
	store       *store.Store
}

// NewQueryService creates the service
func NewQueryService(cs *ConnectionService, s *store.Store) *QueryService {
	return &QueryService{
		connService: cs,
		store:       s,
	}
}

// ExecuteQuery runs a query on the given connection and records history
func (s *QueryService) ExecuteQuery(connectionID string, query string) (*driver.QueryResult, error) {
	drv, err := s.connService.GetDriver(connectionID)
	if err != nil {
		return nil, err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	result, err := drv.Execute(ctx, query)
	if err != nil {
		return nil, err
	}

	// Record history
	status := "success"
	if result.Error != "" {
		status = "error"
	} else {
		trimmed := strings.TrimSpace(strings.ToUpper(query))
		if !strings.HasPrefix(trimmed, "SELECT") && !strings.HasPrefix(trimmed, "SHOW") &&
			!strings.HasPrefix(trimmed, "DESCRIBE") && !strings.HasPrefix(trimmed, "EXPLAIN") &&
			!strings.HasPrefix(trimmed, "PRAGMA") {
			status = "mutation"
		}
	}

	s.store.AddHistory(store.HistoryEntry{
		ConnectionID:  connectionID,
		QueryText:     query,
		Status:        status,
		ExecutionTime: result.ExecutionTime,
		RowsAffected:  result.AffectedRows,
		ErrorMessage:  result.Error,
	})

	return result, nil
}

// GetHistory returns query history for a connection
func (s *QueryService) GetHistory(connectionID string, limit int) ([]store.HistoryEntry, error) {
	return s.store.ListHistory(connectionID, limit)
}

// SaveSnippet saves a query snippet
func (s *QueryService) SaveSnippet(snippet store.Snippet) error {
	return s.store.SaveSnippet(snippet)
}

// ListSnippets returns saved snippets
func (s *QueryService) ListSnippets(connectionID string) ([]store.Snippet, error) {
	return s.store.ListSnippets(connectionID)
}

// DeleteSnippet removes a snippet
func (s *QueryService) DeleteSnippet(id int) error {
	return s.store.DeleteSnippet(id)
}
