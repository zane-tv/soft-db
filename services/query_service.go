package services

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strings"
	"sync"
	"time"

	"soft-db/internal/driver"
	"soft-db/internal/store"
)

// QueryService handles query execution (bound to Wails frontend)
type QueryService struct {
	connService     *ConnectionService
	settingsService *SettingsService
	store           *store.Store
	activeQueries   map[string]context.CancelFunc
	queryMu         sync.RWMutex
}

// NewQueryService creates the service
func NewQueryService(cs *ConnectionService, ss *SettingsService, s *store.Store) *QueryService {
	return &QueryService{
		connService:     cs,
		settingsService: ss,
		store:           s,
		activeQueries:   make(map[string]context.CancelFunc),
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

const (
	queryAnalysisStatusEmpty       = "empty"
	queryAnalysisStatusSupported   = "supported"
	queryAnalysisStatusLimited     = "limited"
	queryAnalysisStatusUnsupported = "unsupported"

	queryRiskLevelNone    = "none"
	queryRiskLevelLow     = "low"
	queryRiskLevelMedium  = "medium"
	queryRiskLevelHigh    = "high"
	queryRiskLevelUnknown = "unknown"
)

type QueryAnalysis struct {
	DatabaseType         string   `json:"databaseType"`
	Status               string   `json:"status"`
	ReadOnly             bool     `json:"readOnly"`
	Mutation             bool     `json:"mutation"`
	RiskLevel            string   `json:"riskLevel"`
	DetectedOperations   []string `json:"detectedOperations"`
	Reasons              []string `json:"reasons"`
	RequiresConfirmation bool     `json:"requiresConfirmation"`
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

	s.queryMu.Lock()
	s.activeQueries[connectionID] = cancel
	s.queryMu.Unlock()

	defer func() {
		s.queryMu.Lock()
		delete(s.activeQueries, connectionID)
		s.queryMu.Unlock()
		cancel()
	}()

	dbType := drv.Type()
	offset := (page - 1) * pageSize

	// ── MongoDB: use JSON queries ──
	if dbType == driver.MongoDB {
		return s.executeMongoPaginated(ctx, drv, table, page, pageSize, offset)
	}

	// ── Redis: execute type-aware command for key ──
	if dbType == driver.Redis {
		return s.executeRedisPaginated(ctx, drv, table)
	}

	// ── SQL databases: generate SELECT + COUNT ──
	quotedTable := quoteIdent(table, dbType)

	// 1. Count query — try estimated count first for large tables
	totalRows, err := s.getTableRowCount(ctx, drv, dbType, table, quotedTable)
	if err != nil {
		return nil, fmt.Errorf("count query failed: %w", err)
	}

	totalPages := int(math.Ceil(float64(totalRows) / float64(pageSize)))
	if totalPages < 1 {
		totalPages = 1
	}

	// 2. Determine ORDER BY clause for stable pagination
	orderByClause := s.buildOrderByClause(ctx, drv, dbType, table)

	// 3. Data query with ORDER BY + LIMIT/OFFSET
	dataSQL := fmt.Sprintf("SELECT * FROM %s%s LIMIT %d OFFSET %d", quotedTable, orderByClause, pageSize, offset)

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

func (s *QueryService) executeRedisPaginated(ctx context.Context, drv driver.Driver, key string) (*PaginatedResult, error) {
	keyType, err := drv.Execute(ctx, "TYPE "+key)
	if err != nil {
		return nil, fmt.Errorf("redis TYPE failed: %w", err)
	}

	typeName := "string"
	if len(keyType.Rows) > 0 {
		if v, ok := keyType.Rows[0]["result"]; ok {
			typeName, _ = v.(string)
		}
	}

	var cmd string
	switch typeName {
	case "hash":
		cmd = "HGETALL " + key
	case "list":
		cmd = "LRANGE " + key + " 0 999"
	case "set":
		cmd = "SMEMBERS " + key
	case "zset":
		cmd = "ZRANGE " + key + " 0 999 WITHSCORES"
	case "stream":
		cmd = "XRANGE " + key + " - + COUNT 1000"
	default:
		cmd = "GET " + key
	}

	result, err := drv.Execute(ctx, cmd)
	if err != nil {
		return nil, fmt.Errorf("redis query failed: %w", err)
	}

	return &PaginatedResult{
		QueryResult: result,
		TotalRows:   result.RowCount,
		Page:        1,
		PageSize:    int(result.RowCount),
		TotalPages:  1,
	}, nil
}

const estimatedCountThreshold int64 = 10000

func (s *QueryService) getTableRowCount(ctx context.Context, drv driver.Driver, dbType driver.DatabaseType, table string, quotedTable string) (int64, error) {
	estimated := s.getEstimatedRowCount(ctx, drv, dbType, table)
	if estimated > estimatedCountThreshold {
		return estimated, nil
	}

	countSQL := fmt.Sprintf("SELECT COUNT(*) AS cnt FROM %s", quotedTable)
	countResult, err := drv.Execute(ctx, countSQL)
	if err != nil {
		return 0, err
	}
	if countResult.Error != "" {
		return 0, fmt.Errorf("%s", countResult.Error)
	}

	if len(countResult.Rows) > 0 {
		if v, ok := countResult.Rows[0]["cnt"]; ok {
			switch val := v.(type) {
			case float64:
				return int64(val), nil
			case int64:
				return val, nil
			case int:
				return int64(val), nil
			}
		}
	}
	return 0, nil
}

func (s *QueryService) getEstimatedRowCount(ctx context.Context, drv driver.Driver, dbType driver.DatabaseType, table string) int64 {
	var estimateSQL string
	switch dbType {
	case driver.PostgreSQL, driver.Redshift:
		estimateSQL = fmt.Sprintf("SELECT reltuples::bigint AS estimate FROM pg_class WHERE relname = '%s'", table)
	case driver.MySQL, driver.MariaDB:
		estimateSQL = fmt.Sprintf("SELECT TABLE_ROWS AS estimate FROM information_schema.TABLES WHERE TABLE_NAME = '%s'", table)
	default:
		return 0
	}

	result, err := drv.Execute(ctx, estimateSQL)
	if err != nil || result.Error != "" || len(result.Rows) == 0 {
		return 0
	}

	if v, ok := result.Rows[0]["estimate"]; ok {
		switch val := v.(type) {
		case float64:
			return int64(val)
		case int64:
			return val
		case int:
			return int64(val)
		}
	}
	return 0
}

func (s *QueryService) buildOrderByClause(ctx context.Context, drv driver.Driver, dbType driver.DatabaseType, table string) string {
	columns, err := drv.Columns(ctx, table)
	if err != nil || len(columns) == 0 {
		return ""
	}

	var pkColumns []driver.ColumnInfo
	for _, col := range columns {
		if col.PrimaryKey {
			pkColumns = append(pkColumns, col)
		}
	}

	if len(pkColumns) > 0 {
		sort.Slice(pkColumns, func(i, j int) bool {
			return pkColumns[i].OrdinalPos < pkColumns[j].OrdinalPos
		})
		parts := make([]string, len(pkColumns))
		for i, col := range pkColumns {
			parts[i] = quoteIdent(col.Name, dbType)
		}
		return " ORDER BY " + strings.Join(parts, ", ")
	}

	return " ORDER BY " + quoteIdent(columns[0].Name, dbType)
}

func (s *QueryService) AnalyzeQuery(connectionID string, query string) (*QueryAnalysis, error) {
	drv, err := s.connService.GetDriver(connectionID)
	if err != nil {
		return nil, err
	}

	return analyzeQuery(query, drv.Type()), nil
}

// ExecuteQuery runs a query on the given connection and records history
func (s *QueryService) ExecuteQuery(connectionID string, query string) (*driver.QueryResult, error) {
	drv, err := s.connService.GetDriver(connectionID)
	if err != nil {
		return nil, err
	}

	timeout := time.Duration(s.settingsService.GetQueryTimeout()) * time.Second
	ctx, cancel := context.WithTimeout(context.Background(), timeout)

	// Store cancel func so CancelQuery can abort this execution
	s.queryMu.Lock()
	s.activeQueries[connectionID] = cancel
	s.queryMu.Unlock()

	defer func() {
		s.queryMu.Lock()
		delete(s.activeQueries, connectionID)
		s.queryMu.Unlock()
		cancel()
	}()

	result, err := drv.Execute(ctx, query)
	if err != nil {
		return nil, err
	}

	// Record history
	status := "success"
	if result.Error != "" {
		status = "error"
	} else {
		analysis := analyzeQuery(query, drv.Type())
		if analysis.Mutation || analysis.Status == queryAnalysisStatusUnsupported {
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

func (s *QueryService) CancelQuery(connectionID string) error {
	s.queryMu.Lock()
	cancel, ok := s.activeQueries[connectionID]
	if ok {
		cancel()
		delete(s.activeQueries, connectionID)
	}
	s.queryMu.Unlock()

	if !ok {
		return fmt.Errorf("no active query for connection: %s", connectionID)
	}
	return nil
}

func analyzeQuery(query string, dbType driver.DatabaseType) *QueryAnalysis {
	analysis := &QueryAnalysis{
		DatabaseType:       string(dbType),
		Status:             queryAnalysisStatusUnsupported,
		RiskLevel:          queryRiskLevelUnknown,
		DetectedOperations: []string{},
		Reasons:            []string{},
	}

	trimmed := strings.TrimSpace(query)
	if trimmed == "" {
		analysis.Status = queryAnalysisStatusEmpty
		analysis.Reasons = append(analysis.Reasons, "query is empty")
		return analysis
	}

	if dbType == driver.MongoDB || dbType == driver.Redis || looksLikeJSONQuery(trimmed) {
		analysis.Status = queryAnalysisStatusLimited
		analysis.Reasons = append(analysis.Reasons, "non-SQL query analysis is limited in v1")
		analysis.Reasons = append(analysis.Reasons, "limited analysis does not imply the query is safe")
		analysis.RequiresConfirmation = true
		return analysis
	}

	normalized := normalizeQuery(trimmed)
	if normalized == "" {
		analysis.Status = queryAnalysisStatusUnsupported
		analysis.Reasons = append(analysis.Reasons, "query could not be normalized for deterministic analysis")
		analysis.RequiresConfirmation = true
		return analysis
	}

	if !looksLikeSQL(normalized) {
		analysis.Status = queryAnalysisStatusUnsupported
		analysis.Reasons = append(analysis.Reasons, "query format is not recognized as supported SQL")
		analysis.Reasons = append(analysis.Reasons, "unsupported analysis does not imply the query is safe")
		analysis.RequiresConfirmation = true
		return analysis
	}

	statements := splitStatements(normalized)
	if len(statements) == 0 {
		analysis.Status = queryAnalysisStatusUnsupported
		analysis.Reasons = append(analysis.Reasons, "no executable SQL statement was detected")
		analysis.RequiresConfirmation = true
		return analysis
	}

	riskRank := 0
	readOnly := true
	mutation := false
	limited := false
	reasons := map[string]struct{}{}
	operations := map[string]struct{}{}

	for _, statement := range statements {
		tokens := strings.Fields(statement)
		if len(tokens) == 0 {
			continue
		}

		operation, statementReadOnly, statementMutation, statementLimited, statementRisk, statementReasons := classifyStatement(tokens)
		if operation != "" {
			operations[operation] = struct{}{}
		}
		for _, reason := range statementReasons {
			reasons[reason] = struct{}{}
		}

		if !statementReadOnly {
			readOnly = false
		}
		if statementMutation {
			mutation = true
		}
		if statementLimited {
			limited = true
		}
		if rank := queryRiskLevelRank(statementRisk); rank > riskRank {
			riskRank = rank
		}
	}

	analysis.Status = queryAnalysisStatusSupported
	if limited {
		analysis.Status = queryAnalysisStatusLimited
		analysis.RequiresConfirmation = true
	}
	analysis.ReadOnly = readOnly && !mutation && !limited
	analysis.Mutation = mutation
	analysis.RiskLevel = queryRiskLevelFromRank(riskRank)
	analysis.DetectedOperations = sortedKeys(operations)
	analysis.Reasons = sortedKeys(reasons)

	if len(analysis.Reasons) == 0 {
		analysis.Reasons = append(analysis.Reasons, "query was classified from leading SQL operation heuristics")
	}
	if analysis.Mutation && !analysis.RequiresConfirmation {
		analysis.RequiresConfirmation = analysis.RiskLevel == queryRiskLevelMedium || analysis.RiskLevel == queryRiskLevelHigh
	}
	if analysis.Status != queryAnalysisStatusSupported && analysis.RiskLevel == queryRiskLevelNone {
		analysis.RiskLevel = queryRiskLevelUnknown
	}

	return analysis
}

func classifyStatement(tokens []string) (string, bool, bool, bool, string, []string) {
	operation := strings.ToUpper(tokens[0])
	wordSet := sqlWordSet(strings.Join(tokens, " "))
	mutationKeywords := []string{"INSERT", "UPDATE", "DELETE", "MERGE", "UPSERT", "REPLACE", "CREATE", "DROP", "TRUNCATE", "ALTER", "RENAME", "GRANT", "REVOKE", "COMMENT", "ANALYZE", "VACUUM", "BEGIN", "COMMIT", "ROLLBACK", "SET", "USE"}

	switch operation {
	case "SELECT", "SHOW", "DESCRIBE", "DESC", "PRAGMA", "VALUES":
		return operation, true, false, false, queryRiskLevelNone, []string{"read-only SQL operation detected"}
	case "EXPLAIN":
		if containsAnyToken(wordSet, mutationKeywords...) {
			return operation, false, true, true, queryRiskLevelMedium, []string{"EXPLAIN includes a non-read-only operation and is treated conservatively"}
		}
		return operation, true, false, false, queryRiskLevelLow, []string{"EXPLAIN is treated as inspection unless a mutation keyword is present"}
	case "WITH":
		if containsAnyToken(wordSet, mutationKeywords...) {
			return operation, false, true, true, queryRiskLevelMedium, []string{"WITH statement includes mutation keywords and is treated conservatively"}
		}
		return operation, true, false, false, queryRiskLevelLow, []string{"WITH statement appears read-only from detected SQL keywords"}
	case "INSERT", "UPDATE", "DELETE", "MERGE", "UPSERT", "REPLACE":
		return operation, false, true, false, queryRiskLevelMedium, []string{"data mutation operation detected"}
	case "CREATE", "RENAME", "GRANT", "REVOKE", "COMMENT", "ANALYZE", "VACUUM", "BEGIN", "COMMIT", "ROLLBACK", "SET", "USE":
		return operation, false, true, false, queryRiskLevelMedium, []string{"state-changing SQL operation detected"}
	case "DROP", "TRUNCATE", "ALTER":
		return operation, false, true, false, queryRiskLevelHigh, []string{"destructive SQL operation detected"}
	default:
		if containsAnyToken(wordSet, mutationKeywords...) {
			return operation, false, true, true, queryRiskLevelMedium, []string{"statement contains mutation keywords but the leading operation is not fully recognized"}
		}
		return operation, false, false, true, queryRiskLevelUnknown, []string{"statement does not match supported deterministic SQL heuristics"}
	}
}

func normalizeQuery(query string) string {
	var builder strings.Builder
	inLineComment := false
	inBlockComment := false

	for i := 0; i < len(query); i++ {
		if inLineComment {
			if query[i] == '\n' {
				inLineComment = false
				builder.WriteByte(' ')
			}
			continue
		}
		if inBlockComment {
			if i+1 < len(query) && query[i] == '*' && query[i+1] == '/' {
				inBlockComment = false
				i++
			}
			continue
		}
		if i+1 < len(query) && query[i] == '-' && query[i+1] == '-' {
			inLineComment = true
			i++
			continue
		}
		if i+1 < len(query) && query[i] == '/' && query[i+1] == '*' {
			inBlockComment = true
			i++
			continue
		}
		builder.WriteByte(query[i])
	}

	return strings.ToUpper(strings.TrimSpace(builder.String()))
}

func splitStatements(normalized string) []string {
	rawStatements := strings.Split(normalized, ";")
	statements := make([]string, 0, len(rawStatements))
	for _, statement := range rawStatements {
		trimmed := strings.TrimSpace(statement)
		if trimmed != "" {
			statements = append(statements, trimmed)
		}
	}
	return statements
}

func looksLikeJSONQuery(query string) bool {
	if !(strings.HasPrefix(query, "{") || strings.HasPrefix(query, "[")) {
		return false
	}
	return json.Valid([]byte(query))
}

func looksLikeSQL(normalized string) bool {
	tokens := strings.Fields(normalized)
	if len(tokens) == 0 {
		return false
	}

	knownStarters := []string{"SELECT", "SHOW", "DESCRIBE", "DESC", "EXPLAIN", "PRAGMA", "WITH", "VALUES", "INSERT", "UPDATE", "DELETE", "MERGE", "UPSERT", "REPLACE", "CREATE", "DROP", "TRUNCATE", "ALTER", "RENAME", "GRANT", "REVOKE", "COMMENT", "ANALYZE", "VACUUM", "BEGIN", "COMMIT", "ROLLBACK", "SET", "USE"}
	return containsAnyToken(map[string]struct{}{tokens[0]: {}}, knownStarters...)
}

func containsAnyToken(tokens map[string]struct{}, words ...string) bool {
	for _, word := range words {
		if _, ok := tokens[word]; ok {
			return true
		}
	}
	return false
}

func sqlWordSet(statement string) map[string]struct{} {
	tokens := strings.FieldsFunc(statement, func(r rune) bool {
		return !(r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '_')
	})
	wordSet := make(map[string]struct{}, len(tokens))
	for _, token := range tokens {
		if token == "" {
			continue
		}
		wordSet[token] = struct{}{}
	}
	return wordSet
}

func queryRiskLevelRank(level string) int {
	switch level {
	case queryRiskLevelNone:
		return 0
	case queryRiskLevelLow:
		return 1
	case queryRiskLevelMedium:
		return 2
	case queryRiskLevelHigh:
		return 3
	default:
		return 4
	}
}

func queryRiskLevelFromRank(rank int) string {
	switch rank {
	case 0:
		return queryRiskLevelNone
	case 1:
		return queryRiskLevelLow
	case 2:
		return queryRiskLevelMedium
	case 3:
		return queryRiskLevelHigh
	default:
		return queryRiskLevelUnknown
	}
}

func sortedKeys(values map[string]struct{}) []string {
	if len(values) == 0 {
		return []string{}
	}

	keys := make([]string, 0, len(values))
	for value := range values {
		keys = append(keys, value)
	}
	sort.Strings(keys)
	return keys
}

// ExplainQuery runs EXPLAIN (ANALYZE, FORMAT JSON) for PostgreSQL queries and returns the JSON result.
// Returns an error for unsupported database types.
func (s *QueryService) ExplainQuery(connectionID string, query string) (string, error) {
	drv, err := s.connService.GetDriver(connectionID)
	if err != nil {
		return "", err
	}

	dbType := drv.Type()
	if dbType != driver.PostgreSQL && dbType != driver.Redshift {
		return "", fmt.Errorf("EXPLAIN visualization is only supported for PostgreSQL connections")
	}

	trimmed := strings.TrimSpace(query)
	if trimmed == "" {
		return "", fmt.Errorf("query is empty")
	}
	// Strip trailing semicolons — EXPLAIN doesn't allow them
	trimmed = strings.TrimRight(trimmed, "; \t\n")

	explainSQL := fmt.Sprintf("EXPLAIN (ANALYZE, FORMAT JSON) %s", trimmed)

	timeout := time.Duration(s.settingsService.GetQueryTimeout()) * time.Second
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	result, err := drv.Execute(ctx, explainSQL)
	if err != nil {
		return "", fmt.Errorf("explain query failed: %w", err)
	}
	if result.Error != "" {
		return "", fmt.Errorf("%s", result.Error)
	}

	// PostgreSQL EXPLAIN (FORMAT JSON) returns a single row with a single column "QUERY PLAN"
	if len(result.Rows) > 0 {
		for _, row := range result.Rows {
			for _, v := range row {
				switch val := v.(type) {
				case string:
					return val, nil
				default:
					jsonBytes, err := json.Marshal(v)
					if err != nil {
						return "", fmt.Errorf("failed to serialize explain result: %w", err)
					}
					return string(jsonBytes), nil
				}
			}
		}
	}

	return "[]", nil
}

// IsDestructiveQuery checks whether a query is destructive (DELETE, DROP, TRUNCATE, UPDATE without WHERE).
// Used by safe mode to intercept dangerous queries.
func (s *QueryService) IsDestructiveQuery(connectionID string, query string) (bool, error) {
	drv, err := s.connService.GetDriver(connectionID)
	if err != nil {
		return false, err
	}
	return isDestructiveQuery(query, drv.Type()), nil
}

func isDestructiveQuery(query string, dbType driver.DatabaseType) bool {
	if dbType == driver.MongoDB || dbType == driver.Redis {
		return false
	}

	trimmed := strings.TrimSpace(query)
	if trimmed == "" {
		return false
	}

	normalized := normalizeQuery(strings.ToUpper(trimmed))
	if normalized == "" {
		return false
	}

	statements := splitStatements(normalized)
	for _, stmt := range statements {
		tokens := strings.Fields(stmt)
		if len(tokens) == 0 {
			continue
		}
		op := tokens[0]
		switch op {
		case "DROP", "TRUNCATE":
			return true
		case "DELETE":
			if !containsWord(stmt, "WHERE") {
				return true
			}
		case "UPDATE":
			if !containsWord(stmt, "WHERE") {
				return true
			}
		case "ALTER":
			if containsWord(stmt, "DROP") {
				return true
			}
		}
	}
	return false
}

func containsWord(normalized string, word string) bool {
	idx := strings.Index(normalized, word)
	if idx < 0 {
		return false
	}
	if idx > 0 {
		prev := normalized[idx-1]
		if prev >= 'A' && prev <= 'Z' || prev == '_' {
			return false
		}
	}
	end := idx + len(word)
	if end < len(normalized) {
		next := normalized[end]
		if next >= 'A' && next <= 'Z' || next == '_' {
			return false
		}
	}
	return true
}

// GetHistory returns query history for a connection
func (s *QueryService) GetHistory(connectionID string, limit int) ([]store.HistoryEntry, error) {
	return s.store.ListHistory(connectionID, limit)
}

func (s *QueryService) CreateSnippet(connectionID string, snippet store.Snippet) (store.Snippet, error) {
	snippet = prepareSnippetForConnection(connectionID, snippet)
	return s.store.CreateSnippet(snippet)
}

func (s *QueryService) UpdateSnippet(connectionID string, snippet store.Snippet) (store.Snippet, error) {
	snippet = prepareSnippetForConnection(connectionID, snippet)
	return s.store.UpdateSnippet(strings.TrimSpace(connectionID), snippet)
}

func (s *QueryService) MoveSnippet(connectionID string, id int, folderPath string) (store.Snippet, error) {
	return s.store.MoveSnippet(strings.TrimSpace(connectionID), id, folderPath)
}

func (s *QueryService) ListSnippetsWithFilter(filter store.SnippetListFilter) ([]store.Snippet, error) {
	filter.ConnectionID = strings.TrimSpace(filter.ConnectionID)
	return s.store.ListSnippetsWithFilter(filter)
}

func (s *QueryService) DeleteSnippetForConnection(connectionID string, id int) error {
	return s.store.DeleteSnippetForConnection(strings.TrimSpace(connectionID), id)
}

// SaveSnippet saves a query snippet
func (s *QueryService) SaveSnippet(snippet store.Snippet) error {
	snippet = normalizeSnippetPayload(snippet)
	return s.store.SaveSnippet(snippet)
}

// ListSnippets returns saved snippets
func (s *QueryService) ListSnippets(connectionID string) ([]store.Snippet, error) {
	return s.store.ListSnippets(strings.TrimSpace(connectionID))
}

// DeleteSnippet removes a snippet
func (s *QueryService) DeleteSnippet(id int) error {
	return s.store.DeleteSnippet(id)
}

func normalizeSnippetPayload(snippet store.Snippet) store.Snippet {
	snippet.ConnectionID = strings.TrimSpace(snippet.ConnectionID)
	snippet.Scope = strings.TrimSpace(strings.ToLower(snippet.Scope))
	snippet.FolderPath = strings.TrimSpace(snippet.FolderPath)
	if snippet.ConnectionID == "" {
		snippet.Scope = "global"
	} else {
		snippet.Scope = "connection"
	}
	if snippet.Tags == nil {
		snippet.Tags = []string{}
	}
	return snippet
}

func prepareSnippetForConnection(connectionID string, snippet store.Snippet) store.Snippet {
	connectionID = strings.TrimSpace(connectionID)
	snippet = normalizeSnippetPayload(snippet)

	switch snippet.Scope {
	case "global":
		snippet.ConnectionID = ""
	case "connection":
		if connectionID != "" {
			snippet.ConnectionID = connectionID
		}
	}

	return normalizeSnippetPayload(snippet)
}
