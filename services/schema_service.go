package services

import (
	"context"
	"time"

	"soft-db/internal/driver"
)

// SchemaService handles schema introspection and DDL (bound to Wails frontend)
type SchemaService struct {
	connService *ConnectionService
}

// NewSchemaService creates the service
func NewSchemaService(cs *ConnectionService) *SchemaService {
	return &SchemaService{connService: cs}
}

// GetTables returns all tables for a connection
func (s *SchemaService) GetTables(connectionID string) ([]driver.TableInfo, error) {
	drv, err := s.connService.GetDriver(connectionID)
	if err != nil {
		return nil, err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	return drv.Tables(ctx)
}

// GetColumns returns columns for a table
func (s *SchemaService) GetColumns(connectionID string, table string) ([]driver.ColumnInfo, error) {
	drv, err := s.connService.GetDriver(connectionID)
	if err != nil {
		return nil, err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	return drv.Columns(ctx, table)
}

// GetViews returns views for a connection
func (s *SchemaService) GetViews(connectionID string) ([]string, error) {
	drv, err := s.connService.GetDriver(connectionID)
	if err != nil {
		return nil, err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	return drv.Views(ctx)
}

// GetFunctions returns functions for a connection
func (s *SchemaService) GetFunctions(connectionID string) ([]driver.FunctionInfo, error) {
	drv, err := s.connService.GetDriver(connectionID)
	if err != nil {
		return nil, err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	return drv.Functions(ctx)
}
