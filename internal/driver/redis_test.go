package driver

import (
	"context"
	"slices"
	"strconv"
	"testing"

	"github.com/alicebob/miniredis/v2"
)

func TestNewDriverRedis(t *testing.T) {
	drv, err := NewDriver(Redis)
	if err != nil {
		t.Fatalf("NewDriver(Redis) error = %v", err)
	}
	if drv == nil {
		t.Fatal("NewDriver(Redis) returned nil driver")
	}
	if drv.Type() != Redis {
		t.Fatalf("driver type = %q; want %q", drv.Type(), Redis)
	}
}

func TestRedisConnect(t *testing.T) {
	s := miniredis.RunT(t)
	port, _ := strconv.Atoi(s.Port())

	drv := &RedisDriver{}
	err := drv.Connect(context.Background(), ConnectionConfig{
		Host: s.Host(),
		Port: port,
	})
	if err != nil {
		t.Fatalf("Connect() error = %v", err)
	}
	if !drv.IsConnected() {
		t.Fatal("expected IsConnected() true after successful Connect")
	}
}

func TestRedisConnectFail(t *testing.T) {
	drv := &RedisDriver{}
	err := drv.Connect(context.Background(), ConnectionConfig{
		Host: "127.0.0.1",
		Port: 19999,
	})
	if err == nil {
		t.Fatal("Connect() to invalid address should return error")
	}
	if drv.IsConnected() {
		t.Fatal("expected IsConnected() false after failed Connect")
	}
}

func TestRedisPing(t *testing.T) {
	s := miniredis.RunT(t)
	port, _ := strconv.Atoi(s.Port())

	drv := &RedisDriver{}
	if err := drv.Connect(context.Background(), ConnectionConfig{
		Host: s.Host(),
		Port: port,
	}); err != nil {
		t.Fatalf("Connect() error = %v", err)
	}

	if err := drv.Ping(context.Background()); err != nil {
		t.Fatalf("Ping() error = %v", err)
	}
}

func TestRedisDisconnect(t *testing.T) {
	s := miniredis.RunT(t)
	port, _ := strconv.Atoi(s.Port())

	drv := &RedisDriver{}
	if err := drv.Connect(context.Background(), ConnectionConfig{
		Host: s.Host(),
		Port: port,
	}); err != nil {
		t.Fatalf("Connect() error = %v", err)
	}

	if err := drv.Disconnect(context.Background()); err != nil {
		t.Fatalf("Disconnect() error = %v", err)
	}
	if drv.IsConnected() {
		t.Fatal("expected IsConnected() false after Disconnect")
	}
}

func TestRedisTables(t *testing.T) {
	s := miniredis.RunT(t)
	s.Set("key1", "value1")
	s.Set("key2", "value2")
	s.Set("key3", "value3")
	port, _ := strconv.Atoi(s.Port())

	drv := &RedisDriver{}
	if err := drv.Connect(context.Background(), ConnectionConfig{
		Host: s.Host(),
		Port: port,
	}); err != nil {
		t.Fatalf("Connect() error = %v", err)
	}

	tables, err := drv.Tables(context.Background())
	if err != nil {
		t.Fatalf("Tables() error = %v", err)
	}
	if len(tables) != 3 {
		t.Fatalf("Tables() returned %d tables; want 3", len(tables))
	}
	for _, tbl := range tables {
		if tbl.Type != "string" {
			t.Errorf("Tables() key %q type = %q; want %q", tbl.Name, tbl.Type, "string")
		}
	}
}

func TestRedisColumns(t *testing.T) {
	s := miniredis.RunT(t)
	s.Set("foo", "bar")
	port, _ := strconv.Atoi(s.Port())

	drv := &RedisDriver{}
	if err := drv.Connect(context.Background(), ConnectionConfig{
		Host: s.Host(),
		Port: port,
	}); err != nil {
		t.Fatalf("Connect() error = %v", err)
	}

	cols, err := drv.Columns(context.Background(), "foo")
	if err != nil {
		t.Fatalf("Columns() error = %v", err)
	}
	if len(cols) != 4 {
		t.Fatalf("Columns() returned %d columns; want 4", len(cols))
	}
	wantNames := []string{"value", "ttl", "encoding", "size"}
	for i, col := range cols {
		if col.Name != wantNames[i] {
			t.Errorf("Columns()[%d].Name = %q; want %q", i, col.Name, wantNames[i])
		}
	}
}

func newConnectedRedis(t *testing.T) (*RedisDriver, *miniredis.Miniredis) {
	t.Helper()
	s := miniredis.RunT(t)
	port, _ := strconv.Atoi(s.Port())
	drv := &RedisDriver{}
	if err := drv.Connect(context.Background(), ConnectionConfig{
		Host: s.Host(),
		Port: port,
	}); err != nil {
		t.Fatalf("Connect() error = %v", err)
	}
	return drv, s
}

func TestRedisExecuteSet(t *testing.T) {
	drv, _ := newConnectedRedis(t)
	ctx := context.Background()

	res, err := drv.Execute(ctx, "SET foo bar")
	if err != nil {
		t.Fatalf("Execute() error = %v", err)
	}
	if res.Error != "" {
		t.Fatalf("Execute() result error = %s", res.Error)
	}
	if res.RowCount != 1 {
		t.Fatalf("Execute() RowCount = %d; want 1", res.RowCount)
	}
	if got := res.Rows[0]["result"]; got != "OK" {
		t.Errorf("result = %v; want OK", got)
	}
}

func TestRedisExecuteGet(t *testing.T) {
	drv, _ := newConnectedRedis(t)
	ctx := context.Background()

	if _, err := drv.Execute(ctx, "SET foo bar"); err != nil {
		t.Fatalf("SET error = %v", err)
	}
	res, err := drv.Execute(ctx, "GET foo")
	if err != nil {
		t.Fatalf("Execute() error = %v", err)
	}
	if res.Error != "" {
		t.Fatalf("Execute() result error = %s", res.Error)
	}
	if res.RowCount != 1 {
		t.Fatalf("Execute() RowCount = %d; want 1", res.RowCount)
	}
	if got := res.Rows[0]["result"]; got != "bar" {
		t.Errorf("result = %v; want bar", got)
	}
}

func TestRedisExecuteHGetAll(t *testing.T) {
	drv, _ := newConnectedRedis(t)
	ctx := context.Background()

	if _, err := drv.Execute(ctx, "HSET myhash name John"); err != nil {
		t.Fatalf("HSET error = %v", err)
	}
	res, err := drv.Execute(ctx, "HGETALL myhash")
	if err != nil {
		t.Fatalf("Execute() error = %v", err)
	}
	if res.Error != "" {
		t.Fatalf("Execute() result error = %s", res.Error)
	}

	found := false
	for _, row := range res.Rows {
		if row["field"] == "name" && row["value"] == "John" {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("HGETALL rows = %v; want row {field:name, value:John}", res.Rows)
	}
}

func TestRedisExecuteList(t *testing.T) {
	drv, _ := newConnectedRedis(t)
	ctx := context.Background()

	if _, err := drv.Execute(ctx, "LPUSH mylist a b c"); err != nil {
		t.Fatalf("LPUSH error = %v", err)
	}
	res, err := drv.Execute(ctx, "LRANGE mylist 0 -1")
	if err != nil {
		t.Fatalf("Execute() error = %v", err)
	}
	if res.Error != "" {
		t.Fatalf("Execute() result error = %s", res.Error)
	}
	if res.RowCount != 3 {
		t.Errorf("RowCount = %d; want 3", res.RowCount)
	}
	for _, row := range res.Rows {
		if _, ok := row["value"]; !ok {
			t.Errorf("LRANGE row missing 'value' key: %v", row)
		}
	}
}

func TestRedisExecuteMulti(t *testing.T) {
	drv, _ := newConnectedRedis(t)
	ctx := context.Background()

	res, err := drv.Execute(ctx, "SET k1 v1\nGET k1")
	if err != nil {
		t.Fatalf("Execute() error = %v", err)
	}
	if res.Error != "" {
		t.Fatalf("Execute() result error = %s", res.Error)
	}
	if res.RowCount != 2 {
		t.Errorf("RowCount = %d; want 2 (one from SET, one from GET)", res.RowCount)
	}
}

func TestRedisACL(t *testing.T) {
	s := miniredis.RunT(t)
	s.RequireAuth("secret")
	port, _ := strconv.Atoi(s.Port())

	drv := &RedisDriver{}
	err := drv.Connect(context.Background(), ConnectionConfig{
		Host:     s.Host(),
		Port:     port,
		Password: "secret",
	})
	if err != nil {
		t.Fatalf("Connect() with password error = %v", err)
	}
	if !drv.IsConnected() {
		t.Fatal("expected IsConnected() true after authenticated Connect")
	}

	wrongDrv := &RedisDriver{}
	err = wrongDrv.Connect(context.Background(), ConnectionConfig{
		Host:     s.Host(),
		Port:     port,
		Password: "wrongpassword",
	})
	if err == nil {
		t.Fatal("Connect() with wrong password should return error")
	}
}

func TestRedisMultiDB(t *testing.T) {
	drv, s := newConnectedRedis(t)
	ctx := context.Background()

	s.Set("db0key", "value0")

	dbs, err := drv.Databases(ctx)
	if err != nil {
		t.Fatalf("Databases() error = %v", err)
	}
	if len(dbs) != 16 {
		t.Fatalf("Databases() returned %d; want 16", len(dbs))
	}
	if dbs[0].Name != "0" {
		t.Fatalf("Databases()[0].Name = %q; want %q", dbs[0].Name, "0")
	}

	if err := drv.SwitchDatabase(ctx, "1"); err != nil {
		t.Fatalf("SwitchDatabase(1) error = %v", err)
	}

	if _, err := drv.Execute(ctx, "SET db1key value1"); err != nil {
		t.Fatalf("SET in db1 error = %v", err)
	}

	tables1, err := drv.TablesInDB(ctx, "1")
	if err != nil {
		t.Fatalf("TablesInDB(1) error = %v", err)
	}
	if !slices.ContainsFunc(tables1, func(ti TableInfo) bool { return ti.Name == "db1key" }) {
		t.Errorf("TablesInDB(1) missing db1key; got %v", tables1)
	}

	tables0, err := drv.TablesInDB(ctx, "0")
	if err != nil {
		t.Fatalf("TablesInDB(0) error = %v", err)
	}
	if !slices.ContainsFunc(tables0, func(ti TableInfo) bool { return ti.Name == "db0key" }) {
		t.Errorf("TablesInDB(0) missing db0key; got %v", tables0)
	}

	if slices.ContainsFunc(tables0, func(ti TableInfo) bool { return ti.Name == "db1key" }) {
		t.Errorf("TablesInDB(0) should not contain db1key; got %v", tables0)
	}

	if err := drv.SwitchDatabase(ctx, "16"); err == nil {
		t.Fatal("SwitchDatabase(16) should return error")
	}

	if err := drv.SwitchDatabase(ctx, "abc"); err == nil {
		t.Fatal("SwitchDatabase(abc) should return error")
	}

	cols, err := drv.ColumnsInDB(ctx, "0", "db0key")
	if err != nil {
		t.Fatalf("ColumnsInDB(0, db0key) error = %v", err)
	}
	if len(cols) != 4 {
		t.Fatalf("ColumnsInDB returned %d columns; want 4", len(cols))
	}
}
