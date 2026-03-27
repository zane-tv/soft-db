package services

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"soft-db/internal/driver"
	"soft-db/internal/store"
)

func newTestQueryService(t *testing.T, connID string, drv driver.Driver) *QueryService {
	t.Helper()
	s := newTestStore(t)
	ss := NewSettingsService(s)
	cs := NewConnectionService(s, ss)
	if drv != nil && connID != "" {
		if _, err := cs.SaveConnection(driver.ConnectionConfig{
			ID:   connID,
			Name: "test-" + connID,
			Type: drv.Type(),
		}); err != nil {
			t.Fatalf("SaveConnection for test: %v", err)
		}
		cs.mu.Lock()
		cs.drivers[connID] = drv
		cs.configs[connID] = driver.ConnectionConfig{ID: connID, Type: drv.Type()}
		cs.mu.Unlock()
	}
	return NewQueryService(cs, ss, s)
}

func TestAnalyzeQuery_Empty(t *testing.T) {
	t.Parallel()
	a := analyzeQuery("", driver.PostgreSQL)
	if a.Status != queryAnalysisStatusEmpty {
		t.Errorf("status = %q, want %q", a.Status, queryAnalysisStatusEmpty)
	}
}

func TestAnalyzeQuery_Select_ReadOnly(t *testing.T) {
	t.Parallel()
	queries := []string{
		"SELECT * FROM users",
		"SELECT id, name FROM users WHERE id = 1",
		"SELECT COUNT(*) FROM orders",
		"SHOW TABLES",
		"DESCRIBE users",
	}
	for _, q := range queries {
		a := analyzeQuery(q, driver.PostgreSQL)
		if a.Status != queryAnalysisStatusSupported {
			t.Errorf("query=%q status=%q, want %q", q, a.Status, queryAnalysisStatusSupported)
		}
		if !a.ReadOnly {
			t.Errorf("query=%q ReadOnly=false, want true", q)
		}
		if a.Mutation {
			t.Errorf("query=%q Mutation=true, want false", q)
		}
		if a.RiskLevel != queryRiskLevelNone {
			t.Errorf("query=%q RiskLevel=%q, want %q", q, a.RiskLevel, queryRiskLevelNone)
		}
	}
}

func TestAnalyzeQuery_Mutation_Medium(t *testing.T) {
	t.Parallel()
	queries := []string{
		"INSERT INTO users (name) VALUES ('test')",
		"UPDATE users SET name='test' WHERE id=1",
		"DELETE FROM users WHERE id=1",
		"MERGE INTO users",
	}
	for _, q := range queries {
		a := analyzeQuery(q, driver.PostgreSQL)
		if !a.Mutation {
			t.Errorf("query=%q Mutation=false, want true", q)
		}
		if a.RiskLevel != queryRiskLevelMedium {
			t.Errorf("query=%q RiskLevel=%q, want %q", q, a.RiskLevel, queryRiskLevelMedium)
		}
	}
}

func TestAnalyzeQuery_Destructive_High(t *testing.T) {
	t.Parallel()
	queries := []string{
		"DROP TABLE users",
		"TRUNCATE TABLE orders",
		"ALTER TABLE users DROP COLUMN email",
	}
	for _, q := range queries {
		a := analyzeQuery(q, driver.PostgreSQL)
		if a.RiskLevel != queryRiskLevelHigh {
			t.Errorf("query=%q RiskLevel=%q, want %q", q, a.RiskLevel, queryRiskLevelHigh)
		}
	}
}

func TestAnalyzeQuery_MongoDB_Limited(t *testing.T) {
	t.Parallel()
	a := analyzeQuery(`{"find": "users"}`, driver.MongoDB)
	if a.Status != queryAnalysisStatusLimited {
		t.Errorf("status = %q, want %q", a.Status, queryAnalysisStatusLimited)
	}
	if !a.RequiresConfirmation {
		t.Error("RequiresConfirmation = false, want true")
	}
}

func TestAnalyzeQuery_Redis_Limited(t *testing.T) {
	t.Parallel()
	a := analyzeQuery("GET mykey", driver.Redis)
	if a.Status != queryAnalysisStatusLimited {
		t.Errorf("status = %q, want %q", a.Status, queryAnalysisStatusLimited)
	}
}

func TestAnalyzeQuery_MultiStatement(t *testing.T) {
	t.Parallel()
	a := analyzeQuery("SELECT 1; DROP TABLE users", driver.PostgreSQL)
	if a.RiskLevel != queryRiskLevelHigh {
		t.Errorf("multi-stmt: RiskLevel=%q, want %q", a.RiskLevel, queryRiskLevelHigh)
	}
}

func TestIsDestructiveQuery_Drop(t *testing.T) {
	t.Parallel()
	if !isDestructiveQuery("DROP TABLE users", driver.PostgreSQL) {
		t.Error("DROP TABLE should be destructive")
	}
}

func TestIsDestructiveQuery_Truncate(t *testing.T) {
	t.Parallel()
	if !isDestructiveQuery("TRUNCATE TABLE users", driver.PostgreSQL) {
		t.Error("TRUNCATE TABLE should be destructive")
	}
}

func TestIsDestructiveQuery_DeleteWithWhere(t *testing.T) {
	t.Parallel()
	if isDestructiveQuery("DELETE FROM users WHERE id = 1", driver.PostgreSQL) {
		t.Error("DELETE with WHERE should not be destructive")
	}
}

func TestIsDestructiveQuery_DeleteWithoutWhere(t *testing.T) {
	t.Parallel()
	if !isDestructiveQuery("DELETE FROM users", driver.PostgreSQL) {
		t.Error("DELETE without WHERE should be destructive")
	}
}

func TestIsDestructiveQuery_UpdateWithoutWhere(t *testing.T) {
	t.Parallel()
	if !isDestructiveQuery("UPDATE users SET name = 'x'", driver.PostgreSQL) {
		t.Error("UPDATE without WHERE should be destructive")
	}
}

func TestIsDestructiveQuery_UpdateWithWhere(t *testing.T) {
	t.Parallel()
	if isDestructiveQuery("UPDATE users SET name = 'x' WHERE id = 1", driver.PostgreSQL) {
		t.Error("UPDATE with WHERE should not be destructive")
	}
}

func TestIsDestructiveQuery_Select(t *testing.T) {
	t.Parallel()
	if isDestructiveQuery("SELECT * FROM users", driver.PostgreSQL) {
		t.Error("SELECT should not be destructive")
	}
}

func TestIsDestructiveQuery_MongoDB_NeverDestructive(t *testing.T) {
	t.Parallel()
	if isDestructiveQuery("DROP TABLE users", driver.MongoDB) {
		t.Error("MongoDB queries should never be flagged as destructive")
	}
}

func TestIsDestructiveQuery_AlterDropColumn(t *testing.T) {
	t.Parallel()
	if !isDestructiveQuery("ALTER TABLE users DROP COLUMN email", driver.PostgreSQL) {
		t.Error("ALTER TABLE DROP COLUMN should be destructive")
	}
}

func TestIsDestructiveQuery_Empty(t *testing.T) {
	t.Parallel()
	if isDestructiveQuery("", driver.PostgreSQL) {
		t.Error("empty query should not be destructive")
	}
}

func TestNormalizeQuery_LineComments(t *testing.T) {
	t.Parallel()
	result := normalizeQuery("SELECT * FROM users -- this is a comment\nWHERE id = 1")
	if strings.Contains(result, "COMMENT") {
		t.Errorf("line comment not removed: %q", result)
	}
}

func TestNormalizeQuery_BlockComments(t *testing.T) {
	t.Parallel()
	result := normalizeQuery("SELECT * /* inline comment */ FROM users")
	if strings.Contains(result, "INLINE") {
		t.Errorf("block comment not removed: %q", result)
	}
}

func TestNormalizeQuery_Uppercase(t *testing.T) {
	t.Parallel()
	if got := normalizeQuery("select 1"); got != "SELECT 1" {
		t.Errorf("normalizeQuery = %q, want %q", got, "SELECT 1")
	}
}

func TestNormalizeQuery_Empty(t *testing.T) {
	t.Parallel()
	if got := normalizeQuery("   "); got != "" {
		t.Errorf("normalizeQuery spaces = %q, want empty", got)
	}
}

func TestSplitStatements_Multiple(t *testing.T) {
	t.Parallel()
	stmts := splitStatements("SELECT 1; SELECT 2; SELECT 3")
	if len(stmts) != 3 {
		t.Errorf("expected 3 statements, got %d: %v", len(stmts), stmts)
	}
}

func TestSplitStatements_TrailingSemicolons(t *testing.T) {
	t.Parallel()
	stmts := splitStatements("SELECT 1;;;")
	if len(stmts) != 1 {
		t.Errorf("expected 1 statement, got %d", len(stmts))
	}
}

func TestLooksLikeSQL_Recognized(t *testing.T) {
	t.Parallel()
	for _, q := range []string{"SELECT 1", "INSERT INTO t", "DROP TABLE x", "WITH cte AS"} {
		if !looksLikeSQL(q) {
			t.Errorf("looksLikeSQL(%q) = false, want true", q)
		}
	}
}

func TestLooksLikeSQL_NotSQL(t *testing.T) {
	t.Parallel()
	if looksLikeSQL("HGETALL mykey") {
		t.Error("HGETALL should not look like SQL")
	}
}

func TestLooksLikeJSONQuery_Object(t *testing.T) {
	t.Parallel()
	if !looksLikeJSONQuery(`{"find": "users"}`) {
		t.Error("JSON object should be detected as JSON query")
	}
}

func TestLooksLikeJSONQuery_Array(t *testing.T) {
	t.Parallel()
	if !looksLikeJSONQuery(`[{"$match": {}}]`) {
		t.Error("JSON array should be detected as JSON query")
	}
}

func TestLooksLikeJSONQuery_NotJSON(t *testing.T) {
	t.Parallel()
	if looksLikeJSONQuery("SELECT * FROM users") {
		t.Error("SQL should not be detected as JSON query")
	}
}

func TestQueryRiskLevelRank_Ordering(t *testing.T) {
	t.Parallel()
	if queryRiskLevelRank(queryRiskLevelNone) >= queryRiskLevelRank(queryRiskLevelHigh) {
		t.Error("none rank should be less than high rank")
	}
	if queryRiskLevelRank(queryRiskLevelLow) >= queryRiskLevelRank(queryRiskLevelMedium) {
		t.Error("low rank should be less than medium rank")
	}
}

func TestQueryRiskLevelFromRank(t *testing.T) {
	t.Parallel()
	cases := []struct {
		rank int
		want string
	}{
		{0, queryRiskLevelNone},
		{1, queryRiskLevelLow},
		{2, queryRiskLevelMedium},
		{3, queryRiskLevelHigh},
		{99, queryRiskLevelUnknown},
	}
	for _, c := range cases {
		if got := queryRiskLevelFromRank(c.rank); got != c.want {
			t.Errorf("rank=%d: %q, want %q", c.rank, got, c.want)
		}
	}
}

func TestQueryService_ExecuteQuery_Success(t *testing.T) {
	t.Parallel()
	drv := &mockDriver{
		dbType:      driver.PostgreSQL,
		isConnected: true,
		executeFunc: func(_ context.Context, _ string) (*driver.QueryResult, error) {
			return &driver.QueryResult{
				Columns:  []driver.ColumnMeta{{Name: "id", Type: "integer"}},
				Rows:     []map[string]interface{}{{"id": int64(1)}},
				RowCount: 1,
			}, nil
		},
	}
	qs := newTestQueryService(t, "conn-1", drv)

	result, err := qs.ExecuteQuery("conn-1", "SELECT * FROM users")
	if err != nil {
		t.Fatalf("ExecuteQuery: %v", err)
	}
	if result.RowCount != 1 {
		t.Errorf("RowCount = %d, want 1", result.RowCount)
	}
}

func TestQueryService_ExecuteQuery_NoConnection(t *testing.T) {
	t.Parallel()
	qs := newTestQueryService(t, "", nil)

	_, err := qs.ExecuteQuery("not-connected", "SELECT 1")
	if err == nil {
		t.Fatal("expected error for inactive connection")
	}
}

func TestQueryService_ExecuteQuery_DriverError(t *testing.T) {
	t.Parallel()
	drv := &mockDriver{
		dbType:      driver.PostgreSQL,
		isConnected: true,
		executeFunc: func(_ context.Context, _ string) (*driver.QueryResult, error) {
			return nil, fmt.Errorf("connection reset")
		},
	}
	qs := newTestQueryService(t, "conn-1", drv)

	_, err := qs.ExecuteQuery("conn-1", "SELECT 1")
	if err == nil {
		t.Fatal("expected error from driver")
	}
}

func TestQueryService_ExecuteQuery_RecordsHistory(t *testing.T) {
	t.Parallel()
	drv := &mockDriver{
		dbType:      driver.PostgreSQL,
		isConnected: true,
		executeFunc: func(_ context.Context, _ string) (*driver.QueryResult, error) {
			return &driver.QueryResult{RowCount: 5}, nil
		},
	}
	qs := newTestQueryService(t, "conn-1", drv)

	if _, err := qs.ExecuteQuery("conn-1", "SELECT * FROM users"); err != nil {
		t.Fatalf("ExecuteQuery: %v", err)
	}

	history, err := qs.GetHistory("conn-1", 10)
	if err != nil {
		t.Fatalf("GetHistory: %v", err)
	}
	if len(history) == 0 {
		t.Error("expected history entry after ExecuteQuery")
	}
}

func TestQueryService_CancelQuery_Active(t *testing.T) {
	t.Parallel()
	qs := newTestQueryService(t, "", nil)

	qs.queryMu.Lock()
	qs.activeQueries["conn-1"] = func() {}
	qs.queryMu.Unlock()

	if err := qs.CancelQuery("conn-1"); err != nil {
		t.Errorf("CancelQuery: %v", err)
	}

	qs.queryMu.RLock()
	_, stillActive := qs.activeQueries["conn-1"]
	qs.queryMu.RUnlock()

	if stillActive {
		t.Error("expected active query to be removed after cancel")
	}
}

func TestQueryService_CancelQuery_NoneActive(t *testing.T) {
	t.Parallel()
	qs := newTestQueryService(t, "", nil)

	if err := qs.CancelQuery("conn-1"); err == nil {
		t.Error("expected error when no active query")
	}
}

func TestQueryService_ExplainQuery_NonPostgres(t *testing.T) {
	t.Parallel()
	drv := &mockDriver{dbType: driver.MySQL, isConnected: true}
	qs := newTestQueryService(t, "conn-1", drv)

	_, err := qs.ExplainQuery("conn-1", "SELECT * FROM users")
	if err == nil {
		t.Fatal("expected error for non-PostgreSQL")
	}
}

func TestQueryService_ExplainQuery_EmptyQuery(t *testing.T) {
	t.Parallel()
	drv := &mockDriver{dbType: driver.PostgreSQL, isConnected: true}
	qs := newTestQueryService(t, "conn-1", drv)

	_, err := qs.ExplainQuery("conn-1", "   ")
	if err == nil {
		t.Fatal("expected error for empty query")
	}
}

func TestQueryService_ExplainQuery_PostgreSQL_Success(t *testing.T) {
	t.Parallel()
	drv := &mockDriver{
		dbType:      driver.PostgreSQL,
		isConnected: true,
		executeFunc: func(_ context.Context, _ string) (*driver.QueryResult, error) {
			return &driver.QueryResult{
				Rows: []map[string]interface{}{
					{"QUERY PLAN": `[{"Plan": {"Node Type": "Seq Scan"}}]`},
				},
			}, nil
		},
	}
	qs := newTestQueryService(t, "conn-1", drv)

	result, err := qs.ExplainQuery("conn-1", "SELECT * FROM users")
	if err != nil {
		t.Fatalf("ExplainQuery: %v", err)
	}
	if result == "" {
		t.Error("expected non-empty explain result")
	}
}

func TestQueryService_ExplainQuery_StripsSemicolon(t *testing.T) {
	t.Parallel()
	var captured string
	drv := &mockDriver{
		dbType:      driver.PostgreSQL,
		isConnected: true,
		executeFunc: func(_ context.Context, query string) (*driver.QueryResult, error) {
			captured = query
			return &driver.QueryResult{Rows: []map[string]interface{}{{"QUERY PLAN": "[]"}}}, nil
		},
	}
	qs := newTestQueryService(t, "conn-1", drv)

	qs.ExplainQuery("conn-1", "SELECT 1;")
	if strings.HasSuffix(captured, ";") {
		t.Errorf("expected trailing semicolon stripped, got: %q", captured)
	}
}

func TestQueryService_IsDestructiveQuery(t *testing.T) {
	t.Parallel()
	drv := &mockDriver{dbType: driver.PostgreSQL, isConnected: true}
	qs := newTestQueryService(t, "conn-1", drv)

	cases := []struct {
		query string
		want  bool
	}{
		{"DROP TABLE users", true},
		{"SELECT * FROM users", false},
		{"DELETE FROM users", true},
		{"DELETE FROM users WHERE id = 1", false},
		{"UPDATE users SET name='x'", true},
		{"UPDATE users SET name='x' WHERE id=1", false},
	}
	for _, c := range cases {
		got, err := qs.IsDestructiveQuery("conn-1", c.query)
		if err != nil {
			t.Fatalf("IsDestructiveQuery(%q): %v", c.query, err)
		}
		if got != c.want {
			t.Errorf("IsDestructiveQuery(%q) = %v, want %v", c.query, got, c.want)
		}
	}
}

func TestQueryService_AnalyzeQuery(t *testing.T) {
	t.Parallel()
	drv := &mockDriver{dbType: driver.PostgreSQL, isConnected: true}
	qs := newTestQueryService(t, "conn-1", drv)

	analysis, err := qs.AnalyzeQuery("conn-1", "SELECT * FROM users")
	if err != nil {
		t.Fatalf("AnalyzeQuery: %v", err)
	}
	if !analysis.ReadOnly {
		t.Error("SELECT should be ReadOnly")
	}
}

func TestQueryService_BuildOrderByClause_WithPK(t *testing.T) {
	t.Parallel()
	drv := &mockDriver{
		dbType:      driver.PostgreSQL,
		isConnected: true,
		columnsFunc: func(_ context.Context, _ string) ([]driver.ColumnInfo, error) {
			return []driver.ColumnInfo{
				{Name: "id", Type: "integer", PrimaryKey: true, OrdinalPos: 1},
				{Name: "name", Type: "text", OrdinalPos: 2},
			}, nil
		},
	}
	cs := newConnServiceWithDriver(t, "conn-1", drv)
	ss := NewSettingsService(newTestStore(t))
	qs := NewQueryService(cs, ss, newTestStore(t))

	clause := qs.buildOrderByClause(context.Background(), drv, driver.PostgreSQL, "users")
	if clause == "" {
		t.Error("expected ORDER BY clause for table with primary key")
	}
	if !strings.Contains(clause, "id") {
		t.Errorf("ORDER BY clause should contain pk column 'id', got %q", clause)
	}
}

func TestQueryService_BuildOrderByClause_NoPK_FallsBackToFirstColumn(t *testing.T) {
	t.Parallel()
	drv := &mockDriver{
		dbType:      driver.PostgreSQL,
		isConnected: true,
		columnsFunc: func(_ context.Context, _ string) ([]driver.ColumnInfo, error) {
			return []driver.ColumnInfo{
				{Name: "email", Type: "text", OrdinalPos: 1},
			}, nil
		},
	}
	cs := newConnServiceWithDriver(t, "conn-1", drv)
	ss := NewSettingsService(newTestStore(t))
	qs := NewQueryService(cs, ss, newTestStore(t))

	clause := qs.buildOrderByClause(context.Background(), drv, driver.PostgreSQL, "users")
	if !strings.Contains(clause, "email") {
		t.Errorf("ORDER BY should fall back to first column 'email', got %q", clause)
	}
}

func TestQueryService_BuildOrderByClause_NoColumns(t *testing.T) {
	t.Parallel()
	drv := &mockDriver{
		dbType:      driver.PostgreSQL,
		isConnected: true,
		columnsFunc: func(_ context.Context, _ string) ([]driver.ColumnInfo, error) {
			return []driver.ColumnInfo{}, nil
		},
	}
	cs := newConnServiceWithDriver(t, "conn-1", drv)
	ss := NewSettingsService(newTestStore(t))
	qs := NewQueryService(cs, ss, newTestStore(t))

	clause := qs.buildOrderByClause(context.Background(), drv, driver.PostgreSQL, "empty_table")
	if clause != "" {
		t.Errorf("expected empty clause for table with no columns, got %q", clause)
	}
}

func TestNormalizeSnippetPayload_GlobalScope(t *testing.T) {
	t.Parallel()
	s := normalizeSnippetPayload(SnippetPayload())
	if s.Scope != "global" {
		t.Errorf("scope = %q, want %q", s.Scope, "global")
	}
}

func SnippetPayload() store.Snippet {
	return store.Snippet{ConnectionID: "", QueryText: "SELECT 1", Tags: nil}
}

func TestContainsWord(t *testing.T) {
	t.Parallel()
	cases := []struct {
		normalized string
		word       string
		want       bool
	}{
		{"DELETE FROM USERS WHERE ID = 1", "WHERE", true},
		{"DELETE FROM USERS", "WHERE", false},
		{"NOWHERE", "WHERE", false},
		{"WHERE_CLAUSE", "WHERE", false},
	}
	for _, c := range cases {
		got := containsWord(c.normalized, c.word)
		if got != c.want {
			t.Errorf("containsWord(%q, %q) = %v, want %v", c.normalized, c.word, got, c.want)
		}
	}
}

func TestClassifyStatement_AllOperations(t *testing.T) {
	t.Parallel()
	cases := []struct {
		tokens   []string
		wantOp   string
		wantMut  bool
		wantRisk string
	}{
		{[]string{"SELECT", "*", "FROM", "T"}, "SELECT", false, queryRiskLevelNone},
		{[]string{"INSERT", "INTO", "T"}, "INSERT", true, queryRiskLevelMedium},
		{[]string{"UPDATE", "T", "SET"}, "UPDATE", true, queryRiskLevelMedium},
		{[]string{"DELETE", "FROM", "T"}, "DELETE", true, queryRiskLevelMedium},
		{[]string{"DROP", "TABLE", "T"}, "DROP", true, queryRiskLevelHigh},
		{[]string{"TRUNCATE", "TABLE", "T"}, "TRUNCATE", true, queryRiskLevelHigh},
		{[]string{"ALTER", "TABLE", "T"}, "ALTER", true, queryRiskLevelHigh},
		{[]string{"CREATE", "TABLE", "T"}, "CREATE", true, queryRiskLevelMedium},
		{[]string{"EXPLAIN", "SELECT"}, "EXPLAIN", false, queryRiskLevelLow},
		{[]string{"WITH", "CTE", "AS"}, "WITH", false, queryRiskLevelLow},
		{[]string{"SHOW", "TABLES"}, "SHOW", false, queryRiskLevelNone},
	}
	for _, c := range cases {
		op, _, mut, _, risk, _ := classifyStatement(c.tokens)
		if op != c.wantOp {
			t.Errorf("tokens=%v: op=%q, want %q", c.tokens, op, c.wantOp)
		}
		if mut != c.wantMut {
			t.Errorf("tokens=%v: mutation=%v, want %v", c.tokens, mut, c.wantMut)
		}
		if risk != c.wantRisk {
			t.Errorf("tokens=%v: risk=%q, want %q", c.tokens, risk, c.wantRisk)
		}
	}
}

func TestQueryService_ExecutePaginatedQuery_EmptyTable(t *testing.T) {
	t.Parallel()
	qs := newTestQueryService(t, "", nil)

	_, err := qs.ExecutePaginatedQuery("conn-1", "", 1, 25)
	if err == nil {
		t.Fatal("expected error for empty table name")
	}
}

func TestQueryService_ExecutePaginatedQuery_NoConnection(t *testing.T) {
	t.Parallel()
	qs := newTestQueryService(t, "", nil)

	_, err := qs.ExecutePaginatedQuery("missing", "users", 1, 25)
	if err == nil {
		t.Fatal("expected error for missing connection")
	}
}

func TestQueryService_ExecutePaginatedQuery_SQL_Success(t *testing.T) {
	t.Parallel()
	callCount := 0
	drv := &mockDriver{
		dbType:      driver.PostgreSQL,
		isConnected: true,
		executeFunc: func(_ context.Context, query string) (*driver.QueryResult, error) {
			callCount++
			if strings.Contains(query, "COUNT") {
				return &driver.QueryResult{
					Rows: []map[string]interface{}{{"cnt": int64(10)}},
				}, nil
			}
			return &driver.QueryResult{
				Columns:  []driver.ColumnMeta{{Name: "id", Type: "integer"}},
				Rows:     []map[string]interface{}{{"id": int64(1)}},
				RowCount: 1,
			}, nil
		},
		columnsFunc: func(_ context.Context, _ string) ([]driver.ColumnInfo, error) {
			return []driver.ColumnInfo{{Name: "id", Type: "integer", PrimaryKey: true, OrdinalPos: 1}}, nil
		},
	}
	qs := newTestQueryService(t, "conn-1", drv)

	result, err := qs.ExecutePaginatedQuery("conn-1", "users", 1, 25)
	if err != nil {
		t.Fatalf("ExecutePaginatedQuery: %v", err)
	}
	if result.TotalRows != 10 {
		t.Errorf("TotalRows = %d, want 10", result.TotalRows)
	}
	if result.Page != 1 {
		t.Errorf("Page = %d, want 1", result.Page)
	}
}

func TestQueryService_ExecutePaginatedQuery_PageNormalization(t *testing.T) {
	t.Parallel()
	drv := &mockDriver{
		dbType:      driver.PostgreSQL,
		isConnected: true,
		executeFunc: func(_ context.Context, _ string) (*driver.QueryResult, error) {
			return &driver.QueryResult{Rows: []map[string]interface{}{{"cnt": int64(5)}}}, nil
		},
	}
	qs := newTestQueryService(t, "conn-1", drv)

	result, err := qs.ExecutePaginatedQuery("conn-1", "users", -5, 0)
	if err != nil {
		t.Fatalf("ExecutePaginatedQuery: %v", err)
	}
	if result.Page != 1 {
		t.Errorf("page normalized: Page = %d, want 1", result.Page)
	}
	if result.PageSize != 25 {
		t.Errorf("page size normalized: PageSize = %d, want 25", result.PageSize)
	}
}

func TestQueryService_ExecutePaginatedQuery_MongoDB(t *testing.T) {
	t.Parallel()
	drv := &mockDriver{
		dbType:      driver.MongoDB,
		isConnected: true,
		executeFunc: func(_ context.Context, query string) (*driver.QueryResult, error) {
			if strings.Contains(query, "count") {
				return &driver.QueryResult{
					Rows: []map[string]interface{}{{"count": float64(3)}},
				}, nil
			}
			return &driver.QueryResult{
				Rows:     []map[string]interface{}{{"_id": "abc"}},
				RowCount: 1,
			}, nil
		},
	}
	qs := newTestQueryService(t, "conn-1", drv)

	result, err := qs.ExecutePaginatedQuery("conn-1", "users", 1, 10)
	if err != nil {
		t.Fatalf("ExecutePaginatedQuery MongoDB: %v", err)
	}
	if result.TotalRows != 3 {
		t.Errorf("TotalRows = %d, want 3", result.TotalRows)
	}
}

func TestQueryService_ExecutePaginatedQuery_Redis(t *testing.T) {
	t.Parallel()
	drv := &mockDriver{
		dbType:      driver.Redis,
		isConnected: true,
		executeFunc: func(_ context.Context, _ string) (*driver.QueryResult, error) {
			return &driver.QueryResult{
				Rows:     []map[string]interface{}{{"result": "string"}},
				RowCount: 1,
			}, nil
		},
	}
	qs := newTestQueryService(t, "conn-1", drv)

	result, err := qs.ExecutePaginatedQuery("conn-1", "mykey", 1, 25)
	if err != nil {
		t.Fatalf("ExecutePaginatedQuery Redis: %v", err)
	}
	if result.Page != 1 {
		t.Errorf("Page = %d, want 1", result.Page)
	}
}

func TestQueryService_GetHistory_Empty(t *testing.T) {
	t.Parallel()
	qs := newTestQueryService(t, "", nil)

	_, err := qs.GetHistory("conn-1", 10)
	if err != nil {
		t.Fatalf("GetHistory: %v", err)
	}
}
