package driver

import (
	"context"
	"fmt"
	"strconv"

	"github.com/redis/go-redis/v9"
)

// RedisDriver implements Driver for Redis.
type RedisDriver struct {
	client *redis.Client
	config ConnectionConfig
}

var _ Driver = (*RedisDriver)(nil)

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
	_ = ctx
	_ = query
	return nil, fmt.Errorf("redis driver not implemented")
}

func (d *RedisDriver) ExecuteArgs(ctx context.Context, query string, args ...interface{}) (*QueryResult, error) {
	_ = ctx
	_ = query
	_ = args
	return nil, fmt.Errorf("redis driver not implemented")
}

func (d *RedisDriver) Tables(ctx context.Context) ([]TableInfo, error) {
	_ = ctx
	return nil, fmt.Errorf("redis driver not implemented")
}

func (d *RedisDriver) Columns(ctx context.Context, table string) ([]ColumnInfo, error) {
	_ = ctx
	_ = table
	return nil, fmt.Errorf("redis driver not implemented")
}

func (d *RedisDriver) Views(ctx context.Context) ([]string, error) {
	_ = ctx
	return nil, fmt.Errorf("redis driver not implemented")
}

func (d *RedisDriver) Functions(ctx context.Context) ([]FunctionInfo, error) {
	_ = ctx
	return nil, fmt.Errorf("redis driver not implemented")
}

// Type returns the database type identifier.
func (d *RedisDriver) Type() DatabaseType {
	return Redis
}

// IsConnected returns true when the client is initialised.
func (d *RedisDriver) IsConnected() bool {
	return d.client != nil
}
