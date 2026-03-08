package driver

import (
	"context"
	"fmt"
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

	uri := fmt.Sprintf("mongodb://%s:%s@%s:%d/%s",
		cfg.Username, cfg.Password, cfg.Host, cfg.Port, cfg.Database)

	if cfg.Username == "" {
		uri = fmt.Sprintf("mongodb://%s:%d/%s", cfg.Host, cfg.Port, cfg.Database)
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

	opts := options.Find().SetLimit(limit)
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

func (d *MongoDriver) Type() DatabaseType { return MongoDB }
func (d *MongoDriver) IsConnected() bool  { return d.client != nil }

func inferBSONType(v interface{}) string {
	switch v.(type) {
	case string:
		return "string"
	case int32:
		return "int32"
	case int64:
		return "int64"
	case float64:
		return "double"
	case bool:
		return "bool"
	case bson.M, bson.D:
		return "object"
	case bson.A:
		return "array"
	default:
		return "mixed"
	}
}
