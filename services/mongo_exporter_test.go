package services

import (
	"bytes"
	"encoding/json"
	"testing"

	"soft-db/internal/driver"

	"go.mongodb.org/mongo-driver/v2/bson"
)

type mockMongoExportDriver struct {
	rowCount int64
	rows     []map[string]interface{}
	columns  []driver.ColumnMeta
}

func (m *mockMongoExportDriver) GetTableRowCount(table string) (int64, error) {
	return m.rowCount, nil
}

func (m *mockMongoExportDriver) GetTableRows(table string, limit, offset int) (*driver.QueryResult, error) {
	if offset >= len(m.rows) {
		return &driver.QueryResult{Columns: m.columns, Rows: []map[string]interface{}{}}, nil
	}
	end := offset + limit
	if end > len(m.rows) {
		end = len(m.rows)
	}
	return &driver.QueryResult{
		Columns:  m.columns,
		Rows:     m.rows[offset:end],
		RowCount: int64(end - offset),
	}, nil
}

func (m *mockMongoExportDriver) GetCreateTableDDL(table string) (string, error) {
	return "", nil
}

func TestMongoSchemaExportStructure(t *testing.T) {
	export := MongoSchemaExport{
		Database: "testdb",
		Collections: []MongoCollectionSchema{
			{
				Name: "users",
				Validator: map[string]interface{}{
					"bsonType": "object",
					"properties": map[string]interface{}{
						"name": map[string]interface{}{"bsonType": "string"},
					},
				},
				Indexes: []map[string]interface{}{
					{"v": float64(2), "key": map[string]interface{}{"_id": float64(1)}, "name": "_id_"},
					{"v": float64(2), "key": map[string]interface{}{"email": float64(1)}, "name": "email_1", "unique": true},
				},
			},
		},
	}

	data, err := json.MarshalIndent(export, "", "  ")
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var parsed map[string]interface{}
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if parsed["database"] != "testdb" {
		t.Errorf("database = %v, want testdb", parsed["database"])
	}

	colls, ok := parsed["collections"].([]interface{})
	if !ok || len(colls) != 1 {
		t.Fatalf("collections: got %v", parsed["collections"])
	}

	coll := colls[0].(map[string]interface{})
	if coll["name"] != "users" {
		t.Errorf("collection name = %v, want users", coll["name"])
	}
	if coll["validator"] == nil {
		t.Error("validator should not be nil")
	}

	indexes, ok := coll["indexes"].([]interface{})
	if !ok || len(indexes) != 2 {
		t.Errorf("indexes count: got %d, want 2", len(indexes))
	}

	idx1 := indexes[1].(map[string]interface{})
	if idx1["name"] != "email_1" {
		t.Errorf("index name = %v, want email_1", idx1["name"])
	}
	if idx1["unique"] != true {
		t.Errorf("index unique = %v, want true", idx1["unique"])
	}
}

func TestMongoSchemaExportEmptyValidator(t *testing.T) {
	export := MongoSchemaExport{
		Database: "testdb",
		Collections: []MongoCollectionSchema{
			{Name: "logs"},
		},
	}

	data, err := json.Marshal(export)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var parsed map[string]interface{}
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	colls := parsed["collections"].([]interface{})
	coll := colls[0].(map[string]interface{})

	if _, exists := coll["validator"]; exists {
		t.Error("validator should be omitted when empty")
	}
	if _, exists := coll["indexes"]; exists {
		t.Error("indexes should be omitted when empty")
	}
}

func TestMongoDataExportEmpty(t *testing.T) {
	mock := &mockMongoExportDriver{
		rowCount: 0,
		rows:     []map[string]interface{}{},
		columns:  []driver.ColumnMeta{},
	}

	var buf bytes.Buffer
	err := ExportMongoData(mock, "testdb", "empty_coll", &buf, nil)
	if err != nil {
		t.Fatalf("export: %v", err)
	}

	output := buf.String()
	if output != "[\n]" {
		t.Errorf("empty export = %q, want %q", output, "[\n]")
	}

	var arr []interface{}
	if err := json.Unmarshal([]byte(output), &arr); err != nil {
		t.Errorf("invalid JSON: %v", err)
	}
	if len(arr) != 0 {
		t.Errorf("expected 0 elements, got %d", len(arr))
	}
}

func TestMongoDataExportWithMock(t *testing.T) {
	mock := &mockMongoExportDriver{
		rowCount: 2,
		rows: []map[string]interface{}{
			{"_id": "id1", "name": "Alice", "age": int32(30)},
			{"_id": "id2", "name": "Bob", "age": int32(25)},
		},
		columns: []driver.ColumnMeta{
			{Name: "_id", Type: "string"},
			{Name: "name", Type: "string"},
			{Name: "age", Type: "int"},
		},
	}

	var buf bytes.Buffer
	var progressCalls int
	err := ExportMongoData(mock, "testdb", "users", &buf, func(current, total int64) {
		progressCalls++
		if total != 2 {
			t.Errorf("progress total = %d, want 2", total)
		}
	})
	if err != nil {
		t.Fatalf("export: %v", err)
	}

	output := buf.String()

	if output[0] != '[' {
		t.Errorf("expected '[' at start, got %c", output[0])
	}
	if output[len(output)-1] != ']' {
		t.Errorf("expected ']' at end, got %c", output[len(output)-1])
	}

	var arr []json.RawMessage
	if err := json.Unmarshal([]byte(output), &arr); err != nil {
		t.Fatalf("invalid JSON array: %v", err)
	}
	if len(arr) != 2 {
		t.Fatalf("expected 2 docs, got %d", len(arr))
	}

	if progressCalls == 0 {
		t.Error("progress callback was not called")
	}
}

func TestMongoExtendedJSONTypePreservation(t *testing.T) {
	tests := []struct {
		name     string
		input    map[string]interface{}
		contains string
	}{
		{
			name:     "ObjectID",
			input:    map[string]interface{}{"_id": bson.NewObjectID()},
			contains: `"$oid"`,
		},
		{
			name:     "Int32",
			input:    map[string]interface{}{"age": int32(42)},
			contains: `"$numberInt"`,
		},
		{
			name:     "Int64",
			input:    map[string]interface{}{"count": int64(9999999999)},
			contains: `"$numberLong"`,
		},
		{
			name:     "String preserved",
			input:    map[string]interface{}{"name": "hello"},
			contains: `"hello"`,
		},
		{
			name:     "Boolean",
			input:    map[string]interface{}{"active": true},
			contains: `true`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			output, err := bson.MarshalExtJSON(tt.input, true, false)
			if err != nil {
				t.Fatalf("MarshalExtJSON: %v", err)
			}
			if !bytes.Contains(output, []byte(tt.contains)) {
				t.Errorf("output %s does not contain %q", output, tt.contains)
			}
		})
	}
}

func TestMongoDataExportExtendedJSONOutput(t *testing.T) {
	oid := bson.NewObjectID()
	mock := &mockMongoExportDriver{
		rowCount: 1,
		rows: []map[string]interface{}{
			{"_id": oid, "count": int64(42), "score": int32(100)},
		},
		columns: []driver.ColumnMeta{
			{Name: "_id", Type: "objectId"},
			{Name: "count", Type: "long"},
			{Name: "score", Type: "int"},
		},
	}

	var buf bytes.Buffer
	if err := ExportMongoData(mock, "testdb", "typed", &buf, nil); err != nil {
		t.Fatalf("export: %v", err)
	}

	output := buf.String()

	for _, marker := range []string{`"$oid"`, `"$numberLong"`, `"$numberInt"`} {
		if !bytes.Contains([]byte(output), []byte(marker)) {
			t.Errorf("output missing Extended JSON marker %s:\n%s", marker, output)
		}
	}
}

func TestMongoDataExportChunking(t *testing.T) {
	rows := make([]map[string]interface{}, 2500)
	for i := range rows {
		rows[i] = map[string]interface{}{"i": int32(int32(i))}
	}

	mock := &mockMongoExportDriver{
		rowCount: int64(len(rows)),
		rows:     rows,
		columns:  []driver.ColumnMeta{{Name: "i", Type: "int"}},
	}

	var buf bytes.Buffer
	var calls []int64
	err := ExportMongoData(mock, "testdb", "big", &buf, func(current, total int64) {
		calls = append(calls, current)
	})
	if err != nil {
		t.Fatalf("export: %v", err)
	}

	if len(calls) < 2 {
		t.Errorf("expected multiple progress calls for 2500 rows, got %d", len(calls))
	}

	last := calls[len(calls)-1]
	if last != 2500 {
		t.Errorf("final progress = %d, want 2500", last)
	}

	var arr []json.RawMessage
	if err := json.Unmarshal(buf.Bytes(), &arr); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if len(arr) != 2500 {
		t.Errorf("doc count = %d, want 2500", len(arr))
	}
}

func TestBsonMapToJSON(t *testing.T) {
	input := bson.M{
		"v":    int32(2),
		"key":  bson.M{"email": int32(1)},
		"name": "email_1",
	}

	result, err := bsonMapToJSON(input)
	if err != nil {
		t.Fatalf("bsonMapToJSON: %v", err)
	}

	if result["name"] != "email_1" {
		t.Errorf("name = %v, want email_1", result["name"])
	}
	if result["v"] != float64(2) {
		t.Errorf("v = %v (type %T), want float64(2)", result["v"], result["v"])
	}
	key, ok := result["key"].(map[string]interface{})
	if !ok {
		t.Fatalf("key is not a map: %T %v", result["key"], result["key"])
	}
	if key["email"] != float64(1) {
		t.Errorf("key.email = %v, want float64(1)", key["email"])
	}
}

func TestJsonToBSONMap(t *testing.T) {
	input := map[string]interface{}{
		"key":    map[string]interface{}{"email": float64(1), "name": float64(-1)},
		"name":   "email_name_idx",
		"unique": true,
	}

	result := jsonToBSONMap(input)

	key, ok := result["key"].(bson.M)
	if !ok {
		t.Fatalf("key should be bson.M, got %T", result["key"])
	}
	if key["email"] != int32(1) {
		t.Errorf("key.email = %v (type %T), want int32(1)", key["email"], key["email"])
	}
	if key["name"] != int32(-1) {
		t.Errorf("key.name = %v (type %T), want int32(-1)", key["name"], key["name"])
	}
	if result["name"] != "email_name_idx" {
		t.Errorf("name = %v, want email_name_idx", result["name"])
	}
	if result["unique"] != true {
		t.Errorf("unique = %v, want true", result["unique"])
	}
}

func TestMongoExportDriverTypeAssertion(t *testing.T) {
	var notADriver string = "not a driver"

	_, err := ExportMongoSchema(notADriver, "db", nil)
	if err == nil {
		t.Error("ExportMongoSchema should fail with non-MongoDriver")
	}

	err = ImportMongoSchema(notADriver, "db", []byte(`{}`), ConflictSkip)
	if err == nil {
		t.Error("ImportMongoSchema should fail with non-MongoDriver")
	}

	err = ExportMongoData(notADriver, "db", "coll", &bytes.Buffer{}, nil)
	if err == nil {
		t.Error("ExportMongoData should fail with non-ExportableDriver")
	}

	err = ImportMongoData(notADriver, "db", "coll", &bytes.Buffer{}, ConflictSkip)
	if err == nil {
		t.Error("ImportMongoData should fail with non-MongoDriver")
	}
}
