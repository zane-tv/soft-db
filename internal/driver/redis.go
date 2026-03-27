package driver

import (
	"context"
	"fmt"
)

type RedisDriver struct {
	client interface{} // *redis.Client — populated in Task 2
	config ConnectionConfig
}

var _ Driver = (*RedisDriver)(nil)

func (d *RedisDriver) Connect(ctx context.Context, cfg ConnectionConfig) error {
	d.config = cfg
	_ = ctx
	return fmt.Errorf("redis driver not implemented")
}

func (d *RedisDriver) Disconnect(ctx context.Context) error {
	_ = ctx
	d.client = nil
	return nil
}

func (d *RedisDriver) Ping(ctx context.Context) error {
	_ = ctx
	return fmt.Errorf("redis driver not implemented")
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

func (d *RedisDriver) Type() DatabaseType {
	return Redis
}

func (d *RedisDriver) IsConnected() bool {
	return false
}
