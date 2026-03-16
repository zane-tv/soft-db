package services

import (
	"context"
	"fmt"
	"strings"
	"time"

	"soft-db/internal/driver"
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

	// Get driver
	drv, err := s.connService.GetDriver(connectionID)
	if err != nil {
		return &CellUpdateResult{Error: err.Error()}, nil
	}

	dbType := drv.Type()

	// Build parameterized UPDATE SQL
	displaySQL, execSQL, args := buildParamUpdateSQL(req, dbType)

	result := &CellUpdateResult{
		GeneratedSQL: displaySQL,
	}

	// Execute with parameterized args
	timeout := time.Duration(s.settingsService.GetQueryTimeout()) * time.Second
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	qr, err := drv.ExecuteArgs(ctx, execSQL, args...)
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
		QueryText:     displaySQL,
		Status:        "mutation",
		ExecutionTime: qr.ExecutionTime,
		RowsAffected:  qr.AffectedRows,
	})

	return result, nil
}

// BatchUpdateCells applies multiple cell edits, stopping on first error
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
			// Stop on first error to avoid partial inconsistent state
			break
		}
		batch.Results = append(batch.Results, *result)
		if result.Success {
			batch.TotalSuccess++
		} else {
			batch.TotalFailed++
			// Stop on first error
			break
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

	drv, err := s.connService.GetDriver(connectionID)
	if err != nil {
		return &InsertResult{Success: false, Error: err.Error()}, nil
	}

	dbType := drv.Type()

	// Build parameterized INSERT
	var cols []string
	var args []interface{}
	for col, val := range values {
		cols = append(cols, quoteIdent(col, dbType))
		args = append(args, val)
	}

	placeholderList := makePlaceholders(dbType, len(args))

	execSQL := fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s)",
		quoteIdent(table, dbType),
		strings.Join(cols, ", "),
		strings.Join(placeholderList, ", "),
	)

	// Build display SQL with inlined values (for history)
	var displayVals []string
	for _, val := range args {
		displayVals = append(displayVals, formatValue(val))
	}
	displaySQL := fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s)",
		quoteIdent(table, dbType),
		strings.Join(cols, ", "),
		strings.Join(displayVals, ", "),
	)

	result := &InsertResult{GeneratedSQL: displaySQL}

	// Execute with parameterized args
	timeout := time.Duration(s.settingsService.GetQueryTimeout()) * time.Second
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	qr, err := drv.ExecuteArgs(ctx, execSQL, args...)
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
		QueryText:     displaySQL,
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

	dbType := drv.Type()

	timeout := time.Duration(s.settingsService.GetQueryTimeout()) * time.Second
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	result := &DeleteResult{
		GeneratedSQL: make([]string, 0, len(pkValuesList)),
	}

	var totalDeleted int64

	for _, pkValues := range pkValuesList {
		var args []interface{}
		whereParts := make([]string, 0, len(pkValues))
		displayWhere := make([]string, 0, len(pkValues))
		argIdx := 1

		for col, val := range pkValues {
			whereParts = append(whereParts, fmt.Sprintf("%s = %s", quoteIdent(col, dbType), placeholder(dbType, argIdx)))
			displayWhere = append(displayWhere, fmt.Sprintf("%s = %s", quoteIdent(col, dbType), formatValue(val)))
			args = append(args, val)
			argIdx++
		}

		execSQL := fmt.Sprintf("DELETE FROM %s WHERE %s",
			quoteIdent(table, dbType),
			strings.Join(whereParts, " AND "),
		)
		displaySQL := fmt.Sprintf("DELETE FROM %s WHERE %s",
			quoteIdent(table, dbType),
			strings.Join(displayWhere, " AND "),
		)
		result.GeneratedSQL = append(result.GeneratedSQL, displaySQL)

		qr, err := drv.ExecuteArgs(ctx, execSQL, args...)
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
			QueryText:     displaySQL,
			Status:        "mutation",
			ExecutionTime: qr.ExecutionTime,
			RowsAffected:  qr.AffectedRows,
		})
	}

	result.TotalDeleted = totalDeleted
	result.Success = true
	return result, nil
}

// ─── SQL Builder Helpers ───

// buildParamUpdateSQL builds a parameterized UPDATE with display SQL and exec SQL
func buildParamUpdateSQL(req CellUpdateRequest, dbType driver.DatabaseType) (displaySQL, execSQL string, args []interface{}) {
	argIdx := 1

	// SET clause
	var setDisplay, setExec string
	if req.NewValue == nil {
		setDisplay = fmt.Sprintf("%s = NULL", quoteIdent(req.Column, dbType))
		setExec = setDisplay
	} else {
		setDisplay = fmt.Sprintf("%s = %s", quoteIdent(req.Column, dbType), formatValue(req.NewValue))
		setExec = fmt.Sprintf("%s = %s", quoteIdent(req.Column, dbType), placeholder(dbType, argIdx))
		args = append(args, req.NewValue)
		argIdx++
	}

	// WHERE clause
	whereDisplay := make([]string, 0, len(req.PkColumns))
	whereExec := make([]string, 0, len(req.PkColumns))
	for col, val := range req.PkColumns {
		whereDisplay = append(whereDisplay, fmt.Sprintf("%s = %s", quoteIdent(col, dbType), formatValue(val)))
		whereExec = append(whereExec, fmt.Sprintf("%s = %s", quoteIdent(col, dbType), placeholder(dbType, argIdx)))
		args = append(args, val)
		argIdx++
	}

	displaySQL = fmt.Sprintf("UPDATE %s SET %s WHERE %s",
		quoteIdent(req.Table, dbType), setDisplay, strings.Join(whereDisplay, " AND "))
	execSQL = fmt.Sprintf("UPDATE %s SET %s WHERE %s",
		quoteIdent(req.Table, dbType), setExec, strings.Join(whereExec, " AND "))

	return displaySQL, execSQL, args
}

// placeholder returns the placeholder for a given database type and position (1-indexed)
func placeholder(dbType driver.DatabaseType, pos int) string {
	switch dbType {
	case driver.PostgreSQL, driver.Redshift:
		return fmt.Sprintf("$%d", pos)
	default:
		return "?"
	}
}

// makePlaceholders creates a slice of placeholder strings for INSERT
func makePlaceholders(dbType driver.DatabaseType, count int) []string {
	result := make([]string, count)
	for i := range count {
		result[i] = placeholder(dbType, i+1)
	}
	return result
}

// quoteIdent wraps an identifier in the appropriate quote character for the database type.
// MySQL/MariaDB use backticks, PostgreSQL/Redshift/SQLite use double quotes.
func quoteIdent(name string, dbType driver.DatabaseType) string {
	switch dbType {
	case driver.MySQL, driver.MariaDB:
		return "`" + strings.ReplaceAll(name, "`", "``") + "`"
	default:
		return `"` + strings.ReplaceAll(name, `"`, `""`) + `"`
	}
}

// formatValue converts a Go value to a SQL literal (for display/history only — NOT for execution)
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
