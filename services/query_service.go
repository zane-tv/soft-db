package services

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"time"

	"soft-db/internal/driver"
	"soft-db/internal/store"
)

// QueryService handles query execution (bound to Wails frontend)
type QueryService struct {
	connService     *ConnectionService
	settingsService *SettingsService
	store           *store.Store
}

// NewQueryService creates the service
func NewQueryService(cs *ConnectionService, ss *SettingsService, s *store.Store) *QueryService {
	return &QueryService{
		connService:     cs,
		settingsService: ss,
		store:           s,
	}
}

// PaginatedResult extends QueryResult with total rows and pagination info
type PaginatedResult struct {
	*driver.QueryResult
	TotalRows  int64 `json:"totalRows"`
	Page       int   `json:"page"`
	PageSize   int   `json:"pageSize"`
	TotalPages int   `json:"totalPages"`
}

// ExecutePaginatedQuery runs a paginated SELECT * on a table and returns data + total count
func (s *QueryService) ExecutePaginatedQuery(connectionID string, table string, page int, pageSize int) (*PaginatedResult, error) {
	if table == "" {
		return nil, fmt.Errorf("table name is required")
	}
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 25
	}
	if pageSize > 10000 {
		pageSize = 10000
	}

	drv, err := s.connService.GetDriver(connectionID)
	if err != nil {
		return nil, err
	}

	timeout := time.Duration(s.settingsService.GetQueryTimeout()) * time.Second
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	dbType := drv.Type()
	offset := (page - 1) * pageSize

	// ── MongoDB: use JSON queries ──
	if dbType == driver.MongoDB {
		return s.executeMongoPaginated(ctx, drv, table, page, pageSize, offset)
	}

	// ── SQL databases: generate SELECT + COUNT ──
	quotedTable := quoteIdent(table, dbType)

	// 1. Count query
	countSQL := fmt.Sprintf("SELECT COUNT(*) AS cnt FROM %s", quotedTable)
	countResult, err := drv.Execute(ctx, countSQL)
	if err != nil {
		return nil, fmt.Errorf("count query failed: %w", err)
	}
	if countResult.Error != "" {
		return nil, fmt.Errorf("count query error: %s", countResult.Error)
	}

	var totalRows int64
	if len(countResult.Rows) > 0 {
		if v, ok := countResult.Rows[0]["cnt"]; ok {
			switch val := v.(type) {
			case float64:
				totalRows = int64(val)
			case int64:
				totalRows = val
			case int:
				totalRows = int64(val)
			}
		}
	}

	totalPages := int(math.Ceil(float64(totalRows) / float64(pageSize)))
	if totalPages < 1 {
		totalPages = 1
	}

	// 2. Data query with LIMIT/OFFSET
	var dataSQL string
	switch dbType {
	case driver.PostgreSQL, driver.Redshift:
		dataSQL = fmt.Sprintf("SELECT * FROM %s LIMIT %d OFFSET %d", quotedTable, pageSize, offset)
	default: // MySQL, MariaDB, SQLite
		dataSQL = fmt.Sprintf("SELECT * FROM %s LIMIT %d OFFSET %d", quotedTable, pageSize, offset)
	}

	dataResult, err := drv.Execute(ctx, dataSQL)
	if err != nil {
		return nil, fmt.Errorf("data query failed: %w", err)
	}
	if dataResult.Error != "" {
		return &PaginatedResult{
			QueryResult: dataResult,
			TotalRows:   totalRows,
			Page:        page,
			PageSize:    pageSize,
			TotalPages:  totalPages,
		}, nil
	}

	return &PaginatedResult{
		QueryResult: dataResult,
		TotalRows:   totalRows,
		Page:        page,
		PageSize:    pageSize,
		TotalPages:  totalPages,
	}, nil
}

// executeMongoPaginated handles paginated queries for MongoDB
func (s *QueryService) executeMongoPaginated(ctx context.Context, drv driver.Driver, collection string, page int, pageSize int, skip int) (*PaginatedResult, error) {
	// 1. Count query
	countQuery := map[string]interface{}{
		"collection": collection,
		"action":     "count",
	}
	countJSON, _ := json.Marshal(countQuery)
	countResult, err := drv.Execute(ctx, string(countJSON))
	if err != nil {
		return nil, fmt.Errorf("MongoDB count failed: %w", err)
	}

	var totalRows int64
	if len(countResult.Rows) > 0 {
		if v, ok := countResult.Rows[0]["count"]; ok {
			switch val := v.(type) {
			case float64:
				totalRows = int64(val)
			case int64:
				totalRows = val
			}
		}
	}

	totalPages := int(math.Ceil(float64(totalRows) / float64(pageSize)))
	if totalPages < 1 {
		totalPages = 1
	}

	// 2. Data query with skip + limit
	dataQuery := map[string]interface{}{
		"collection": collection,
		"action":     "find",
		"limit":      pageSize,
		"skip":       skip,
	}
	dataJSON, _ := json.Marshal(dataQuery)
	dataResult, err := drv.Execute(ctx, string(dataJSON))
	if err != nil {
		return nil, fmt.Errorf("MongoDB find failed: %w", err)
	}

	return &PaginatedResult{
		QueryResult: dataResult,
		TotalRows:   totalRows,
		Page:        page,
		PageSize:    pageSize,
		TotalPages:  totalPages,
	}, nil
}

// ExecuteQuery runs a query on the given connection and records history
func (s *QueryService) ExecuteQuery(connectionID string, query string) (*driver.QueryResult, error) {
	drv, err := s.connService.GetDriver(connectionID)
	if err != nil {
		return nil, err
	}

	timeout := time.Duration(s.settingsService.GetQueryTimeout()) * time.Second
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
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
		// MongoDB JSON queries (e.g. { "collection": "...", "action": "find" }) and SQL read-only queries
		if !strings.HasPrefix(trimmed, "SELECT") && !strings.HasPrefix(trimmed, "SHOW") &&
			!strings.HasPrefix(trimmed, "DESCRIBE") && !strings.HasPrefix(trimmed, "EXPLAIN") &&
			!strings.HasPrefix(trimmed, "PRAGMA") && !strings.HasPrefix(trimmed, "WITH") &&
			!strings.HasPrefix(strings.TrimSpace(query), "{") {
			status = "mutation"
		}
	}

	// For SELECT queries, RowCount holds the actual returned rows.
	// For DML queries (INSERT/UPDATE/DELETE), AffectedRows holds the count.
	rowsCount := result.AffectedRows
	if result.RowCount > 0 {
		rowsCount = result.RowCount
	}

	s.store.AddHistory(store.HistoryEntry{
		ConnectionID:  connectionID,
		QueryText:     query,
		Status:        status,
		ExecutionTime: result.ExecutionTime,
		RowsAffected:  rowsCount,
		ErrorMessage:  result.Error,
	})

	// Trim history to maxHistory setting
	maxHistory := s.settingsService.GetMaxHistory()
	s.store.TrimHistory(connectionID, maxHistory)

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

