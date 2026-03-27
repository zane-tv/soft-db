package services

import (
	"context"
	"encoding/json"
	"fmt"
	"io"

	"soft-db/internal/driver"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
)

// ─── Schema types ───

type MongoSchemaExport struct {
	Database    string                  `json:"database"`
	Collections []MongoCollectionSchema `json:"collections"`
}

type MongoCollectionSchema struct {
	Name      string                   `json:"name"`
	Validator map[string]interface{}   `json:"validator,omitempty"`
	Indexes   []map[string]interface{} `json:"indexes,omitempty"`
}

// ─── Schema export ───

func ExportMongoSchema(drv interface{}, database string, collections []string) ([]byte, error) {
	md, ok := drv.(*driver.MongoDriver)
	if !ok {
		return nil, fmt.Errorf("driver is not a MongoDriver")
	}

	ctx := context.Background()
	db := md.MongoDatabase(database)
	if db == nil {
		return nil, fmt.Errorf("not connected")
	}

	if len(collections) == 0 {
		tables, err := md.TablesInDB(ctx, database)
		if err != nil {
			return nil, fmt.Errorf("list collections: %w", err)
		}
		for _, t := range tables {
			collections = append(collections, t.Name)
		}
	}

	export := MongoSchemaExport{
		Database:    database,
		Collections: make([]MongoCollectionSchema, 0, len(collections)),
	}

	for _, name := range collections {
		cs := MongoCollectionSchema{Name: name}

		validator, err := md.GetCollectionValidator(ctx, database, name)
		if err == nil && len(validator) > 0 {
			cs.Validator = validator
		}

		indexes, err := listIndexes(ctx, db, name)
		if err != nil {
			return nil, fmt.Errorf("list indexes for %q: %w", name, err)
		}
		if len(indexes) > 0 {
			cs.Indexes = indexes
		}

		export.Collections = append(export.Collections, cs)
	}

	return json.MarshalIndent(export, "", "  ")
}

func listIndexes(ctx context.Context, db *mongo.Database, collection string) ([]map[string]interface{}, error) {
	cursor, err := db.Collection(collection).Indexes().List(ctx)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	var indexes []map[string]interface{}
	for cursor.Next(ctx) {
		var idx bson.M
		if err := cursor.Decode(&idx); err != nil {
			continue
		}
		jsonIdx, err := bsonMapToJSON(idx)
		if err != nil {
			continue
		}
		indexes = append(indexes, jsonIdx)
	}
	return indexes, cursor.Err()
}

func bsonMapToJSON(m bson.M) (map[string]interface{}, error) {
	extJSON, err := bson.MarshalExtJSON(m, false, false)
	if err != nil {
		return nil, err
	}
	var result map[string]interface{}
	if err := json.Unmarshal(extJSON, &result); err != nil {
		return nil, err
	}
	return result, nil
}

// ─── Schema import ───

func ImportMongoSchema(drv interface{}, database string, schema []byte, strategy ConflictStrategy) error {
	md, ok := drv.(*driver.MongoDriver)
	if !ok {
		return fmt.Errorf("driver is not a MongoDriver")
	}

	ctx := context.Background()
	db := md.MongoDatabase(database)
	if db == nil {
		return fmt.Errorf("not connected")
	}

	var export MongoSchemaExport
	if err := json.Unmarshal(schema, &export); err != nil {
		return fmt.Errorf("parse schema: %w", err)
	}

	existing, err := db.ListCollectionNames(ctx, bson.M{})
	if err != nil {
		return fmt.Errorf("list collections: %w", err)
	}
	existingSet := make(map[string]bool, len(existing))
	for _, name := range existing {
		existingSet[name] = true
	}

	for _, coll := range export.Collections {
		if existingSet[coll.Name] {
			switch strategy {
			case ConflictSkip:
				continue
			case ConflictReplace:
				if err := db.Collection(coll.Name).Drop(ctx); err != nil {
					return fmt.Errorf("drop collection %q: %w", coll.Name, err)
				}
			default:
				continue
			}
		}

		if err := createCollection(ctx, db, coll.Name, coll.Validator); err != nil {
			return fmt.Errorf("create collection %q: %w", coll.Name, err)
		}

		if err := createIndexes(ctx, db, coll.Name, coll.Indexes); err != nil {
			return fmt.Errorf("create indexes for %q: %w", coll.Name, err)
		}
	}

	return nil
}

func createCollection(ctx context.Context, db *mongo.Database, name string, validator map[string]interface{}) error {
	cmd := bson.D{{Key: "create", Value: name}}
	if len(validator) > 0 {
		cmd = append(cmd, bson.E{Key: "validator", Value: bson.M{"$jsonSchema": validator}})
	}
	var result bson.M
	return db.RunCommand(ctx, cmd).Decode(&result)
}

func createIndexes(ctx context.Context, db *mongo.Database, collection string, indexes []map[string]interface{}) error {
	var indexDocs bson.A
	for _, idx := range indexes {
		name, _ := idx["name"].(string)
		if name == "_id_" {
			continue
		}
		bsonIdx := jsonToBSONMap(idx)
		delete(bsonIdx, "v")
		delete(bsonIdx, "ns")
		indexDocs = append(indexDocs, bsonIdx)
	}

	if len(indexDocs) == 0 {
		return nil
	}

	cmd := bson.D{
		{Key: "createIndexes", Value: collection},
		{Key: "indexes", Value: indexDocs},
	}
	var result bson.M
	return db.RunCommand(ctx, cmd).Decode(&result)
}

func jsonToBSONMap(m map[string]interface{}) bson.M {
	result := bson.M{}
	for k, v := range m {
		switch val := v.(type) {
		case map[string]interface{}:
			result[k] = jsonToBSONMap(val)
		case float64:
			result[k] = int32(val)
		case []interface{}:
			arr := make(bson.A, len(val))
			for i, elem := range val {
				if em, ok := elem.(map[string]interface{}); ok {
					arr[i] = jsonToBSONMap(em)
				} else {
					arr[i] = elem
				}
			}
			result[k] = arr
		default:
			result[k] = v
		}
	}
	return result
}

// ─── Data export ───

func ExportMongoData(drv interface{}, database string, collection string, writer io.Writer, onProgress func(current, total int64)) error {
	ed, ok := drv.(driver.ExportableDriver)
	if !ok {
		return fmt.Errorf("driver does not implement ExportableDriver")
	}

	total, err := ed.GetTableRowCount(collection)
	if err != nil {
		return fmt.Errorf("get row count: %w", err)
	}

	if _, err := io.WriteString(writer, "[\n"); err != nil {
		return fmt.Errorf("write open bracket: %w", err)
	}

	const chunkSize = 1000
	var processedRows int64
	firstDoc := true

	for offset := 0; ; offset += chunkSize {
		result, err := ed.GetTableRows(collection, chunkSize, offset)
		if err != nil {
			return fmt.Errorf("get rows (offset %d): %w", offset, err)
		}
		if len(result.Rows) == 0 {
			break
		}

		for _, row := range result.Rows {
			extJSON, err := bson.MarshalExtJSON(row, true, false)
			if err != nil {
				return fmt.Errorf("marshal Extended JSON: %w", err)
			}

			if !firstDoc {
				if _, err := io.WriteString(writer, ",\n"); err != nil {
					return err
				}
			}
			if _, err := io.WriteString(writer, "  "); err != nil {
				return err
			}
			if _, err := writer.Write(extJSON); err != nil {
				return err
			}
			firstDoc = false
		}

		processedRows += int64(len(result.Rows))
		if onProgress != nil {
			onProgress(processedRows, total)
		}

		if len(result.Rows) < chunkSize {
			break
		}
	}

	closing := "\n]"
	if processedRows == 0 {
		closing = "]"
	}
	if _, err := io.WriteString(writer, closing); err != nil {
		return fmt.Errorf("write close bracket: %w", err)
	}

	return nil
}

// ─── Data import ───

func ImportMongoData(drv interface{}, database string, collection string, data io.Reader, strategy ConflictStrategy) error {
	md, ok := drv.(*driver.MongoDriver)
	if !ok {
		return fmt.Errorf("driver is not a MongoDriver")
	}

	ctx := context.Background()
	db := md.MongoDatabase(database)
	if db == nil {
		return fmt.Errorf("not connected")
	}

	decoder := json.NewDecoder(data)

	token, err := decoder.Token()
	if err != nil {
		return fmt.Errorf("read opening token: %w", err)
	}
	if delim, ok := token.(json.Delim); !ok || delim != '[' {
		return fmt.Errorf("expected JSON array, got %v", token)
	}

	const batchSize = 1000
	var batch []bson.M

	for decoder.More() {
		var raw json.RawMessage
		if err := decoder.Decode(&raw); err != nil {
			return fmt.Errorf("decode document: %w", err)
		}

		var doc bson.M
		if err := bson.UnmarshalExtJSON([]byte(raw), true, &doc); err != nil {
			if err2 := bson.UnmarshalExtJSON([]byte(raw), false, &doc); err2 != nil {
				return fmt.Errorf("unmarshal Extended JSON: %w (relaxed: %w)", err, err2)
			}
		}

		batch = append(batch, doc)

		if len(batch) >= batchSize {
			if err := insertBatch(ctx, db, collection, batch, strategy); err != nil {
				return err
			}
			batch = batch[:0]
		}
	}

	if len(batch) > 0 {
		if err := insertBatch(ctx, db, collection, batch, strategy); err != nil {
			return err
		}
	}

	return nil
}

func insertBatch(ctx context.Context, db *mongo.Database, collection string, batch []bson.M, strategy ConflictStrategy) error {
	if strategy == ConflictReplace {
		return upsertBatch(ctx, db, collection, batch)
	}

	docs := make(bson.A, len(batch))
	for i, d := range batch {
		docs[i] = d
	}

	cmd := bson.D{
		{Key: "insert", Value: collection},
		{Key: "documents", Value: docs},
		{Key: "ordered", Value: false},
	}
	var result bson.M
	if err := db.RunCommand(ctx, cmd).Decode(&result); err != nil {
		return fmt.Errorf("insert batch: %w", err)
	}

	if strategy == ConflictSkip {
		return checkWriteErrors(result, true)
	}
	return checkWriteErrors(result, false)
}

func upsertBatch(ctx context.Context, db *mongo.Database, collection string, batch []bson.M) error {
	var updates bson.A
	var inserts bson.A

	for _, doc := range batch {
		id, hasID := doc["_id"]
		if !hasID {
			inserts = append(inserts, doc)
			continue
		}
		updates = append(updates, bson.M{
			"q":      bson.M{"_id": id},
			"u":      doc,
			"upsert": true,
		})
	}

	if len(updates) > 0 {
		cmd := bson.D{
			{Key: "update", Value: collection},
			{Key: "updates", Value: updates},
		}
		var result bson.M
		if err := db.RunCommand(ctx, cmd).Decode(&result); err != nil {
			return fmt.Errorf("upsert batch: %w", err)
		}
		if err := checkWriteErrors(result, false); err != nil {
			return err
		}
	}

	if len(inserts) > 0 {
		cmd := bson.D{
			{Key: "insert", Value: collection},
			{Key: "documents", Value: inserts},
		}
		var result bson.M
		if err := db.RunCommand(ctx, cmd).Decode(&result); err != nil {
			return fmt.Errorf("insert batch: %w", err)
		}
		if err := checkWriteErrors(result, false); err != nil {
			return err
		}
	}

	return nil
}

const duplicateKeyCode = 11000

func checkWriteErrors(result bson.M, skipDuplicates bool) error {
	writeErrors, ok := result["writeErrors"]
	if !ok {
		return nil
	}

	errs, ok := writeErrors.(bson.A)
	if !ok || len(errs) == 0 {
		return nil
	}

	for _, e := range errs {
		errDoc, ok := e.(bson.M)
		if !ok {
			continue
		}
		code, _ := errDoc["code"].(int32)
		if skipDuplicates && code == duplicateKeyCode {
			continue
		}
		errmsg, _ := errDoc["errmsg"].(string)
		return fmt.Errorf("write error (code %d): %s", code, errmsg)
	}

	return nil
}
