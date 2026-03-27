package driver

import (
	"context"
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
