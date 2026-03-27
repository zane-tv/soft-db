package services

import (
	"testing"

	"soft-db/internal/driver"
)

func TestConnectionService_GetDriver_NotFound(t *testing.T) {
	t.Parallel()
	cs := newConnServiceWithDriver(t, "", nil)

	_, err := cs.GetDriver("missing-id")
	if err == nil {
		t.Fatal("expected error for missing connection")
	}
}

func TestConnectionService_GetDriver_Found(t *testing.T) {
	t.Parallel()
	drv := &mockDriver{dbType: driver.PostgreSQL, isConnected: true}
	cs := newConnServiceWithDriver(t, "conn-1", drv)

	got, err := cs.GetDriver("conn-1")
	if err != nil {
		t.Fatalf("GetDriver: %v", err)
	}
	if got != drv {
		t.Error("expected same mock driver instance")
	}
}

func TestConnectionService_GetConnectionType_Known(t *testing.T) {
	t.Parallel()
	drv := &mockDriver{dbType: driver.MySQL}
	cs := newConnServiceWithDriver(t, "conn-1", drv)

	if got := cs.GetConnectionType("conn-1"); got != "mysql" {
		t.Errorf("GetConnectionType = %q, want %q", got, "mysql")
	}
}

func TestConnectionService_GetConnectionType_Unknown(t *testing.T) {
	t.Parallel()
	cs := newConnServiceWithDriver(t, "", nil)

	if got := cs.GetConnectionType("nonexistent"); got != "" {
		t.Errorf("GetConnectionType = %q, want empty", got)
	}
}

func TestConnectionService_Disconnect_NotConnected(t *testing.T) {
	t.Parallel()
	cs := newConnServiceWithDriver(t, "", nil)

	if err := cs.Disconnect("not-connected"); err != nil {
		t.Errorf("Disconnect non-existent: %v", err)
	}
}

func TestConnectionService_Disconnect_Connected(t *testing.T) {
	t.Parallel()
	drv := &mockDriver{dbType: driver.PostgreSQL, isConnected: true}
	cs := newConnServiceWithDriver(t, "conn-1", drv)

	if err := cs.Disconnect("conn-1"); err != nil {
		t.Fatalf("Disconnect: %v", err)
	}

	if _, err := cs.GetDriver("conn-1"); err == nil {
		t.Error("expected error after disconnect")
	}

	cs.mu.RLock()
	disconnected := cs.disconnected["conn-1"]
	cs.mu.RUnlock()

	if !disconnected {
		t.Error("expected disconnected[conn-1] = true after Disconnect")
	}
}

func TestConnectionService_ListConnections_StatusIdle(t *testing.T) {
	t.Parallel()
	s := newTestStore(t)
	ss := NewSettingsService(newTestStore(t))
	cs := NewConnectionService(s, ss)

	cfg := driver.ConnectionConfig{
		ID:   "pg-1",
		Name: "test-pg",
		Type: driver.PostgreSQL,
		Host: "localhost",
		Port: 5432,
	}
	if _, err := cs.SaveConnection(cfg); err != nil {
		t.Fatalf("SaveConnection: %v", err)
	}

	conns, err := cs.ListConnections()
	if err != nil {
		t.Fatalf("ListConnections: %v", err)
	}
	if len(conns) != 1 {
		t.Fatalf("expected 1 connection, got %d", len(conns))
	}
	if conns[0].Status != "idle" {
		t.Errorf("status = %q, want %q", conns[0].Status, "idle")
	}
}

func TestConnectionService_ListConnections_StatusConnected(t *testing.T) {
	t.Parallel()
	s := newTestStore(t)
	ss := NewSettingsService(newTestStore(t))
	cs := NewConnectionService(s, ss)

	cfg := driver.ConnectionConfig{
		ID:   "pg-1",
		Name: "test-pg",
		Type: driver.PostgreSQL,
	}
	if _, err := cs.SaveConnection(cfg); err != nil {
		t.Fatalf("SaveConnection: %v", err)
	}

	drv := &mockDriver{dbType: driver.PostgreSQL, isConnected: true}
	cs.mu.Lock()
	cs.drivers["pg-1"] = drv
	cs.mu.Unlock()

	conns, err := cs.ListConnections()
	if err != nil {
		t.Fatalf("ListConnections: %v", err)
	}
	if conns[0].Status != "connected" {
		t.Errorf("status = %q, want %q", conns[0].Status, "connected")
	}
}

func TestConnectionService_ListConnections_StatusOffline(t *testing.T) {
	t.Parallel()
	s := newTestStore(t)
	ss := NewSettingsService(newTestStore(t))
	cs := NewConnectionService(s, ss)

	cfg := driver.ConnectionConfig{
		ID:   "pg-1",
		Name: "test-pg",
		Type: driver.PostgreSQL,
	}
	if _, err := cs.SaveConnection(cfg); err != nil {
		t.Fatalf("SaveConnection: %v", err)
	}

	cs.mu.Lock()
	cs.disconnected["pg-1"] = true
	cs.mu.Unlock()

	conns, err := cs.ListConnections()
	if err != nil {
		t.Fatalf("ListConnections: %v", err)
	}
	if conns[0].Status != "offline" {
		t.Errorf("status = %q, want %q", conns[0].Status, "offline")
	}
}

func TestConnectionService_SaveConnection_AssignsID(t *testing.T) {
	t.Parallel()
	s := newTestStore(t)
	ss := NewSettingsService(newTestStore(t))
	cs := NewConnectionService(s, ss)

	saved, err := cs.SaveConnection(driver.ConnectionConfig{Name: "no-id", Type: driver.MySQL})
	if err != nil {
		t.Fatalf("SaveConnection: %v", err)
	}
	if saved.ID == "" {
		t.Error("expected an ID to be assigned")
	}
}

func TestConnectionService_SaveConnection_PreservesID(t *testing.T) {
	t.Parallel()
	s := newTestStore(t)
	ss := NewSettingsService(newTestStore(t))
	cs := NewConnectionService(s, ss)

	saved, err := cs.SaveConnection(driver.ConnectionConfig{ID: "custom-id", Name: "named", Type: driver.MySQL})
	if err != nil {
		t.Fatalf("SaveConnection: %v", err)
	}
	if saved.ID != "custom-id" {
		t.Errorf("ID = %q, want %q", saved.ID, "custom-id")
	}
}

func TestConnectionService_DeleteConnection_RemovesActiveDriver(t *testing.T) {
	t.Parallel()
	drv := &mockDriver{dbType: driver.PostgreSQL, isConnected: true}
	cs := newConnServiceWithDriver(t, "conn-del", drv)

	if err := cs.DeleteConnection("conn-del"); err != nil {
		t.Fatalf("DeleteConnection: %v", err)
	}

	if _, err := cs.GetDriver("conn-del"); err == nil {
		t.Error("expected error after deleting connection")
	}
}

func TestConnectionService_Connect_NotFound(t *testing.T) {
	t.Parallel()
	s := newTestStore(t)
	ss := NewSettingsService(s)
	cs := NewConnectionService(s, ss)

	err := cs.Connect("does-not-exist")
	if err == nil {
		t.Fatal("expected error when connection not in store")
	}
}

func TestConnectionService_Connect_UnsupportedDriverType(t *testing.T) {
	t.Parallel()
	s := newTestStore(t)
	ss := NewSettingsService(s)
	cs := NewConnectionService(s, ss)

	cfg := driver.ConnectionConfig{
		ID:   "oracle-1",
		Name: "oracle-conn",
		Type: driver.DatabaseType("oracle"),
	}
	if _, err := cs.SaveConnection(cfg); err != nil {
		t.Fatalf("SaveConnection: %v", err)
	}

	err := cs.Connect("oracle-1")
	if err == nil {
		t.Fatal("expected error for unsupported driver type")
	}
}

func TestConnectionService_Disconnect_SetsDisconnectedFlag(t *testing.T) {
	t.Parallel()
	drv := &mockDriver{dbType: driver.MySQL, isConnected: true}
	cs := newConnServiceWithDriver(t, "conn-2", drv)

	cs.Disconnect("conn-2")

	cs.mu.RLock()
	flag := cs.disconnected["conn-2"]
	cs.mu.RUnlock()

	if !flag {
		t.Error("expected disconnected flag to be set after Disconnect")
	}
}

func TestConnectionService_TestConnection_UnsupportedType(t *testing.T) {
	t.Parallel()
	s := newTestStore(t)
	ss := NewSettingsService(s)
	cs := NewConnectionService(s, ss)

	err := cs.TestConnection(driver.ConnectionConfig{
		Type: driver.DatabaseType("oracle"),
		Host: "localhost",
		Port: 1521,
	})
	if err == nil {
		t.Fatal("expected error for unsupported driver type")
	}
}

func TestConnectionService_PingAll_EmptyStore(t *testing.T) {
	t.Parallel()
	s := newTestStore(t)
	ss := NewSettingsService(s)
	cs := NewConnectionService(s, ss)

	results := cs.PingAll()
	if len(results) != 0 {
		t.Errorf("expected empty results for empty store, got %d", len(results))
	}
}

func TestConnectionService_PingAll_UnsupportedDriver(t *testing.T) {
	t.Parallel()
	s := newTestStore(t)
	ss := NewSettingsService(s)
	cs := NewConnectionService(s, ss)

	if _, err := cs.SaveConnection(driver.ConnectionConfig{
		ID:   "bad-1",
		Name: "unsupported",
		Type: driver.DatabaseType("oracle"),
	}); err != nil {
		t.Fatalf("SaveConnection: %v", err)
	}

	results := cs.PingAll()
	if status, ok := results["bad-1"]; !ok || status != "offline" {
		t.Errorf("expected offline for unsupported driver, got %q (ok=%v)", status, ok)
	}
}
