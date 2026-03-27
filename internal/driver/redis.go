package driver

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

// parseRedisCommand splits a Redis CLI-style command line into tokens.
// It handles single/double-quoted strings and escaped quotes.
// Returns nil for empty lines and lines beginning with '#'.
func parseRedisCommand(line string) []string {
	line = strings.TrimSpace(line)
	if len(line) == 0 || strings.HasPrefix(line, "#") {
		return nil
	}

	var tokens []string
	var cur strings.Builder
	inSingle := false
	inDouble := false

	for i := 0; i < len(line); i++ {
		ch := line[i]
		switch {
		case ch == '\'' && !inDouble:
			inSingle = !inSingle
		case ch == '"' && !inSingle:
			inDouble = !inDouble
		case ch == '\\' && (inSingle || inDouble) && i+1 < len(line):
			i++
			cur.WriteByte(line[i])
		case (ch == ' ' || ch == '\t') && !inSingle && !inDouble:
			if cur.Len() > 0 {
				tokens = append(tokens, cur.String())
				cur.Reset()
			}
		default:
			cur.WriteByte(ch)
		}
	}
	if cur.Len() > 0 {
		tokens = append(tokens, cur.String())
	}
	return tokens
}

// mapRedisResult converts a raw go-redis Do() result into rows and column metadata.
func mapRedisResult(val interface{}) ([]map[string]interface{}, []ColumnMeta) {
	switch v := val.(type) {
	case string:
		return []map[string]interface{}{{"result": v}},
			[]ColumnMeta{{Name: "result", Type: "string"}}

	case int64:
		return []map[string]interface{}{{"result": strconv.FormatInt(v, 10)}},
			[]ColumnMeta{{Name: "result", Type: "integer"}}

	case []interface{}:
		rows := make([]map[string]interface{}, len(v))
		for i, elem := range v {
			rows[i] = map[string]interface{}{
				"index": i,
				"value": fmt.Sprint(elem),
			}
		}
		return rows, []ColumnMeta{
			{Name: "index", Type: "integer"},
			{Name: "value", Type: "string"},
		}

	case map[interface{}]interface{}:
		rows := make([]map[string]interface{}, 0, len(v))
		for k, vv := range v {
			rows = append(rows, map[string]interface{}{
				"field": fmt.Sprint(k),
				"value": fmt.Sprint(vv),
			})
		}
		return rows, []ColumnMeta{
			{Name: "field", Type: "string"},
			{Name: "value", Type: "string"},
		}

	case map[string]string:
		rows := make([]map[string]interface{}, 0, len(v))
		for k, vv := range v {
			rows = append(rows, map[string]interface{}{
				"field": k,
				"value": vv,
			})
		}
		return rows, []ColumnMeta{
			{Name: "field", Type: "string"},
			{Name: "value", Type: "string"},
		}

	default:
		// nil or unknown type
		return []map[string]interface{}{{"result": "(nil)"}},
			[]ColumnMeta{{Name: "result", Type: "string"}}
	}
}

// RedisDriver implements Driver for Redis.
type RedisDriver struct {
	client  *redis.Client
	config  ConnectionConfig
	dbIndex int // current database index (0–15)
}

var _ Driver = (*RedisDriver)(nil)
var _ MultiDatabaseDriver = (*RedisDriver)(nil)

// Connect establishes a Redis connection using the provided config.
// cfg.Database is parsed as a Redis db index (0–15); defaults to 0 if empty or invalid.
func (d *RedisDriver) Connect(ctx context.Context, cfg ConnectionConfig) error {
	d.config = cfg

	// Parse db index from the Database field (string "0"-"15")
	dbIndex := 0
	if n, err := strconv.Atoi(cfg.Database); err == nil {
		dbIndex = n
	}

	addr := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)

	opts := &redis.Options{
		Addr:     addr,
		Password: cfg.Password,
		Username: cfg.Username,
		DB:       dbIndex,
	}

	client := redis.NewClient(opts)

	if err := client.Ping(ctx).Err(); err != nil {
		client.Close()
		return fmt.Errorf("failed to ping redis: %w", err)
	}

	d.client = client
	d.dbIndex = dbIndex
	return nil
}

// Disconnect closes the Redis connection.
func (d *RedisDriver) Disconnect(ctx context.Context) error {
	_ = ctx
	if d.client != nil {
		if err := d.client.Close(); err != nil {
			return err
		}
		d.client = nil
	}
	return nil
}

// Ping checks that the Redis connection is still alive.
func (d *RedisDriver) Ping(ctx context.Context) error {
	if d.client == nil {
		return fmt.Errorf("not connected")
	}
	return d.client.Ping(ctx).Err()
}

func (d *RedisDriver) Execute(ctx context.Context, query string) (*QueryResult, error) {
	if d.client == nil {
		return nil, fmt.Errorf("not connected")
	}

	start := time.Now()
	lines := strings.Split(query, "\n")

	var allRows []map[string]interface{}
	var lastCols []ColumnMeta
	cmdCount := 0

	for _, line := range lines {
		tokens := parseRedisCommand(line)
		if tokens == nil {
			continue
		}
		cmdCount++

		allArgs := make([]interface{}, len(tokens))
		for i, t := range tokens {
			allArgs[i] = t
		}

		val, err := d.client.Do(ctx, allArgs...).Result()
		if err != nil {
			elapsed := float64(time.Since(start).Microseconds()) / 1000.0
			return &QueryResult{
				Error:         err.Error(),
				ExecutionTime: elapsed,
			}, nil
		}

		rows, cols := mapRedisResult(val)
		allRows = append(allRows, rows...)
		lastCols = cols
	}

	if lastCols == nil {
		lastCols = []ColumnMeta{{Name: "result", Type: "string"}}
	}
	if cmdCount > 1 {
		lastCols = []ColumnMeta{{Name: "result", Type: "string"}}
	}

	elapsed := float64(time.Since(start).Microseconds()) / 1000.0
	return &QueryResult{
		Columns:       lastCols,
		Rows:          allRows,
		RowCount:      int64(len(allRows)),
		ExecutionTime: elapsed,
	}, nil
}

func (d *RedisDriver) ExecuteArgs(ctx context.Context, query string, args ...interface{}) (*QueryResult, error) {
	return d.Execute(ctx, query)
}

func (d *RedisDriver) Tables(ctx context.Context) ([]TableInfo, error) {
	if d.client == nil {
		return nil, fmt.Errorf("not connected")
	}
	var tables []TableInfo
	var cursor uint64
	for {
		keys, nextCursor, err := d.client.Scan(ctx, cursor, "*", 100).Result()
		if err != nil {
			return nil, fmt.Errorf("failed to scan keys: %w", err)
		}
		for _, key := range keys {
			keyType, err := d.client.Type(ctx, key).Result()
			if err != nil {
				keyType = "unknown"
			}
			tables = append(tables, TableInfo{Name: key, Type: keyType})
		}
		cursor = nextCursor
		if cursor == 0 || len(tables) >= 1000 {
			break
		}
	}
	return tables, nil
}

func (d *RedisDriver) Columns(ctx context.Context, key string) ([]ColumnInfo, error) {
	if d.client == nil {
		return nil, fmt.Errorf("not connected")
	}

	keyType, err := d.client.Type(ctx, key).Result()
	if err != nil {
		keyType = "unknown"
	}

	ttlDur, _ := d.client.TTL(ctx, key).Result()
	ttlStr := strconv.FormatInt(int64(ttlDur.Seconds()), 10)

	// encoding (miniredis does not support OBJECT ENCODING — ignore error)
	encoding, _ := d.client.ObjectEncoding(ctx, key).Result()

	// memory usage in bytes (miniredis does not support MEMORY USAGE — ignore error)
	memBytes, _ := d.client.MemoryUsage(ctx, key).Result()
	sizeStr := strconv.FormatInt(memBytes, 10)

	columns := []ColumnInfo{
		{Name: "value", Type: keyType, OrdinalPos: 1},
		{Name: "ttl", Type: "integer", OrdinalPos: 2, Extra: ttlStr},
		{Name: "encoding", Type: "string", OrdinalPos: 3, Extra: encoding},
		{Name: "size", Type: "integer", OrdinalPos: 4, Extra: sizeStr},
	}
	return columns, nil
}

func (d *RedisDriver) Views(ctx context.Context) ([]string, error) {
	_ = ctx
	return nil, nil
}

func (d *RedisDriver) Functions(ctx context.Context) ([]FunctionInfo, error) {
	_ = ctx
	return nil, nil
}

// Type returns the database type identifier.
func (d *RedisDriver) Type() DatabaseType {
	return Redis
}

// IsConnected returns true when the client is initialised.
func (d *RedisDriver) IsConnected() bool {
	return d.client != nil
}

func (d *RedisDriver) Databases(ctx context.Context) ([]DatabaseInfo, error) {
	if d.client == nil {
		return nil, fmt.Errorf("not connected")
	}
	dbs := make([]DatabaseInfo, 16)
	for i := range 16 {
		dbs[i] = DatabaseInfo{Name: strconv.Itoa(i)}
	}
	return dbs, nil
}

func (d *RedisDriver) SwitchDatabase(ctx context.Context, database string) error {
	if d.client == nil {
		return fmt.Errorf("not connected")
	}
	idx, err := strconv.Atoi(database)
	if err != nil || idx < 0 || idx > 15 {
		return fmt.Errorf("invalid Redis database index: %q (must be 0-15)", database)
	}
	if err := d.client.Do(ctx, "SELECT", idx).Err(); err != nil {
		return fmt.Errorf("SELECT %d: %w", idx, err)
	}
	d.dbIndex = idx
	return nil
}

func (d *RedisDriver) TablesInDB(ctx context.Context, database string) ([]TableInfo, error) {
	if err := d.SwitchDatabase(ctx, database); err != nil {
		return nil, err
	}
	return d.Tables(ctx)
}

func (d *RedisDriver) ColumnsInDB(ctx context.Context, database string, table string) ([]ColumnInfo, error) {
	if err := d.SwitchDatabase(ctx, database); err != nil {
		return nil, err
	}
	return d.Columns(ctx, table)
}
