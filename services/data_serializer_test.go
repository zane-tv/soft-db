package services

import (
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"testing"

	"soft-db/internal/driver"
)

type mockExportableDriver struct {
	rows    []map[string]interface{}
	columns []driver.ColumnMeta
	total   int64
}

func (m *mockExportableDriver) GetTableRowCount(_ string) (int64, error) {
	return m.total, nil
}

func (m *mockExportableDriver) GetTableRows(_ string, limit, offset int) (*driver.QueryResult, error) {
	if offset >= len(m.rows) {
		return &driver.QueryResult{Columns: m.columns, Rows: nil}, nil
	}
	end := offset + limit
	if end > len(m.rows) {
		end = len(m.rows)
	}
	return &driver.QueryResult{
		Columns: m.columns,
		Rows:    m.rows[offset:end],
	}, nil
}

func (m *mockExportableDriver) GetCreateTableDDL(_ string) (string, error) {
	return "", nil
}

func TestDataSerializer_SQL_NullRenderedAsKeyword(t *testing.T) {
	t.Parallel()

	cols := []string{"id", "name"}
	rows := []map[string]interface{}{
		{"id": 1, "name": nil},
	}

	result := SerializeRowsAsSQL(driver.MySQL, "users", cols, rows, 0)

	if strings.Contains(result, "'NULL'") {
		t.Errorf("NULL rendered as string literal 'NULL'; want bare NULL keyword\ngot: %s", result)
	}
	if !strings.Contains(result, ", NULL)") {
		t.Errorf("expected NULL keyword in output\ngot: %s", result)
	}
}

func TestDataSerializer_SQL_SingleQuoteEscaping(t *testing.T) {
	t.Parallel()

	cols := []string{"id", "name"}
	rows := []map[string]interface{}{
		{"id": 1, "name": "O'Brien"},
	}

	result := SerializeRowsAsSQL(driver.PostgreSQL, "users", cols, rows, 0)

	if !strings.Contains(result, "'O''Brien'") {
		t.Errorf("single quote not doubled\ngot: %s", result)
	}
}

func TestDataSerializer_SQL_BooleanDialects(t *testing.T) {
	t.Parallel()

	cols := []string{"id", "active"}
	rows := []map[string]interface{}{
		{"id": 1, "active": true},
		{"id": 2, "active": false},
	}

	tests := []struct {
		dbType    driver.DatabaseType
		wantTrue  string
		wantFalse string
	}{
		{driver.MySQL, "1", "0"},
		{driver.MariaDB, "1", "0"},
		{driver.SQLite, "1", "0"},
		{driver.PostgreSQL, "TRUE", "FALSE"},
		{driver.Redshift, "TRUE", "FALSE"},
	}

	for _, tt := range tests {
		t.Run(string(tt.dbType), func(t *testing.T) {
			result := SerializeRowsAsSQL(tt.dbType, "t", cols, rows, 0)
			if !strings.Contains(result, tt.wantTrue) {
				t.Errorf("dialect %s: want %s for true\ngot: %s", tt.dbType, tt.wantTrue, result)
			}
			if !strings.Contains(result, tt.wantFalse) {
				t.Errorf("dialect %s: want %s for false\ngot: %s", tt.dbType, tt.wantFalse, result)
			}
		})
	}
}

func TestDataSerializer_SQL_BatchSize(t *testing.T) {
	t.Parallel()

	cols := []string{"id"}
	rows := []map[string]interface{}{
		{"id": 1},
		{"id": 2},
		{"id": 3},
	}

	result := SerializeRowsAsSQL(driver.MySQL, "t", cols, rows, 2)

	count := strings.Count(result, "INSERT INTO")
	if count != 2 {
		t.Errorf("expected 2 INSERT statements for 3 rows with batchSize=2, got %d\n%s", count, result)
	}
}

func TestDataSerializer_SQL_BlobHexEncoding(t *testing.T) {
	t.Parallel()

	cols := []string{"id", "data"}
	rows := []map[string]interface{}{
		{"id": 1, "data": []byte{0xDE, 0xAD, 0xBE, 0xEF}},
	}

	mysqlResult := SerializeRowsAsSQL(driver.MySQL, "t", cols, rows, 0)
	if !strings.Contains(mysqlResult, "X'deadbeef'") {
		t.Errorf("MySQL: expected X'deadbeef'\ngot: %s", mysqlResult)
	}

	pgResult := SerializeRowsAsSQL(driver.PostgreSQL, "t", cols, rows, 0)
	if !strings.Contains(pgResult, `'\xdeadbeef'`) {
		t.Errorf("PostgreSQL: expected '\\xdeadbeef'\ngot: %s", pgResult)
	}
}

func TestDataSerializer_SQL_DefaultBatchSize(t *testing.T) {
	t.Parallel()

	cols := []string{"id"}
	rows := make([]map[string]interface{}, 501)
	for i := range rows {
		rows[i] = map[string]interface{}{"id": i}
	}

	result := SerializeRowsAsSQL(driver.SQLite, "t", cols, rows, 0)
	count := strings.Count(result, "INSERT INTO")
	if count != 2 {
		t.Errorf("501 rows with default batchSize=500: expected 2 INSERT statements, got %d", count)
	}
}

func TestDataSerializer_SQL_NumericUnquoted(t *testing.T) {
	t.Parallel()

	cols := []string{"a", "b", "c"}
	rows := []map[string]interface{}{
		{"a": int64(42), "b": float64(3.14), "c": "text"},
	}

	result := SerializeRowsAsSQL(driver.PostgreSQL, "t", cols, rows, 0)

	if !strings.Contains(result, "42") {
		t.Errorf("expected unquoted integer 42\ngot: %s", result)
	}
	if strings.Contains(result, "'42'") {
		t.Errorf("integer should not be quoted\ngot: %s", result)
	}
}

func TestDataSerializer_SQL_EmptyRows(t *testing.T) {
	t.Parallel()

	result := SerializeRowsAsSQL(driver.MySQL, "t", []string{"id"}, nil, 0)
	if result != "" {
		t.Errorf("expected empty string for nil rows, got %q", result)
	}
}

func TestDataSerializer_CSV_CommaInValue(t *testing.T) {
	t.Parallel()

	cols := []string{"id", "city"}
	rows := []map[string]interface{}{
		{"id": 1, "city": "Portland, OR"},
	}

	result := SerializeRowsAsCSV(cols, rows, "")

	lines := strings.Split(strings.TrimRight(result, "\n"), "\n")
	if len(lines) != 2 {
		t.Fatalf("expected 2 lines (header + data), got %d\n%s", len(lines), result)
	}
	if !strings.Contains(lines[1], `"Portland, OR"`) {
		t.Errorf("value with comma should be quoted\ngot line: %s", lines[1])
	}
}

func TestDataSerializer_CSV_NewlineInValue(t *testing.T) {
	t.Parallel()

	cols := []string{"id", "note"}
	rows := []map[string]interface{}{
		{"id": 1, "note": "line1\nline2"},
	}

	result := SerializeRowsAsCSV(cols, rows, "")

	if !strings.Contains(result, `"line1`) {
		t.Errorf("value with newline should be RFC 4180 quoted\ngot: %s", result)
	}
}

func TestDataSerializer_CSV_QuoteInValue(t *testing.T) {
	t.Parallel()

	cols := []string{"id", "note"}
	rows := []map[string]interface{}{
		{"id": 1, "note": `say "hello"`},
	}

	result := SerializeRowsAsCSV(cols, rows, "")

	if !strings.Contains(result, `"say ""hello"""`) {
		t.Errorf("double-quote in value should be doubled per RFC 4180\ngot: %s", result)
	}
}

func TestDataSerializer_CSV_CustomDelimiter(t *testing.T) {
	t.Parallel()

	cols := []string{"a", "b"}
	rows := []map[string]interface{}{
		{"a": "x", "b": "y"},
	}

	result := SerializeRowsAsCSV(cols, rows, ";")

	lines := strings.Split(strings.TrimRight(result, "\n"), "\n")
	if lines[0] != "a;b" {
		t.Errorf("header with semicolon delimiter: got %q, want %q", lines[0], "a;b")
	}
	if lines[1] != "x;y" {
		t.Errorf("data row with semicolon delimiter: got %q, want %q", lines[1], "x;y")
	}
}

func TestDataSerializer_CSV_NullAsEmpty(t *testing.T) {
	t.Parallel()

	cols := []string{"id", "name"}
	rows := []map[string]interface{}{
		{"id": 1, "name": nil},
	}

	result := SerializeRowsAsCSV(cols, rows, "")

	lines := strings.Split(strings.TrimRight(result, "\n"), "\n")
	if len(lines) < 2 {
		t.Fatalf("expected header + data row\ngot: %s", result)
	}
	if lines[1] != "1," {
		t.Errorf("NULL should render as empty CSV field\ngot: %q", lines[1])
	}
}

func TestDataSerializer_CSV_HeaderOnce(t *testing.T) {
	t.Parallel()

	cols := []string{"id", "name"}
	rows := []map[string]interface{}{
		{"id": 1, "name": "Alice"},
	}

	result := SerializeRowsAsCSV(cols, rows, "")
	count := strings.Count(result, "id,name")
	if count != 1 {
		t.Errorf("header should appear exactly once, found %d times\n%s", count, result)
	}
}

func TestDataSerializer_JSON_ValidJSON(t *testing.T) {
	t.Parallel()

	cols := []string{"id", "name", "score"}
	rows := []map[string]interface{}{
		{"id": int64(1), "name": "Alice", "score": 98.5},
		{"id": int64(2), "name": "Bob", "score": 72.0},
	}

	data, err := SerializeRowsAsJSON(cols, rows)
	if err != nil {
		t.Fatalf("SerializeRowsAsJSON: %v", err)
	}

	var parsed []map[string]interface{}
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("output is not valid JSON: %v\n%s", err, data)
	}

	if len(parsed) != 2 {
		t.Errorf("expected 2 objects, got %d", len(parsed))
	}
}

func TestDataSerializer_JSON_NullPreserved(t *testing.T) {
	t.Parallel()

	cols := []string{"id", "name"}
	rows := []map[string]interface{}{
		{"id": 1, "name": nil},
	}

	data, err := SerializeRowsAsJSON(cols, rows)
	if err != nil {
		t.Fatalf("SerializeRowsAsJSON: %v", err)
	}

	if !strings.Contains(string(data), `"name": null`) {
		t.Errorf("nil should serialize as JSON null\ngot: %s", data)
	}
}

func TestDataSerializer_JSON_TypesPreserved(t *testing.T) {
	t.Parallel()

	cols := []string{"num", "str", "flag"}
	rows := []map[string]interface{}{
		{"num": int64(42), "str": "hello", "flag": true},
	}

	data, err := SerializeRowsAsJSON(cols, rows)
	if err != nil {
		t.Fatalf("SerializeRowsAsJSON: %v", err)
	}

	var parsed []map[string]interface{}
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}

	row := parsed[0]
	if _, ok := row["num"].(float64); !ok {
		t.Errorf("num should be JSON number, got %T", row["num"])
	}
	if _, ok := row["str"].(string); !ok {
		t.Errorf("str should be JSON string, got %T", row["str"])
	}
	if _, ok := row["flag"].(bool); !ok {
		t.Errorf("flag should be JSON bool, got %T", row["flag"])
	}
}

func TestDataSerializer_JSON_EmptyRows(t *testing.T) {
	t.Parallel()

	data, err := SerializeRowsAsJSON([]string{"id"}, nil)
	if err != nil {
		t.Fatalf("SerializeRowsAsJSON: %v", err)
	}

	var parsed []interface{}
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if len(parsed) != 0 {
		t.Errorf("expected empty array, got %v", parsed)
	}
}

func TestDataSerializer_WriteChunkedExport_SQL(t *testing.T) {
	t.Parallel()

	cols := []driver.ColumnMeta{{Name: "id"}, {Name: "name"}}
	rows := []map[string]interface{}{
		{"id": 1, "name": "Alice"},
		{"id": 2, "name": "Bob"},
	}
	drv := &mockExportableDriver{rows: rows, columns: cols, total: int64(len(rows))}

	var buf strings.Builder
	err := WriteChunkedExport(&buf, drv, "users", FormatSQLInsert, driver.MySQL, "", nil)
	if err != nil {
		t.Fatalf("WriteChunkedExport: %v", err)
	}

	result := buf.String()
	if !strings.Contains(result, "INSERT INTO") {
		t.Errorf("expected INSERT INTO statement\ngot: %s", result)
	}
	if !strings.Contains(result, "'Alice'") {
		t.Errorf("expected 'Alice' in output\ngot: %s", result)
	}
}

func TestDataSerializer_WriteChunkedExport_CSV_HeaderOnce(t *testing.T) {
	t.Parallel()

	cols := []driver.ColumnMeta{{Name: "id"}, {Name: "v"}}
	rows := make([]map[string]interface{}, 1500)
	for i := range rows {
		rows[i] = map[string]interface{}{"id": i, "v": fmt.Sprintf("val%d", i)}
	}
	drv := &mockExportableDriver{rows: rows, columns: cols, total: int64(len(rows))}

	var buf strings.Builder
	err := WriteChunkedExport(&buf, drv, "t", FormatCSV, driver.PostgreSQL, ",", nil)
	if err != nil {
		t.Fatalf("WriteChunkedExport: %v", err)
	}

	headerCount := strings.Count(buf.String(), "id,v")
	if headerCount != 1 {
		t.Errorf("CSV header should appear exactly once across chunks, found %d times", headerCount)
	}
}

func TestDataSerializer_WriteChunkedExport_JSON_ValidArray(t *testing.T) {
	t.Parallel()

	cols := []driver.ColumnMeta{{Name: "id"}, {Name: "name"}}
	rows := []map[string]interface{}{
		{"id": 1, "name": "Alice"},
		{"id": 2, "name": "Bob"},
	}
	drv := &mockExportableDriver{rows: rows, columns: cols, total: int64(len(rows))}

	var buf strings.Builder
	err := WriteChunkedExport(&buf, drv, "users", FormatJSON, driver.PostgreSQL, "", nil)
	if err != nil {
		t.Fatalf("WriteChunkedExport: %v", err)
	}

	var parsed []interface{}
	if err := json.Unmarshal([]byte(buf.String()), &parsed); err != nil {
		t.Fatalf("output is not valid JSON: %v\n%s", err, buf.String())
	}
	if len(parsed) != 2 {
		t.Errorf("expected 2 JSON objects, got %d", len(parsed))
	}
}

func TestDataSerializer_WriteChunkedExport_JSON_EmptyTable(t *testing.T) {
	t.Parallel()

	cols := []driver.ColumnMeta{{Name: "id"}}
	drv := &mockExportableDriver{rows: nil, columns: cols, total: 0}

	var buf strings.Builder
	err := WriteChunkedExport(&buf, drv, "t", FormatJSON, driver.MySQL, "", nil)
	if err != nil {
		t.Fatalf("WriteChunkedExport: %v", err)
	}

	var parsed []interface{}
	if err := json.Unmarshal([]byte(buf.String()), &parsed); err != nil {
		t.Fatalf("empty table output is not valid JSON: %v\ngot: %q", err, buf.String())
	}
	if len(parsed) != 0 {
		t.Errorf("expected empty JSON array, got %v", parsed)
	}
}

func TestDataSerializer_WriteChunkedExport_Progress(t *testing.T) {
	t.Parallel()

	cols := []driver.ColumnMeta{{Name: "id"}}
	rows := make([]map[string]interface{}, 2500)
	for i := range rows {
		rows[i] = map[string]interface{}{"id": i}
	}
	drv := &mockExportableDriver{rows: rows, columns: cols, total: int64(len(rows))}

	var calls int
	var lastCurrent, lastTotal int64
	err := WriteChunkedExport(io.Discard, drv, "t", FormatSQLInsert, driver.SQLite, "", func(cur, tot int64) {
		calls++
		lastCurrent = cur
		lastTotal = tot
	})
	if err != nil {
		t.Fatalf("WriteChunkedExport: %v", err)
	}

	if calls == 0 {
		t.Error("onProgress was never called")
	}
	if lastCurrent != 2500 {
		t.Errorf("final current = %d, want 2500", lastCurrent)
	}
	if lastTotal != 2500 {
		t.Errorf("total = %d, want 2500", lastTotal)
	}
}

func TestDataSerializer_AllFormats_NullHandling(t *testing.T) {
	t.Parallel()

	cols := []string{"id", "nullable"}
	rows := []map[string]interface{}{
		{"id": 1, "nullable": nil},
	}

	t.Run("SQL", func(t *testing.T) {
		result := SerializeRowsAsSQL(driver.PostgreSQL, "t", cols, rows, 0)
		if !strings.Contains(result, "NULL") || strings.Contains(result, "'NULL'") {
			t.Errorf("SQL: expected bare NULL keyword\ngot: %s", result)
		}
	})

	t.Run("CSV", func(t *testing.T) {
		result := SerializeRowsAsCSV(cols, rows, "")
		lines := strings.Split(strings.TrimRight(result, "\n"), "\n")
		if len(lines) < 2 || lines[1] != "1," {
			t.Errorf("CSV: expected empty field for NULL\ngot lines: %v", lines)
		}
	})

	t.Run("JSON", func(t *testing.T) {
		data, err := SerializeRowsAsJSON(cols, rows)
		if err != nil {
			t.Fatalf("SerializeRowsAsJSON: %v", err)
		}
		if !strings.Contains(string(data), `"nullable": null`) {
			t.Errorf("JSON: expected null value\ngot: %s", data)
		}
	})
}
