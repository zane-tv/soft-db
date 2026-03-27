package driver

import "testing"

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
