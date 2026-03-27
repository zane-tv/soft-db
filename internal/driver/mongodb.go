package driver

import (
	"context"
	"fmt"
	"net/url"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

// MongoDriver implements Driver for MongoDB
type MongoDriver struct {
	client *mongo.Client
	dbName string
	config ConnectionConfig
}

func (d *MongoDriver) Connect(ctx context.Context, cfg ConnectionConfig) error {
	d.config = cfg
	d.dbName = cfg.Database

	// Build URI — prefer direct URI string, fall back to host/port fields
	var uri string
	if cfg.URI != "" {
		uri = cfg.URI
		// Parse database name from URI path if not explicitly set
		if d.dbName == "" {
			d.dbName = extractMongoDBFromURI(cfg.URI)
		}
	} else if cfg.Username != "" {
		if cfg.Database != "" {
			uri = fmt.Sprintf("mongodb://%s:%s@%s:%d/%s", cfg.Username, cfg.Password, cfg.Host, cfg.Port, cfg.Database)
		} else {
			uri = fmt.Sprintf("mongodb://%s:%s@%s:%d", cfg.Username, cfg.Password, cfg.Host, cfg.Port)
		}
	} else {
		if cfg.Database != "" {
			uri = fmt.Sprintf("mongodb://%s:%d/%s", cfg.Host, cfg.Port, cfg.Database)
		} else {
			uri = fmt.Sprintf("mongodb://%s:%d", cfg.Host, cfg.Port)
		}
	}

	clientOpts := options.Client().ApplyURI(uri)
	client, err := mongo.Connect(clientOpts)
	if err != nil {
		return fmt.Errorf("failed to connect to mongodb: %w", err)
	}

	if err := client.Ping(ctx, nil); err != nil {
		client.Disconnect(ctx)
		return fmt.Errorf("failed to ping mongodb: %w", err)
	}

	d.client = client
	return nil
}

func (d *MongoDriver) Disconnect(ctx context.Context) error {
	if d.client != nil {
		return d.client.Disconnect(ctx)
	}
	return nil
}

func (d *MongoDriver) Ping(ctx context.Context) error {
	if d.client == nil {
		return fmt.Errorf("not connected")
	}
	return d.client.Ping(ctx, nil)
}

func (d *MongoDriver) Execute(ctx context.Context, query string) (*QueryResult, error) {
	if d.client == nil {
		return nil, fmt.Errorf("not connected")
	}

	start := time.Now()

	// Detect JSON array — execute each element sequentially
	trimmed := strings.TrimSpace(query)
	if strings.HasPrefix(trimmed, "[") {
		return d.executeBatch(ctx, trimmed, start)
	}

	return d.executeSingle(ctx, trimmed, start)
}

// executeBatch handles a JSON array of queries, running each sequentially and merging results
func (d *MongoDriver) executeBatch(ctx context.Context, query string, start time.Time) (*QueryResult, error) {
	var cmds []bson.M
	if err := bson.UnmarshalExtJSON([]byte(query), false, &cmds); err != nil {
		return &QueryResult{Error: fmt.Sprintf("invalid query JSON array: %v", err), ExecutionTime: measureTime(start)}, nil
	}

	if len(cmds) == 0 {
		return &QueryResult{Error: "empty query array", ExecutionTime: measureTime(start)}, nil
	}

	// Execute all queries sequentially and merge results
	merged := &QueryResult{}
	colSet := make(map[string]bool)

	for i, cmd := range cmds {
		cmdJSON, err := bson.MarshalExtJSON(cmd, false, false)
		if err != nil {
			merged.Error = fmt.Sprintf("query[%d]: failed to marshal: %v", i, err)
			break
		}

		result, execErr := d.executeSingle(ctx, string(cmdJSON), start)
		if execErr != nil {
			return nil, execErr
		}
		if result.Error != "" {
			collection, _ := cmd["collection"].(string)
			merged.Error = fmt.Sprintf("query[%d] (%s): %s", i, collection, result.Error)
			break
		}

		// Add __collection__ column to each row
		collection, _ := cmd["collection"].(string)
		for _, row := range result.Rows {
			row["__collection__"] = collection
			for k := range row {
				colSet[k] = true
			}
		}
		merged.Rows = append(merged.Rows, result.Rows...)
		merged.RowCount += result.RowCount
		merged.AffectedRows += result.AffectedRows
	}

	// Build union of all columns
	if _, has := colSet["__collection__"]; has {
		merged.Columns = append(merged.Columns, ColumnMeta{Name: "__collection__", Type: "string"})
		delete(colSet, "__collection__")
	}
	for col := range colSet {
		merged.Columns = append(merged.Columns, ColumnMeta{Name: col, Type: "mixed"})
	}

	merged.ExecutionTime = measureTime(start)
	return merged, nil
}

func (d *MongoDriver) executeSingle(ctx context.Context, query string, start time.Time) (*QueryResult, error) {
	// Parse the JSON query: { "collection": "name", "action": "find", "filter": {}, "limit": 100 }
	var cmd bson.M
	if err := bson.UnmarshalExtJSON([]byte(query), false, &cmd); err != nil {
		return &QueryResult{Error: fmt.Sprintf("invalid query JSON: %v", err), ExecutionTime: measureTime(start)}, nil
	}

	collection, _ := cmd["collection"].(string)
	action, _ := cmd["action"].(string)
	if collection == "" {
		return &QueryResult{Error: "missing 'collection' in query", ExecutionTime: measureTime(start)}, nil
	}
	if action == "" {
		action = "find"
	}

	coll := d.client.Database(d.dbName).Collection(collection)

	switch strings.ToLower(action) {
	case "find":
		return d.executeFind(ctx, coll, cmd, start)
	case "count":
		return d.executeCount(ctx, coll, cmd, start)
	case "insert":
		return d.executeInsert(ctx, coll, cmd, start)
	case "delete":
		return d.executeDelete(ctx, coll, cmd, start)
	default:
		return &QueryResult{Error: fmt.Sprintf("unsupported action: %s", action), ExecutionTime: measureTime(start)}, nil
	}
}

func (d *MongoDriver) executeFind(ctx context.Context, coll *mongo.Collection, cmd bson.M, start time.Time) (*QueryResult, error) {
	filter, _ := cmd["filter"].(bson.M)
	if filter == nil {
		filter = bson.M{}
	}

	limit := int64(100)
	if l, ok := cmd["limit"].(int64); ok {
		limit = l
	} else if l, ok := cmd["limit"].(int32); ok {
		limit = int64(l)
	} else if l, ok := cmd["limit"].(float64); ok {
		limit = int64(l)
	}

	skip := int64(0)
	if s, ok := cmd["skip"].(int64); ok {
		skip = s
	} else if s, ok := cmd["skip"].(int32); ok {
		skip = int64(s)
	} else if s, ok := cmd["skip"].(float64); ok {
		skip = int64(s)
	}

	opts := options.Find().SetLimit(limit).SetSkip(skip)
	cursor, err := coll.Find(ctx, filter, opts)
	if err != nil {
		return &QueryResult{Error: err.Error(), ExecutionTime: measureTime(start)}, nil
	}
	defer cursor.Close(ctx)

	var results []map[string]interface{}
	for cursor.Next(ctx) {
		var doc bson.M
		if err := cursor.Decode(&doc); err != nil {
			continue
		}
		row := make(map[string]interface{})
		for k, v := range doc {
			row[k] = fmt.Sprintf("%v", v)
		}
		results = append(results, row)
	}

	// Build column list from first result
	var columns []ColumnMeta
	if len(results) > 0 {
		for k := range results[0] {
			columns = append(columns, ColumnMeta{Name: k, Type: "mixed"})
		}
	}

	return &QueryResult{
		Columns:       columns,
		Rows:          results,
		RowCount:      int64(len(results)),
		ExecutionTime: measureTime(start),
	}, nil
}

func (d *MongoDriver) executeCount(ctx context.Context, coll *mongo.Collection, cmd bson.M, start time.Time) (*QueryResult, error) {
	filter, _ := cmd["filter"].(bson.M)
	if filter == nil {
		filter = bson.M{}
	}

	count, err := coll.CountDocuments(ctx, filter)
	if err != nil {
		return &QueryResult{Error: err.Error(), ExecutionTime: measureTime(start)}, nil
	}

	return &QueryResult{
		Columns:       []ColumnMeta{{Name: "count", Type: "int64"}},
		Rows:          []map[string]interface{}{{"count": count}},
		RowCount:      1,
		ExecutionTime: measureTime(start),
	}, nil
}

func (d *MongoDriver) executeInsert(ctx context.Context, coll *mongo.Collection, cmd bson.M, start time.Time) (*QueryResult, error) {
	doc, _ := cmd["document"].(bson.M)
	if doc == nil {
		return &QueryResult{Error: "missing 'document' for insert", ExecutionTime: measureTime(start)}, nil
	}

	_, err := coll.InsertOne(ctx, doc)
	if err != nil {
		return &QueryResult{Error: err.Error(), ExecutionTime: measureTime(start)}, nil
	}

	return &QueryResult{
		AffectedRows:  1,
		ExecutionTime: measureTime(start),
	}, nil
}

func (d *MongoDriver) executeDelete(ctx context.Context, coll *mongo.Collection, cmd bson.M, start time.Time) (*QueryResult, error) {
	filter, _ := cmd["filter"].(bson.M)
	if filter == nil {
		return &QueryResult{Error: "missing 'filter' for delete", ExecutionTime: measureTime(start)}, nil
	}

	result, err := coll.DeleteMany(ctx, filter)
	if err != nil {
		return &QueryResult{Error: err.Error(), ExecutionTime: measureTime(start)}, nil
	}

	return &QueryResult{
		AffectedRows:  result.DeletedCount,
		ExecutionTime: measureTime(start),
	}, nil
}

func (d *MongoDriver) Tables(ctx context.Context) ([]TableInfo, error) {
	if d.client == nil {
		return nil, fmt.Errorf("not connected")
	}

	db := d.client.Database(d.dbName)
	names, err := db.ListCollectionNames(ctx, bson.M{})
	if err != nil {
		return nil, err
	}

	var tables []TableInfo
	for _, name := range names {
		tables = append(tables, TableInfo{
			Name: name,
			Type: "table", // MongoDB collections map to tables
		})
	}
	return tables, nil
}

func (d *MongoDriver) Columns(ctx context.Context, table string) ([]ColumnInfo, error) {
	if d.client == nil {
		return nil, fmt.Errorf("not connected")
	}

	// Sample documents to infer schema
	coll := d.client.Database(d.dbName).Collection(table)
	cursor, err := coll.Find(ctx, bson.M{}, options.Find().SetLimit(100))
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	fieldTypes := make(map[string]string)
	fieldOrder := make(map[string]int)
	order := 1

	for cursor.Next(ctx) {
		var doc bson.M
		if err := cursor.Decode(&doc); err != nil {
			continue
		}
		for k, v := range doc {
			if _, exists := fieldTypes[k]; !exists {
				fieldTypes[k] = inferBSONType(v)
				fieldOrder[k] = order
				order++
			}
		}
	}

	var columns []ColumnInfo
	for name, typ := range fieldTypes {
		c := ColumnInfo{
			Name:       name,
			Type:       typ,
			Nullable:   true,
			PrimaryKey: name == "_id",
			OrdinalPos: fieldOrder[name],
		}
		columns = append(columns, c)
	}
	return columns, nil
}

func (d *MongoDriver) Views(ctx context.Context) ([]string, error) {
	return nil, nil
}

func (d *MongoDriver) Functions(ctx context.Context) ([]FunctionInfo, error) {
	return nil, nil
}

func (d *MongoDriver) ExecuteArgs(ctx context.Context, query string, args ...interface{}) (*QueryResult, error) {
	// MongoDB doesn't use SQL parameterized queries — delegate to Execute
	return d.Execute(ctx, query)
}

func (d *MongoDriver) Type() DatabaseType { return MongoDB }
func (d *MongoDriver) IsConnected() bool  { return d.client != nil }

// ─── MultiDatabaseDriver implementation ───

func (d *MongoDriver) Databases(ctx context.Context) ([]DatabaseInfo, error) {
	if d.client == nil {
		return nil, fmt.Errorf("not connected")
	}

	systemDBs := map[string]bool{"admin": true, "local": true, "config": true}

	names, err := d.client.ListDatabaseNames(ctx, bson.M{})
	if err != nil {
		return nil, fmt.Errorf("failed to list databases: %w", err)
	}

	var databases []DatabaseInfo
	for _, name := range names {
		if systemDBs[name] {
			continue
		}
		databases = append(databases, DatabaseInfo{Name: name})
	}
	return databases, nil
}

func (d *MongoDriver) TablesInDB(ctx context.Context, database string) ([]TableInfo, error) {
	if d.client == nil {
		return nil, fmt.Errorf("not connected")
	}

	db := d.client.Database(database)
	names, err := db.ListCollectionNames(ctx, bson.M{})
	if err != nil {
		return nil, err
	}

	var tables []TableInfo
	for _, name := range names {
		tables = append(tables, TableInfo{Name: name, Type: "table"})
	}
	return tables, nil
}

func (d *MongoDriver) ColumnsInDB(ctx context.Context, database string, table string) ([]ColumnInfo, error) {
	if d.client == nil {
		return nil, fmt.Errorf("not connected")
	}

	coll := d.client.Database(database).Collection(table)
	cursor, err := coll.Find(ctx, bson.M{}, options.Find().SetLimit(100))
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	fieldTypes := make(map[string]string)
	fieldOrder := make(map[string]int)
	order := 1

	for cursor.Next(ctx) {
		var doc bson.M
		if err := cursor.Decode(&doc); err != nil {
			continue
		}
		for k, v := range doc {
			if _, exists := fieldTypes[k]; !exists {
				fieldTypes[k] = inferBSONType(v)
				fieldOrder[k] = order
				order++
			}
		}
	}

	var columns []ColumnInfo
	for name, typ := range fieldTypes {
		columns = append(columns, ColumnInfo{
			Name:       name,
			Type:       typ,
			Nullable:   true,
			PrimaryKey: name == "_id",
			OrdinalPos: fieldOrder[name],
		})
	}
	return columns, nil
}

func (d *MongoDriver) SwitchDatabase(ctx context.Context, database string) error {
	if d.client == nil {
		return fmt.Errorf("not connected")
	}
	d.dbName = database
	return nil
}

func inferBSONType(v interface{}) string {
	switch v.(type) {
	case string:
		return "string"
	case int32:
		return "int"
	case int64:
		return "long"
	case float64:
		return "double"
	case bool:
		return "bool"
	case bson.M, bson.D:
		return "object"
	case bson.A:
		return "array"
	case bson.ObjectID:
		return "objectId"
	case bson.DateTime:
		return "date"
	case bson.Timestamp:
		return "timestamp"
	case bson.Decimal128:
		return "decimal"
	case bson.Binary:
		return "binData"
	case bson.Regex:
		return "regex"
	case nil:
		return "null"
	default:
		return "mixed"
	}
}

// extractMongoDBFromURI parses the database name from a MongoDB connection URI.
// Returns empty string if no database is specified.
func extractMongoDBFromURI(rawURI string) string {
	// Replace mongodb+srv:// with https:// for url.Parse compatibility
	normalized := rawURI
	if strings.HasPrefix(normalized, "mongodb+srv://") {
		normalized = "https://" + strings.TrimPrefix(normalized, "mongodb+srv://")
	} else if strings.HasPrefix(normalized, "mongodb://") {
		normalized = "https://" + strings.TrimPrefix(normalized, "mongodb://")
	}

	u, err := url.Parse(normalized)
	if err != nil {
		return ""
	}

	// Path is "/<database>" — trim leading slash
	db := strings.TrimPrefix(u.Path, "/")
	if db == "" {
		return ""
	}
	return db
}

// GetCollectionValidator retrieves the JSON Schema validator for a MongoDB collection.
// Returns an empty map if no validator is set.
func (d *MongoDriver) GetCollectionValidator(ctx context.Context, database, collection string) (map[string]interface{}, error) {
	if d.client == nil {
		return nil, fmt.Errorf("not connected")
	}

	db := d.client.Database(database)
	filter := bson.M{"name": collection}
	cursor, err := db.ListCollections(ctx, filter)
	if err != nil {
		return nil, fmt.Errorf("listCollections: %w", err)
	}
	defer cursor.Close(ctx)

	if !cursor.Next(ctx) {
		return nil, fmt.Errorf("collection %q not found", collection)
	}

	var result bson.M
	if err := cursor.Decode(&result); err != nil {
		return nil, fmt.Errorf("decode collection info: %w", err)
	}

	// Extract validator.$jsonSchema from collection options
	opts, ok := result["options"].(bson.M)
	if !ok {
		return map[string]interface{}{}, nil
	}
	validator, ok := opts["validator"].(bson.M)
	if !ok {
		return map[string]interface{}{}, nil
	}
	schema, ok := validator["$jsonSchema"].(bson.M)
	if !ok {
		return map[string]interface{}{}, nil
	}

	return schema, nil
}

// SetCollectionValidator applies a JSON Schema validator to a MongoDB collection.
func (d *MongoDriver) SetCollectionValidator(ctx context.Context, database, collection string, schema map[string]interface{}) error {
	if d.client == nil {
		return fmt.Errorf("not connected")
	}

	db := d.client.Database(database)
	cmd := bson.D{
		{Key: "collMod", Value: collection},
		{Key: "validator", Value: bson.M{
			"$jsonSchema": schema,
		}},
		{Key: "validationLevel", Value: "moderate"},
		{Key: "validationAction", Value: "warn"},
	}

	var result bson.M
	if err := db.RunCommand(ctx, cmd).Decode(&result); err != nil {
		return fmt.Errorf("collMod: %w", err)
	}
	return nil
}

// ─── ExportableDriver implementation ───

// GetTableRowCount returns total document count for a collection.
func (d *MongoDriver) GetTableRowCount(collection string) (int64, error) {
	if d.client == nil {
		return 0, fmt.Errorf("not connected")
	}

	ctx := context.Background()
	count, err := d.client.Database(d.dbName).Collection(collection).CountDocuments(ctx, bson.D{})
	if err != nil {
		return 0, fmt.Errorf("count documents: %w", err)
	}
	return count, nil
}

// GetTableRows returns documents for a collection with limit/offset pagination.
func (d *MongoDriver) GetTableRows(collection string, limit, offset int) (*QueryResult, error) {
	if d.client == nil {
		return nil, fmt.Errorf("not connected")
	}

	ctx := context.Background()
	coll := d.client.Database(d.dbName).Collection(collection)

	opts := options.Find().SetLimit(int64(limit)).SetSkip(int64(offset))
	cursor, err := coll.Find(ctx, bson.D{}, opts)
	if err != nil {
		return nil, fmt.Errorf("find: %w", err)
	}
	defer cursor.Close(ctx)

	var rows []map[string]interface{}
	var columns []ColumnMeta
	colSeen := make(map[string]bool)

	for cursor.Next(ctx) {
		raw := cursor.Current

		// Extended JSON preserves BSON types (ObjectId, Date, Decimal128)
		extJSON, err := bson.MarshalExtJSON(raw, true, false)
		if err != nil {
			continue
		}

		var row map[string]interface{}
		if err := bson.UnmarshalExtJSON(extJSON, true, &row); err != nil {
			continue
		}

		for k := range row {
			if !colSeen[k] {
				colSeen[k] = true
				columns = append(columns, ColumnMeta{Name: k, Type: "mixed"})
			}
		}

		rows = append(rows, row)
	}

	if err := cursor.Err(); err != nil {
		return nil, fmt.Errorf("cursor: %w", err)
	}

	if rows == nil {
		rows = []map[string]interface{}{}
	}

	return &QueryResult{
		Columns:  columns,
		Rows:     rows,
		RowCount: int64(len(rows)),
	}, nil
}

// GetCreateTableDDL returns empty string — MongoDB has no DDL.
func (d *MongoDriver) GetCreateTableDDL(collection string) (string, error) {
	return "", nil
}

// MongoDatabase returns a handle to the named database.
// Used by the export/import service for operations requiring direct MongoDB client access.
func (d *MongoDriver) MongoDatabase(name string) *mongo.Database {
	if d.client == nil {
		return nil
	}
	return d.client.Database(name)
}

// ─── MongoDB-specific export methods ───

// GetCollectionIndexes returns all indexes for a collection.
func (d *MongoDriver) GetCollectionIndexes(collection string) ([]bson.M, error) {
	if d.client == nil {
		return nil, fmt.Errorf("not connected")
	}

	ctx := context.Background()
	cursor, err := d.client.Database(d.dbName).Collection(collection).Indexes().List(ctx)
	if err != nil {
		return nil, fmt.Errorf("list indexes: %w", err)
	}
	defer cursor.Close(ctx)

	var indexes []bson.M
	for cursor.Next(ctx) {
		var idx bson.M
		if err := cursor.Decode(&idx); err != nil {
			continue
		}
		indexes = append(indexes, idx)
	}

	if err := cursor.Err(); err != nil {
		return nil, fmt.Errorf("cursor: %w", err)
	}

	if indexes == nil {
		indexes = []bson.M{}
	}

	return indexes, nil
}
