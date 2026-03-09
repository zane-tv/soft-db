package services

import (
	"context"
	"fmt"
	"strings"
	"time"

	"soft-db/internal/store"
)

// EditService handles inline cell editing (bound to Wails frontend)
type EditService struct {
	connService     *ConnectionService
	queryService    *QueryService
	settingsService *SettingsService
	store           *store.Store
}

// NewEditService creates the service
func NewEditService(cs *ConnectionService, qs *QueryService, ss *SettingsService, s *store.Store) *EditService {
	return &EditService{
		connService:     cs,
		queryService:    qs,
		settingsService: ss,
		store:           s,
	}
}

// CellUpdateRequest describes a single cell update
type CellUpdateRequest struct {
	Table     string                 `json:"table"`
	PkColumns map[string]interface{} `json:"pkColumns"` // e.g. {"id": 5} or {"a": 1, "b": 2}
	Column    string                 `json:"column"`
	NewValue  interface{}            `json:"newValue"` // nil = SET NULL
}

// CellUpdateResult holds the result of a single cell update
type CellUpdateResult struct {
	GeneratedSQL string `json:"generatedSQL"`
	Success      bool   `json:"success"`
	Error        string `json:"error,omitempty"`
}

// BatchUpdateResult holds results for multiple cell updates
type BatchUpdateResult struct {
	Results      []CellUpdateResult `json:"results"`
	TotalSuccess int                `json:"totalSuccess"`
	TotalFailed  int                `json:"totalFailed"`
}

// GetTablePrimaryKey returns the primary key column names for a table
func (s *EditService) GetTablePrimaryKey(connectionID string, table string) ([]string, error) {
	drv, err := s.connService.GetDriver(connectionID)
	if err != nil {
		return nil, err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	cols, err := drv.Columns(ctx, table)
	if err != nil {
		return nil, fmt.Errorf("failed to get columns for table %s: %w", table, err)
	}

	var pkCols []string
	for _, col := range cols {
		if col.PrimaryKey {
			pkCols = append(pkCols, col.Name)
		}
	}

	if len(pkCols) == 0 {
		return nil, fmt.Errorf("table %s has no primary key — cannot edit", table)
	}

	return pkCols, nil
}

// UpdateCell executes an UPDATE for a single cell and returns the SQL + result
func (s *EditService) UpdateCell(connectionID string, req CellUpdateRequest) (*CellUpdateResult, error) {
	// Validate
	if req.Table == "" || req.Column == "" || len(req.PkColumns) == 0 {
		return &CellUpdateResult{
			Success: false,
			Error:   "missing required fields: table, column, pkColumns",
		}, nil
	}

	// Build UPDATE SQL
	sql, args := buildUpdateSQL(req)

	result := &CellUpdateResult{
		GeneratedSQL: sql,
	}

	// Execute
	drv, err := s.connService.GetDriver(connectionID)
	if err != nil {
		result.Error = err.Error()
		return result, nil
	}

	timeout := time.Duration(s.settingsService.GetQueryTimeout()) * time.Second
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	// Build the full SQL with inlined values for execution
	execSQL := buildExecSQL(req)
	qr, err := drv.Execute(ctx, execSQL)
	if err != nil {
		result.Error = err.Error()
		return result, nil
	}
	if qr.Error != "" {
		result.Error = qr.Error
		return result, nil
	}

	result.Success = true

	// Record in history
	s.store.AddHistory(store.HistoryEntry{
		ConnectionID:  connectionID,
		QueryText:     sql + " -- args: " + fmt.Sprintf("%v", args),
		Status:        "mutation",
		ExecutionTime: qr.ExecutionTime,
		RowsAffected:  qr.AffectedRows,
	})

	return result, nil
}

// BatchUpdateCells applies multiple cell edits
func (s *EditService) BatchUpdateCells(connectionID string, reqs []CellUpdateRequest) (*BatchUpdateResult, error) {
	batch := &BatchUpdateResult{
		Results: make([]CellUpdateResult, 0, len(reqs)),
	}

	for _, req := range reqs {
		result, err := s.UpdateCell(connectionID, req)
		if err != nil {
			batch.Results = append(batch.Results, CellUpdateResult{
				GeneratedSQL: "",
				Success:      false,
				Error:        err.Error(),
			})
			batch.TotalFailed++
			continue
		}
		batch.Results = append(batch.Results, *result)
		if result.Success {
			batch.TotalSuccess++
		} else {
			batch.TotalFailed++
		}
	}

	return batch, nil
}

// InsertResult holds the result of an insert operation
type InsertResult struct {
	GeneratedSQL string `json:"generatedSQL"`
	Success      bool   `json:"success"`
	Error        string `json:"error,omitempty"`
}

// InsertRow inserts a new row into the given table
func (s *EditService) InsertRow(connectionID string, table string, values map[string]interface{}) (*InsertResult, error) {
	if table == "" || len(values) == 0 {
		return &InsertResult{Success: false, Error: "missing table or values"}, nil
	}

	// Build INSERT SQL
	var cols []string
	var vals []string
	for col, val := range values {
		cols = append(cols, quoteIdent(col))
		vals = append(vals, formatValue(val))
	}

	sql := fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s)",
		quoteIdent(table),
		strings.Join(cols, ", "),
		strings.Join(vals, ", "),
	)

	result := &InsertResult{GeneratedSQL: sql}

	// Execute
	drv, err := s.connService.GetDriver(connectionID)
	if err != nil {
		result.Error = err.Error()
		return result, nil
	}

	timeout := time.Duration(s.settingsService.GetQueryTimeout()) * time.Second
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	qr, err := drv.Execute(ctx, sql)
	if err != nil {
		result.Error = err.Error()
		return result, nil
	}
	if qr.Error != "" {
		result.Error = qr.Error
		return result, nil
	}

	result.Success = true

	// Record in history
	s.store.AddHistory(store.HistoryEntry{
		ConnectionID:  connectionID,
		QueryText:     sql,
		Status:        "mutation",
		ExecutionTime: qr.ExecutionTime,
		RowsAffected:  qr.AffectedRows,
	})

	return result, nil
}

// DeleteResult holds the result of a delete operation
type DeleteResult struct {
	GeneratedSQL []string `json:"generatedSQL"`
	TotalDeleted int64    `json:"totalDeleted"`
	Success      bool     `json:"success"`
	Error        string   `json:"error,omitempty"`
}

// DeleteRows deletes one or more rows by their primary key values
func (s *EditService) DeleteRows(connectionID string, table string, pkValuesList []map[string]interface{}) (*DeleteResult, error) {
	if table == "" || len(pkValuesList) == 0 {
		return &DeleteResult{Success: false, Error: "missing table or pkValues"}, nil
	}

	drv, err := s.connService.GetDriver(connectionID)
	if err != nil {
		return &DeleteResult{Success: false, Error: err.Error()}, nil
	}

	timeout := time.Duration(s.settingsService.GetQueryTimeout()) * time.Second
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	result := &DeleteResult{
		GeneratedSQL: make([]string, 0, len(pkValuesList)),
	}

	var totalDeleted int64

	for _, pkValues := range pkValuesList {
		whereParts := make([]string, 0, len(pkValues))
		for col, val := range pkValues {
			whereParts = append(whereParts, fmt.Sprintf("%s = %s", quoteIdent(col), formatValue(val)))
		}

		sql := fmt.Sprintf("DELETE FROM %s WHERE %s",
			quoteIdent(table),
			strings.Join(whereParts, " AND "),
		)
		result.GeneratedSQL = append(result.GeneratedSQL, sql)

		qr, err := drv.Execute(ctx, sql)
		if err != nil {
			result.Error = err.Error()
			return result, nil
		}
		if qr.Error != "" {
			result.Error = qr.Error
			return result, nil
		}

		totalDeleted += qr.AffectedRows

		// Record in history
		s.store.AddHistory(store.HistoryEntry{
			ConnectionID:  connectionID,
			QueryText:     sql,
			Status:        "mutation",
			ExecutionTime: qr.ExecutionTime,
			RowsAffected:  qr.AffectedRows,
		})
	}

	result.TotalDeleted = totalDeleted
	result.Success = true
	return result, nil
}

// buildUpdateSQL creates a parameterized UPDATE statement (for display)
func buildUpdateSQL(req CellUpdateRequest) (string, []interface{}) {
	var args []interface{}

	var setCols string
	if req.NewValue == nil {
		setCols = fmt.Sprintf("%s = NULL", quoteIdent(req.Column))
	} else {
		setCols = fmt.Sprintf("%s = ?", quoteIdent(req.Column))
		args = append(args, req.NewValue)
	}

	whereParts := make([]string, 0, len(req.PkColumns))
	for col, val := range req.PkColumns {
		whereParts = append(whereParts, fmt.Sprintf("%s = ?", quoteIdent(col)))
		args = append(args, val)
	}

	sql := fmt.Sprintf("UPDATE %s SET %s WHERE %s",
		quoteIdent(req.Table),
		setCols,
		strings.Join(whereParts, " AND "),
	)

	return sql, args
}

// buildExecSQL creates an executable UPDATE with inlined values
func buildExecSQL(req CellUpdateRequest) string {
	var setCols string
	if req.NewValue == nil {
		setCols = fmt.Sprintf("%s = NULL", quoteIdent(req.Column))
	} else {
		setCols = fmt.Sprintf("%s = %s", quoteIdent(req.Column), formatValue(req.NewValue))
	}

	whereParts := make([]string, 0, len(req.PkColumns))
	for col, val := range req.PkColumns {
		whereParts = append(whereParts, fmt.Sprintf("%s = %s", quoteIdent(col), formatValue(val)))
	}

	return fmt.Sprintf("UPDATE %s SET %s WHERE %s",
		quoteIdent(req.Table),
		setCols,
		strings.Join(whereParts, " AND "),
	)
}

// quoteIdent wraps an identifier in double quotes
func quoteIdent(name string) string {
	return `"` + strings.ReplaceAll(name, `"`, `""`) + `"`
}

// formatValue converts a Go value to a SQL literal
func formatValue(v interface{}) string {
	if v == nil {
		return "NULL"
	}
	switch val := v.(type) {
	case float64:
		// JSON numbers come as float64
		if val == float64(int64(val)) {
			return fmt.Sprintf("%d", int64(val))
		}
		return fmt.Sprintf("%g", val)
	case bool:
		if val {
			return "TRUE"
		}
		return "FALSE"
	case string:
		escaped := strings.ReplaceAll(val, "'", "''")
		return fmt.Sprintf("'%s'", escaped)
	default:
		escaped := strings.ReplaceAll(fmt.Sprintf("%v", val), "'", "''")
		return fmt.Sprintf("'%s'", escaped)
	}
}
