package services

import (
	"context"
	"fmt"
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

// ─── Multi-Database Methods ───

// HasMultiDB checks if the connection's driver supports multi-database browsing
func (s *SchemaService) HasMultiDB(connectionID string) bool {
	drv, err := s.connService.GetDriver(connectionID)
	if err != nil {
		return false
	}
	_, ok := drv.(driver.MultiDatabaseDriver)
	return ok
}

// GetDatabases returns all databases for a multi-DB connection
func (s *SchemaService) GetDatabases(connectionID string) ([]driver.DatabaseInfo, error) {
	drv, err := s.connService.GetDriver(connectionID)
	if err != nil {
		return nil, err
	}

	multiDB, ok := drv.(driver.MultiDatabaseDriver)
	if !ok {
		return nil, fmt.Errorf("driver does not support multi-database browsing")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	return multiDB.Databases(ctx)
}

// GetTablesForDB returns tables for a specific database
func (s *SchemaService) GetTablesForDB(connectionID string, database string) ([]driver.TableInfo, error) {
	drv, err := s.connService.GetDriver(connectionID)
	if err != nil {
		return nil, err
	}

	multiDB, ok := drv.(driver.MultiDatabaseDriver)
	if !ok {
		return nil, fmt.Errorf("driver does not support multi-database browsing")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	return multiDB.TablesInDB(ctx, database)
}

// GetColumnsForDB returns columns for a table in a specific database
func (s *SchemaService) GetColumnsForDB(connectionID string, database string, table string) ([]driver.ColumnInfo, error) {
	drv, err := s.connService.GetDriver(connectionID)
	if err != nil {
		return nil, err
	}

	multiDB, ok := drv.(driver.MultiDatabaseDriver)
	if !ok {
		return nil, fmt.Errorf("driver does not support multi-database browsing")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	return multiDB.ColumnsInDB(ctx, database, table)
}

// SwitchDatabase changes the active database for a connection
func (s *SchemaService) SwitchDatabase(connectionID string, database string) error {
	drv, err := s.connService.GetDriver(connectionID)
	if err != nil {
		return err
	}

	multiDB, ok := drv.(driver.MultiDatabaseDriver)
	if !ok {
		return fmt.Errorf("driver does not support multi-database switching")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	return multiDB.SwitchDatabase(ctx, database)
}

// ─── MongoDB Schema Validation ───

// GetMongoValidator retrieves the JSON Schema validator for a MongoDB collection
func (s *SchemaService) GetMongoValidator(connectionID string, database string, collection string) (map[string]interface{}, error) {
	drv, err := s.connService.GetDriver(connectionID)
	if err != nil {
		return nil, err
	}

	svd, ok := drv.(driver.SchemaValidationDriver)
	if !ok {
		return nil, fmt.Errorf("driver does not support schema validation")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	return svd.GetCollectionValidator(ctx, database, collection)
}

// SetMongoValidator applies a JSON Schema validator to a MongoDB collection
func (s *SchemaService) SetMongoValidator(connectionID string, database string, collection string, schema map[string]interface{}) error {
	drv, err := s.connService.GetDriver(connectionID)
	if err != nil {
		return err
	}

	svd, ok := drv.(driver.SchemaValidationDriver)
	if !ok {
		return fmt.Errorf("driver does not support schema validation")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	return svd.SetCollectionValidator(ctx, database, collection, schema)
}
