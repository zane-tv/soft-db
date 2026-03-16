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
	store           *store.Store
	settingsService *SettingsService
	drivers         map[string]driver.Driver
	configs         map[string]driver.ConnectionConfig
	disconnected    map[string]bool // tracks explicitly disconnected connections
	mu              sync.RWMutex
}

// NewConnectionService creates the service with a store reference
func NewConnectionService(s *store.Store, ss *SettingsService) *ConnectionService {
	return &ConnectionService{
		store:           s,
		settingsService: ss,
		drivers:         make(map[string]driver.Driver),
		configs:         make(map[string]driver.ConnectionConfig),
		disconnected:    make(map[string]bool),
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
		} else if s.disconnected[c.ID] {
			// Explicitly disconnected or connection lost
			conns[i].Status = "offline"
		} else {
			conns[i].Status = "idle"
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

	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(s.settingsService.GetConnectionTimeout())*time.Second)
	defer cancel()

	if err := drv.Connect(ctx, cfg); err != nil {
		return err
	}
	defer drv.Disconnect(ctx)

	return drv.Ping(ctx)
}

// PingAll checks connectivity for all saved connections in parallel.
// Returns a map of connectionID → "online" | "offline".
func (s *ConnectionService) PingAll() map[string]string {
	conns, err := s.store.LoadConnections()
	if err != nil {
		return map[string]string{}
	}

	results := make(map[string]string, len(conns))
	var mu sync.Mutex
	var wg sync.WaitGroup

	for _, c := range conns {
		wg.Add(1)
		go func(cfg driver.ConnectionConfig) {
			defer wg.Done()

			status := "online"
			drv, err := driver.NewDriver(cfg.Type)
			if err != nil {
				status = "offline"
			} else {
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()

				if err := drv.Connect(ctx, cfg); err != nil {
					status = "offline"
				} else {
					if err := drv.Ping(ctx); err != nil {
						status = "offline"
					}
					drv.Disconnect(ctx)
				}
			}

			mu.Lock()
			results[cfg.ID] = status
			if status == "offline" {
				s.mu.Lock()
				s.disconnected[cfg.ID] = true
				s.mu.Unlock()
			} else {
				s.mu.Lock()
				delete(s.disconnected, cfg.ID)
				s.mu.Unlock()
			}
			mu.Unlock()
		}(c)
	}

	wg.Wait()
	return results
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

	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(s.settingsService.GetConnectionTimeout())*time.Second)
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
	delete(s.disconnected, id)
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
	s.disconnected[id] = true
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

// GetConnectionType returns the database type for a connection (e.g. "mongodb", "sqlite")
func (s *ConnectionService) GetConnectionType(id string) string {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if cfg, ok := s.configs[id]; ok {
		return string(cfg.Type)
	}
	return ""
}
