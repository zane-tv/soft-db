package services

import (
	"context"
	"strings"
	"testing"

	"soft-db/internal/driver"
)

func newTestEditService(t *testing.T, connID string, drv driver.Driver) *EditService {
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
	qs := NewQueryService(cs, ss, s)
	return NewEditService(cs, qs, ss, s)
}

func TestQuoteIdent_MySQL(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		want string
	}{
		{"users", "`users`"},
		{"my`table", "`my``table`"},
	}
	for _, c := range cases {
		if got := quoteIdent(c.name, driver.MySQL); got != c.want {
			t.Errorf("quoteIdent(%q, MySQL) = %q, want %q", c.name, got, c.want)
		}
	}
}

func TestQuoteIdent_PostgreSQL(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		want string
	}{
		{"users", `"users"`},
		{`my"table`, `"my""table"`},
	}
	for _, c := range cases {
		if got := quoteIdent(c.name, driver.PostgreSQL); got != c.want {
			t.Errorf("quoteIdent(%q, PG) = %q, want %q", c.name, got, c.want)
		}
	}
}

func TestPlaceholder_PostgreSQL(t *testing.T) {
	t.Parallel()
	for i, want := range []string{"$1", "$2", "$3"} {
		if got := placeholder(driver.PostgreSQL, i+1); got != want {
			t.Errorf("placeholder(PG, %d) = %q, want %q", i+1, got, want)
		}
	}
}

func TestPlaceholder_MySQL(t *testing.T) {
	t.Parallel()
	for i := 1; i <= 3; i++ {
		if got := placeholder(driver.MySQL, i); got != "?" {
			t.Errorf("placeholder(MySQL, %d) = %q, want ?", i, got)
		}
	}
}

func TestMakePlaceholders_Count(t *testing.T) {
	t.Parallel()
	placeholders := makePlaceholders(driver.PostgreSQL, 3)
	if len(placeholders) != 3 {
		t.Fatalf("expected 3 placeholders, got %d", len(placeholders))
	}
	for i, p := range placeholders {
		want := placeholder(driver.PostgreSQL, i+1)
		if p != want {
			t.Errorf("placeholders[%d] = %q, want %q", i, p, want)
		}
	}
}

func TestFormatValue_Types(t *testing.T) {
	t.Parallel()
	cases := []struct {
		input interface{}
		want  string
	}{
		{nil, "NULL"},
		{float64(42), "42"},
		{float64(3.14), "3.14"},
		{true, "TRUE"},
		{false, "FALSE"},
		{"hello", "'hello'"},
		{"it's", "'it''s'"},
	}
	for _, c := range cases {
		if got := formatValue(c.input); got != c.want {
			t.Errorf("formatValue(%v) = %q, want %q", c.input, got, c.want)
		}
	}
}

func TestBuildParamUpdateSQL_PostgreSQL(t *testing.T) {
	t.Parallel()
	req := CellUpdateRequest{
		Table:     "users",
		Column:    "name",
		NewValue:  "Alice",
		PkColumns: map[string]interface{}{"id": int64(1)},
	}
	display, exec, args := buildParamUpdateSQL(req, driver.PostgreSQL)

	if !strings.Contains(display, "UPDATE") {
		t.Errorf("displaySQL missing UPDATE: %q", display)
	}
	if !strings.Contains(display, "Alice") {
		t.Errorf("displaySQL should contain literal value: %q", display)
	}
	if !strings.Contains(exec, "$1") {
		t.Errorf("execSQL should use positional placeholder: %q", exec)
	}
	if len(args) < 2 {
		t.Errorf("expected at least 2 args (value + pk), got %d", len(args))
	}
}

func TestBuildParamUpdateSQL_MySQL(t *testing.T) {
	t.Parallel()
	req := CellUpdateRequest{
		Table:     "users",
		Column:    "status",
		NewValue:  nil,
		PkColumns: map[string]interface{}{"id": 5},
	}
	display, exec, args := buildParamUpdateSQL(req, driver.MySQL)

	if !strings.Contains(display, "NULL") {
		t.Errorf("displaySQL should have NULL for nil value: %q", display)
	}
	if !strings.Contains(exec, "NULL") {
		t.Errorf("execSQL should have NULL for nil value: %q", exec)
	}
	if !strings.Contains(exec, "?") {
		t.Errorf("execSQL should use ? placeholder for MySQL: %q", exec)
	}
	if len(args) != 1 {
		t.Errorf("expected 1 arg (pk only, NULL is inline), got %d", len(args))
	}
}

func TestEditService_GetTablePrimaryKey_NoConnection(t *testing.T) {
	t.Parallel()
	es := newTestEditService(t, "", nil)

	_, err := es.GetTablePrimaryKey("missing", "users")
	if err == nil {
		t.Fatal("expected error for missing connection")
	}
}

func TestEditService_GetTablePrimaryKey_HasPK(t *testing.T) {
	t.Parallel()
	drv := &mockDriver{
		dbType:      driver.PostgreSQL,
		isConnected: true,
		columnsFunc: func(_ context.Context, _ string) ([]driver.ColumnInfo, error) {
			return []driver.ColumnInfo{
				{Name: "id", Type: "integer", PrimaryKey: true},
				{Name: "name", Type: "text"},
			}, nil
		},
	}
	es := newTestEditService(t, "conn-1", drv)

	pks, err := es.GetTablePrimaryKey("conn-1", "users")
	if err != nil {
		t.Fatalf("GetTablePrimaryKey: %v", err)
	}
	if len(pks) != 1 || pks[0] != "id" {
		t.Errorf("pks = %v, want [id]", pks)
	}
}

func TestEditService_GetTablePrimaryKey_NoPK(t *testing.T) {
	t.Parallel()
	drv := &mockDriver{
		dbType:      driver.PostgreSQL,
		isConnected: true,
		columnsFunc: func(_ context.Context, _ string) ([]driver.ColumnInfo, error) {
			return []driver.ColumnInfo{
				{Name: "name", Type: "text", PrimaryKey: false},
			}, nil
		},
	}
	es := newTestEditService(t, "conn-1", drv)

	_, err := es.GetTablePrimaryKey("conn-1", "users")
	if err == nil {
		t.Fatal("expected error for table without primary key")
	}
}

func TestEditService_UpdateCell_MissingFields(t *testing.T) {
	t.Parallel()
	drv := &mockDriver{dbType: driver.PostgreSQL, isConnected: true}
	es := newTestEditService(t, "conn-1", drv)

	result, err := es.UpdateCell("conn-1", CellUpdateRequest{})
	if err != nil {
		t.Fatalf("UpdateCell: %v", err)
	}
	if result.Success {
		t.Error("expected failure for missing fields")
	}
}

func TestEditService_UpdateCell_Success(t *testing.T) {
	t.Parallel()
	drv := &mockDriver{
		dbType:      driver.PostgreSQL,
		isConnected: true,
		executeArgsFunc: func(_ context.Context, _ string, _ ...interface{}) (*driver.QueryResult, error) {
			return &driver.QueryResult{AffectedRows: 1}, nil
		},
	}
	es := newTestEditService(t, "conn-1", drv)

	result, err := es.UpdateCell("conn-1", CellUpdateRequest{
		Table:     "users",
		Column:    "name",
		NewValue:  "Bob",
		PkColumns: map[string]interface{}{"id": 1},
	})
	if err != nil {
		t.Fatalf("UpdateCell: %v", err)
	}
	if !result.Success {
		t.Errorf("expected success, got error: %s", result.Error)
	}
}

func TestEditService_BatchUpdateCells_Empty(t *testing.T) {
	t.Parallel()
	drv := &mockDriver{dbType: driver.PostgreSQL, isConnected: true}
	es := newTestEditService(t, "conn-1", drv)

	result, err := es.BatchUpdateCells("conn-1", []CellUpdateRequest{})
	if err != nil {
		t.Fatalf("BatchUpdateCells empty: %v", err)
	}
	if len(result.Results) != 0 {
		t.Errorf("expected 0 results for empty batch, got %d", len(result.Results))
	}
}

func TestEditService_BatchUpdateCells_NonTransactional_Success(t *testing.T) {
	t.Parallel()
	drv := &mockDriver{
		dbType:      driver.MongoDB,
		isConnected: true,
		executeArgsFunc: func(_ context.Context, _ string, _ ...interface{}) (*driver.QueryResult, error) {
			return &driver.QueryResult{AffectedRows: 1}, nil
		},
	}
	es := newTestEditService(t, "conn-1", drv)

	reqs := []CellUpdateRequest{
		{Table: "users", Column: "name", NewValue: "Alice", PkColumns: map[string]interface{}{"id": 1}},
		{Table: "users", Column: "name", NewValue: "Bob", PkColumns: map[string]interface{}{"id": 2}},
	}
	result, err := es.BatchUpdateCells("conn-1", reqs)
	if err != nil {
		t.Fatalf("BatchUpdateCells: %v", err)
	}
	if result.TotalSuccess != 2 {
		t.Errorf("TotalSuccess = %d, want 2", result.TotalSuccess)
	}
	if result.TotalFailed != 0 {
		t.Errorf("TotalFailed = %d, want 0", result.TotalFailed)
	}
}

func TestEditService_BatchUpdateCells_Transactional_Success(t *testing.T) {
	t.Parallel()
	txDrv := newSQLiteTransactionalMock(t)
	es := newTestEditService(t, "conn-1", txDrv)

	reqs := []CellUpdateRequest{
		{Table: "users", Column: "name", NewValue: "Updated", PkColumns: map[string]interface{}{"id": int64(1)}},
	}
	result, err := es.BatchUpdateCells("conn-1", reqs)
	if err != nil {
		t.Fatalf("BatchUpdateCells transactional: %v", err)
	}
	if result.TotalSuccess != 1 {
		t.Errorf("TotalSuccess = %d, want 1", result.TotalSuccess)
	}
}

func TestEditService_BatchUpdateCells_ValidationError(t *testing.T) {
	t.Parallel()
	txDrv := newSQLiteTransactionalMock(t)
	es := newTestEditService(t, "conn-1", txDrv)

	reqs := []CellUpdateRequest{
		{Table: "", Column: "", NewValue: "x", PkColumns: nil},
	}
	result, err := es.BatchUpdateCells("conn-1", reqs)
	if err != nil {
		t.Fatalf("BatchUpdateCells validation: %v", err)
	}
	if result.TotalFailed != 1 {
		t.Errorf("TotalFailed = %d, want 1", result.TotalFailed)
	}
}

func TestEditService_InsertRow_MissingFields(t *testing.T) {
	t.Parallel()
	drv := &mockDriver{dbType: driver.PostgreSQL, isConnected: true}
	es := newTestEditService(t, "conn-1", drv)

	result, err := es.InsertRow("conn-1", "", map[string]interface{}{"name": "test"})
	if err != nil {
		t.Fatalf("InsertRow missing table: %v", err)
	}
	if result.Success {
		t.Error("expected failure for missing table")
	}
}

func TestEditService_InsertRow_Success(t *testing.T) {
	t.Parallel()
	drv := &mockDriver{
		dbType:      driver.PostgreSQL,
		isConnected: true,
		executeArgsFunc: func(_ context.Context, _ string, _ ...interface{}) (*driver.QueryResult, error) {
			return &driver.QueryResult{AffectedRows: 1}, nil
		},
	}
	es := newTestEditService(t, "conn-1", drv)

	result, err := es.InsertRow("conn-1", "users", map[string]interface{}{"name": "Alice"})
	if err != nil {
		t.Fatalf("InsertRow: %v", err)
	}
	if !result.Success {
		t.Errorf("InsertRow failed: %s", result.Error)
	}
	if !strings.Contains(result.GeneratedSQL, "INSERT INTO") {
		t.Errorf("expected INSERT INTO in SQL, got %q", result.GeneratedSQL)
	}
}

func TestEditService_DeleteRows_MissingFields(t *testing.T) {
	t.Parallel()
	drv := &mockDriver{dbType: driver.PostgreSQL, isConnected: true}
	es := newTestEditService(t, "conn-1", drv)

	result, err := es.DeleteRows("conn-1", "", []map[string]interface{}{{"id": 1}})
	if err != nil {
		t.Fatalf("DeleteRows missing table: %v", err)
	}
	if result.Success {
		t.Error("expected failure for missing table")
	}
}

func TestEditService_DeleteRows_NonTransactional_Success(t *testing.T) {
	t.Parallel()
	drv := &mockDriver{
		dbType:      driver.MongoDB,
		isConnected: true,
		executeArgsFunc: func(_ context.Context, _ string, _ ...interface{}) (*driver.QueryResult, error) {
			return &driver.QueryResult{AffectedRows: 1}, nil
		},
	}
	es := newTestEditService(t, "conn-1", drv)

	pkList := []map[string]interface{}{
		{"id": 1},
		{"id": 2},
	}
	result, err := es.DeleteRows("conn-1", "users", pkList)
	if err != nil {
		t.Fatalf("DeleteRows: %v", err)
	}
	if !result.Success {
		t.Errorf("expected success: %s", result.Error)
	}
	if result.TotalDeleted != 2 {
		t.Errorf("TotalDeleted = %d, want 2", result.TotalDeleted)
	}
}

func TestEditService_DeleteRows_Transactional_Success(t *testing.T) {
	t.Parallel()
	txDrv := newSQLiteTransactionalMock(t)
	es := newTestEditService(t, "conn-1", txDrv)

	pkList := []map[string]interface{}{
		{"id": int64(1)},
	}
	result, err := es.DeleteRows("conn-1", "users", pkList)
	if err != nil {
		t.Fatalf("DeleteRows transactional: %v", err)
	}
	if !result.Success {
		t.Errorf("expected success: %s", result.Error)
	}
}
