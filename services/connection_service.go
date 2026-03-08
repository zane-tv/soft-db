package services

import (
	"context"
	"fmt"
	"sync"
	"time"

	"soft-db/internal/driver"
	"soft-db/internal/store"

	"github.com/google/uuid"
)

// ConnectionService manages database connections (bound to Wails frontend)
type ConnectionService struct {
	store   *store.Store
	drivers map[string]driver.Driver
	configs map[string]driver.ConnectionConfig
	mu      sync.RWMutex
}

// NewConnectionService creates the service with a store reference
func NewConnectionService(s *store.Store) *ConnectionService {
	return &ConnectionService{
		store:   s,
		drivers: make(map[string]driver.Driver),
		configs: make(map[string]driver.ConnectionConfig),
	}
}

// ListConnections returns all saved connections with current status
func (s *ConnectionService) ListConnections() ([]driver.ConnectionConfig, error) {
	conns, err := s.store.LoadConnections()
	if err != nil {
		return nil, err
	}

	s.mu.RLock()
	defer s.mu.RUnlock()

	for i, c := range conns {
		if drv, ok := s.drivers[c.ID]; ok && drv.IsConnected() {
			conns[i].Status = "connected"
		} else {
			conns[i].Status = "offline"
		}
	}
	return conns, nil
}

// SaveConnection creates or updates a connection config
func (s *ConnectionService) SaveConnection(cfg driver.ConnectionConfig) (driver.ConnectionConfig, error) {
	if cfg.ID == "" {
		cfg.ID = uuid.New().String()
	}
	cfg.Status = "offline"
	if err := s.store.SaveConnection(cfg); err != nil {
		return cfg, err
	}
	return cfg, nil
}

// DeleteConnection removes a connection (disconnects first if active)
func (s *ConnectionService) DeleteConnection(id string) error {
	s.mu.Lock()
	if drv, ok := s.drivers[id]; ok {
		drv.Disconnect(context.Background())
		delete(s.drivers, id)
		delete(s.configs, id)
	}
	s.mu.Unlock()
	return s.store.DeleteConnection(id)
}

// TestConnection attempts to connect and immediately disconnects
func (s *ConnectionService) TestConnection(cfg driver.ConnectionConfig) error {
	drv, err := driver.NewDriver(cfg.Type)
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := drv.Connect(ctx, cfg); err != nil {
		return err
	}
	defer drv.Disconnect(ctx)

	return drv.Ping(ctx)
}

// Connect establishes a live connection to a saved database
func (s *ConnectionService) Connect(id string) error {
	conns, err := s.store.LoadConnections()
	if err != nil {
		return err
	}

	var cfg driver.ConnectionConfig
	found := false
	for _, c := range conns {
		if c.ID == id {
			cfg = c
			found = true
			break
		}
	}
	if !found {
		return fmt.Errorf("connection not found: %s", id)
	}

	drv, err := driver.NewDriver(cfg.Type)
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	if err := drv.Connect(ctx, cfg); err != nil {
		return err
	}

	s.mu.Lock()
	// Close existing driver if any
	if old, ok := s.drivers[id]; ok {
		old.Disconnect(context.Background())
	}
	s.drivers[id] = drv
	s.configs[id] = cfg
	s.mu.Unlock()

	s.store.TouchConnection(id)
	return nil
}

// Disconnect closes an active connection
func (s *ConnectionService) Disconnect(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	drv, ok := s.drivers[id]
	if !ok {
		return nil
	}
	err := drv.Disconnect(context.Background())
	delete(s.drivers, id)
	delete(s.configs, id)
	return err
}

// GetDriver returns the active driver for a connection (internal use)
func (s *ConnectionService) GetDriver(id string) (driver.Driver, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	drv, ok := s.drivers[id]
	if !ok {
		return nil, fmt.Errorf("connection not active: %s", id)
	}
	return drv, nil
}
