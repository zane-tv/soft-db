package services

import (
	"context"
	"fmt"
	"strings"
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

type StructureChangeRequest struct {
	Database     string              `json:"database,omitempty"`
	Mode         string              `json:"mode"`
	ConfirmApply bool                `json:"confirmApply,omitempty"`
	CreateTable  *CreateTableRequest `json:"createTable,omitempty"`
	AlterTable   *AlterTableRequest  `json:"alterTable,omitempty"`
}

type CreateTableRequest struct {
	Table   string                      `json:"table"`
	Columns []StructureColumnDefinition `json:"columns"`
}

type AlterTableRequest struct {
	Table      string                     `json:"table"`
	Operations []StructureChangeOperation `json:"operations"`
}

type StructureColumnDefinition struct {
	Name         string `json:"name"`
	Type         string `json:"type"`
	PrimaryKey   bool   `json:"primaryKey"`
	NotNull      bool   `json:"notNull"`
	Unique       bool   `json:"unique"`
	DefaultValue string `json:"defaultValue,omitempty"`
}

type StructureChangeOperation struct {
	Kind                   string                           `json:"kind"`
	AddColumn              *AddColumnOperation              `json:"addColumn,omitempty"`
	RenameColumn           *RenameColumnOperation           `json:"renameColumn,omitempty"`
	AlterColumnType        *AlterColumnTypeOperation        `json:"alterColumnType,omitempty"`
	AlterColumnDefault     *AlterColumnDefaultOperation     `json:"alterColumnDefault,omitempty"`
	AlterColumnNullability *AlterColumnNullabilityOperation `json:"alterColumnNullability,omitempty"`
	DropColumn             *DropColumnOperation             `json:"dropColumn,omitempty"`
}

type AddColumnOperation struct {
	Column StructureColumnDefinition `json:"column"`
}

type RenameColumnOperation struct {
	Column  string `json:"column"`
	NewName string `json:"newName"`
}

type AlterColumnTypeOperation struct {
	Column  string `json:"column"`
	NewType string `json:"newType"`
}

type AlterColumnDefaultOperation struct {
	Column       string `json:"column"`
	HasDefault   bool   `json:"hasDefault"`
	DefaultValue string `json:"defaultValue,omitempty"`
}

type AlterColumnNullabilityOperation struct {
	Column  string `json:"column"`
	NotNull bool   `json:"notNull"`
}

type DropColumnOperation struct {
	Column string `json:"column"`
}

type StructureChangeWarning struct {
	Code              string `json:"code"`
	Message           string `json:"message"`
	Severity          string `json:"severity"`
	OperationKind     string `json:"operationKind,omitempty"`
	Column            string `json:"column,omitempty"`
	Destructive       bool   `json:"destructive"`
	Blocking          bool   `json:"blocking"`
	CapabilityRelated bool   `json:"capabilityRelated"`
}

type StructureChangePreviewResult struct {
	DatabaseType          string                           `json:"databaseType"`
	Statements            []string                         `json:"statements"`
	Warnings              []StructureChangeWarning         `json:"warnings"`
	CapabilityNotes       []driver.StructureCapabilityNote `json:"capabilityNotes,omitempty"`
	Supported             bool                             `json:"supported"`
	HasDestructiveChanges bool                             `json:"hasDestructiveChanges"`
	RequiresConfirmation  bool                             `json:"requiresConfirmation"`
	Error                 string                           `json:"error,omitempty"`
}

type StructureChangeApplyResult struct {
	DatabaseType          string                           `json:"databaseType"`
	PlannedStatements     []string                         `json:"plannedStatements"`
	ExecutedStatements    []string                         `json:"executedStatements"`
	Warnings              []StructureChangeWarning         `json:"warnings"`
	CapabilityNotes       []driver.StructureCapabilityNote `json:"capabilityNotes,omitempty"`
	Supported             bool                             `json:"supported"`
	Success               bool                             `json:"success"`
	Blocked               bool                             `json:"blocked"`
	HasDestructiveChanges bool                             `json:"hasDestructiveChanges"`
	RequiresConfirmation  bool                             `json:"requiresConfirmation"`
	FailedStatement       string                           `json:"failedStatement,omitempty"`
	Error                 string                           `json:"error,omitempty"`
}

type structureChangePlan struct {
	DatabaseType          driver.DatabaseType
	Statements            []string
	Warnings              []StructureChangeWarning
	CapabilityNotes       []driver.StructureCapabilityNote
	Supported             bool
	HasDestructiveChanges bool
	RequiresConfirmation  bool
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

// GetTableIndexes returns indexes for a table. The database param is forwarded to the
// driver (schema name for PostgreSQL, database name for MySQL, ignored for SQLite).
// Returns an empty slice when the driver does not support index introspection.
func (s *SchemaService) GetTableIndexes(connectionID, database, table string) ([]driver.IndexInfo, error) {
	drv, err := s.connService.GetDriver(connectionID)
	if err != nil {
		return nil, err
	}
	intro, ok := drv.(driver.IndexIntrospector)
	if !ok {
		return []driver.IndexInfo{}, nil
	}
	return intro.GetIndexes(database, table)
}

// GetTableForeignKeys returns foreign key constraints for a table. The database param is
// forwarded to the driver. Returns an empty slice when not supported.
func (s *SchemaService) GetTableForeignKeys(connectionID, database, table string) ([]driver.ForeignKeyInfo, error) {
	drv, err := s.connService.GetDriver(connectionID)
	if err != nil {
		return nil, err
	}
	intro, ok := drv.(driver.ForeignKeyIntrospector)
	if !ok {
		return []driver.ForeignKeyInfo{}, nil
	}
	return intro.GetForeignKeys(database, table)
}

// GetDatabaseSchemas returns named schemas within the connected database (e.g. PostgreSQL
// schemas). Returns an empty slice when the driver does not support schema enumeration.
func (s *SchemaService) GetDatabaseSchemas(connectionID, database string) ([]string, error) {
	drv, err := s.connService.GetDriver(connectionID)
	if err != nil {
		return nil, err
	}
	intro, ok := drv.(driver.SchemaIntrospector)
	if !ok {
		return []string{}, nil
	}
	return intro.GetSchemas(database)
}

func (s *SchemaService) DropTable(connectionID string, table string) error {
	drv, err := s.connService.GetDriver(connectionID)
	if err != nil {
		return err
	}

	if drv.Type() == driver.Redis {
		return fmt.Errorf("drop table is not supported for Redis connections")
	}

	dbType := drv.Type()
	ddl := GenerateDropTableDDL(dbType, table)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	_, err = drv.Execute(ctx, ddl)
	return err
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

func (s *SchemaService) GetStructureChangeCapabilities(connectionID string) (*driver.StructureChangeCapabilities, error) {
	drv, err := s.connService.GetDriver(connectionID)
	if err != nil {
		return nil, err
	}

	capabilityDriver, ok := drv.(driver.StructureChangeCapabilityDriver)
	if !ok {
		return nil, fmt.Errorf("driver does not expose structure change capabilities")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	return capabilityDriver.GetStructureChangeCapabilities(ctx)
}

func (s *SchemaService) PreviewStructureChange(connectionID string, req StructureChangeRequest) (*StructureChangePreviewResult, error) {
	drv, err := s.connService.GetDriver(connectionID)
	if err != nil {
		return nil, err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	plan, err := s.planStructureChange(ctx, drv, req)
	if err != nil {
		return nil, err
	}

	return &StructureChangePreviewResult{
		DatabaseType:          string(plan.DatabaseType),
		Statements:            plan.Statements,
		Warnings:              plan.Warnings,
		CapabilityNotes:       plan.CapabilityNotes,
		Supported:             plan.Supported,
		HasDestructiveChanges: plan.HasDestructiveChanges,
		RequiresConfirmation:  plan.RequiresConfirmation,
	}, nil
}

func (s *SchemaService) ApplyStructureChange(connectionID string, req StructureChangeRequest) (*StructureChangeApplyResult, error) {
	drv, err := s.connService.GetDriver(connectionID)
	if err != nil {
		return nil, err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := s.switchStructureChangeDatabase(ctx, drv, req.Database); err != nil {
		return nil, err
	}

	plan, err := s.planStructureChange(ctx, drv, req)
	if err != nil {
		return nil, err
	}

	result := &StructureChangeApplyResult{
		DatabaseType:          string(plan.DatabaseType),
		PlannedStatements:     append([]string(nil), plan.Statements...),
		ExecutedStatements:    make([]string, 0, len(plan.Statements)),
		Warnings:              plan.Warnings,
		CapabilityNotes:       plan.CapabilityNotes,
		Supported:             plan.Supported,
		HasDestructiveChanges: plan.HasDestructiveChanges,
		RequiresConfirmation:  plan.RequiresConfirmation,
	}

	if hasBlockingStructureWarnings(plan.Warnings) {
		result.Blocked = true
		result.Error = "structure change plan contains blocking warnings"
		return result, nil
	}

	if plan.RequiresConfirmation && !req.ConfirmApply {
		result.Blocked = true
		result.Error = "structure change confirmation required"
		return result, nil
	}

	for _, statement := range plan.Statements {
		queryResult, execErr := drv.Execute(ctx, statement)
		if execErr != nil {
			result.FailedStatement = statement
			result.Error = execErr.Error()
			return result, nil
		}
		if queryResult != nil && queryResult.Error != "" {
			result.FailedStatement = statement
			result.Error = queryResult.Error
			return result, nil
		}
		result.ExecutedStatements = append(result.ExecutedStatements, statement)
	}

	result.Success = true
	return result, nil
}

func (s *SchemaService) planStructureChange(ctx context.Context, drv driver.Driver, req StructureChangeRequest) (*structureChangePlan, error) {
	capabilities, err := s.getStructureChangeCapabilities(ctx, drv)
	if err != nil {
		return nil, err
	}

	plan := &structureChangePlan{
		DatabaseType:    drv.Type(),
		Statements:      []string{},
		Warnings:        []StructureChangeWarning{},
		CapabilityNotes: dedupeCapabilityNotes(capabilities.GeneralNotes),
		Supported:       true,
	}

	switch strings.TrimSpace(req.Mode) {
	case "createTable":
		s.planCreateTableChange(plan, capabilities, req.CreateTable)
	case "alterTable":
		if err := s.planAlterTableChange(ctx, drv, plan, capabilities, req.Database, req.AlterTable); err != nil {
			return nil, err
		}
	default:
		appendBlockingStructureWarning(plan, "invalid_mode", fmt.Sprintf("unsupported structure change mode %q", req.Mode), "", "")
	}

	plan.CapabilityNotes = dedupeCapabilityNotes(plan.CapabilityNotes)
	plan.HasDestructiveChanges = hasDestructiveStructureWarnings(plan.Warnings)
	plan.RequiresConfirmation = requiresStructureConfirmation(plan.Warnings)
	plan.Supported = !hasBlockingStructureWarnings(plan.Warnings)

	if len(plan.Statements) > 1 && engineHasLimitedDDLTransactions(plan.DatabaseType) {
		appendStructureWarning(plan, StructureChangeWarning{
			Code:              "non_transactional_multi_statement",
			Message:           fmt.Sprintf("%s may leave partial DDL changes applied when one statement in an ordered plan fails", plan.DatabaseType),
			Severity:          "warning",
			Destructive:       false,
			Blocking:          false,
			CapabilityRelated: true,
		})
		plan.CapabilityNotes = appendCapabilityNotes(plan.CapabilityNotes, driver.StructureCapabilityNote{
			Code:     "non_transactional_multi_statement",
			Message:  fmt.Sprintf("%s does not provide reliable rollback guarantees for multi-statement DDL plans", plan.DatabaseType),
			Severity: "warning",
		})
		plan.RequiresConfirmation = true
	}

	return plan, nil
}

func (s *SchemaService) planCreateTableChange(plan *structureChangePlan, capabilities *driver.StructureChangeCapabilities, req *CreateTableRequest) {
	plan.CapabilityNotes = appendCapabilityNotes(plan.CapabilityNotes, capabilities.CreateTable.Notes...)
	if req == nil {
		appendBlockingStructureWarning(plan, "invalid_request", "createTable payload is required for createTable mode", "", "")
		return
	}
	if !capabilities.CreateTable.Supported {
		appendUnsupportedStructureWarning(plan, "createTable", "")
		return
	}

	tableName := strings.TrimSpace(req.Table)
	if tableName == "" {
		appendBlockingStructureWarning(plan, "invalid_request", "table name is required for createTable mode", "createTable", "")
		return
	}
	if len(req.Columns) == 0 {
		appendBlockingStructureWarning(plan, "invalid_request", "at least one column is required to create a table", "createTable", "")
		return
	}

	columnNames := make(map[string]struct{}, len(req.Columns))
	primaryKeyCount := 0
	definitions := make([]string, 0, len(req.Columns))
	for _, column := range req.Columns {
		columnName := strings.TrimSpace(column.Name)
		if columnName == "" {
			appendBlockingStructureWarning(plan, "invalid_column", "column name is required", "createTable", "")
			continue
		}
		key := strings.ToLower(columnName)
		if _, exists := columnNames[key]; exists {
			appendBlockingStructureWarning(plan, "duplicate_column", fmt.Sprintf("column %q is defined more than once", columnName), "createTable", columnName)
			continue
		}
		columnNames[key] = struct{}{}
		if column.PrimaryKey {
			primaryKeyCount++
		}
		definition, err := buildCreateColumnDefinition(plan.DatabaseType, column)
		if err != nil {
			appendBlockingStructureWarning(plan, "invalid_column", err.Error(), "createTable", columnName)
			continue
		}
		definitions = append(definitions, definition)
	}

	if primaryKeyCount > 1 {
		appendBlockingStructureWarning(plan, "unsupported_primary_key", "composite primary keys are out of scope for the structure designer v1", "createTable", "")
	}
	if hasBlockingStructureWarnings(plan.Warnings) {
		return
	}

	statement := fmt.Sprintf("CREATE TABLE %s (\n  %s\n)", quoteIdent(tableName, plan.DatabaseType), strings.Join(definitions, ",\n  "))
	plan.Statements = append(plan.Statements, statement)
	if capabilities.CreateTable.RequiresConfirmation {
		appendStructureWarning(plan, StructureChangeWarning{
			Code:              "create_table_confirmation",
			Message:           fmt.Sprintf("%s create-table changes should be reviewed before apply", plan.DatabaseType),
			Severity:          "warning",
			OperationKind:     "createTable",
			Destructive:       false,
			Blocking:          false,
			CapabilityRelated: true,
		})
	}
}

func (s *SchemaService) planAlterTableChange(ctx context.Context, drv driver.Driver, plan *structureChangePlan, capabilities *driver.StructureChangeCapabilities, database string, req *AlterTableRequest) error {
	plan.CapabilityNotes = appendCapabilityNotes(plan.CapabilityNotes, capabilities.GeneralNotes...)
	if req == nil {
		appendBlockingStructureWarning(plan, "invalid_request", "alterTable payload is required for alterTable mode", "", "")
		return nil
	}

	tableName := strings.TrimSpace(req.Table)
	if tableName == "" {
		appendBlockingStructureWarning(plan, "invalid_request", "table name is required for alterTable mode", "alterTable", "")
		return nil
	}
	if len(req.Operations) == 0 {
		appendBlockingStructureWarning(plan, "invalid_request", "at least one alterTable operation is required", "alterTable", "")
		return nil
	}

	columns, err := s.getStructureColumns(ctx, drv, database, tableName)
	if err != nil {
		return fmt.Errorf("load columns for %s: %w", tableName, err)
	}
	columnsByName := make(map[string]driver.ColumnInfo, len(columns))
	for _, column := range columns {
		columnsByName[strings.ToLower(column.Name)] = column
	}

	for _, operation := range req.Operations {
		s.planAlterOperation(plan, capabilities, tableName, columnsByName, operation)
	}

	return nil
}

func (s *SchemaService) planAlterOperation(plan *structureChangePlan, capabilities *driver.StructureChangeCapabilities, tableName string, columnsByName map[string]driver.ColumnInfo, operation StructureChangeOperation) {
	operationKind := strings.TrimSpace(operation.Kind)
	if operationKind == "" {
		appendBlockingStructureWarning(plan, "invalid_operation", "operation kind is required", "", "")
		return
	}

	switch operationKind {
	case "addColumn":
		plan.CapabilityNotes = appendCapabilityNotes(plan.CapabilityNotes, capabilities.AddColumn.Notes...)
		if operation.AddColumn == nil {
			appendBlockingStructureWarning(plan, "invalid_operation", "addColumn payload is required", operationKind, "")
			return
		}
		column := operation.AddColumn.Column
		columnName := strings.TrimSpace(column.Name)
		if !capabilities.AddColumn.Supported {
			appendUnsupportedStructureWarning(plan, operationKind, columnName)
			return
		}
		if columnName == "" {
			appendBlockingStructureWarning(plan, "invalid_column", "column name is required for addColumn", operationKind, "")
			return
		}
		if _, exists := columnsByName[strings.ToLower(columnName)]; exists {
			appendBlockingStructureWarning(plan, "duplicate_column", fmt.Sprintf("column %q already exists", columnName), operationKind, columnName)
			return
		}
		if column.PrimaryKey {
			appendBlockingStructureWarning(plan, "unsupported_primary_key", "adding a primary key column is not supported in v1", operationKind, columnName)
			return
		}
		if plan.DatabaseType == driver.SQLite && (column.Unique || (column.NotNull && strings.TrimSpace(column.DefaultValue) == "")) {
			appendUnsupportedStructureWarning(plan, operationKind, columnName)
			return
		}
		definition, err := buildAddColumnDefinition(plan.DatabaseType, column)
		if err != nil {
			appendBlockingStructureWarning(plan, "invalid_column", err.Error(), operationKind, columnName)
			return
		}
		statement := fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s", quoteIdent(tableName, plan.DatabaseType), definition)
		plan.Statements = append(plan.Statements, statement)
		columnsByName[strings.ToLower(columnName)] = driver.ColumnInfo{
			Name:         columnName,
			Type:         strings.TrimSpace(column.Type),
			Nullable:     !column.NotNull,
			PrimaryKey:   column.PrimaryKey,
			Unique:       column.Unique || column.PrimaryKey,
			DefaultValue: strings.TrimSpace(column.DefaultValue),
		}
	case "renameColumn":
		plan.CapabilityNotes = appendCapabilityNotes(plan.CapabilityNotes, capabilities.RenameColumn.Notes...)
		if operation.RenameColumn == nil {
			appendBlockingStructureWarning(plan, "invalid_operation", "renameColumn payload is required", operationKind, "")
			return
		}
		columnName := strings.TrimSpace(operation.RenameColumn.Column)
		newName := strings.TrimSpace(operation.RenameColumn.NewName)
		if !capabilities.RenameColumn.Supported {
			appendUnsupportedStructureWarning(plan, operationKind, columnName)
			return
		}
		if columnName == "" || newName == "" {
			appendBlockingStructureWarning(plan, "invalid_column", "renameColumn requires both current and new column names", operationKind, columnName)
			return
		}
		if _, ok := columnsByName[strings.ToLower(columnName)]; !ok {
			appendBlockingStructureWarning(plan, "unknown_column", fmt.Sprintf("column %q does not exist", columnName), operationKind, columnName)
			return
		}
		if _, exists := columnsByName[strings.ToLower(newName)]; exists {
			appendBlockingStructureWarning(plan, "duplicate_column", fmt.Sprintf("column %q already exists", newName), operationKind, newName)
			return
		}
		statement := fmt.Sprintf("ALTER TABLE %s RENAME COLUMN %s TO %s", quoteIdent(tableName, plan.DatabaseType), quoteIdent(columnName, plan.DatabaseType), quoteIdent(newName, plan.DatabaseType))
		plan.Statements = append(plan.Statements, statement)
		current := columnsByName[strings.ToLower(columnName)]
		delete(columnsByName, strings.ToLower(columnName))
		current.Name = newName
		columnsByName[strings.ToLower(newName)] = current
	case "alterColumnType":
		plan.CapabilityNotes = appendCapabilityNotes(plan.CapabilityNotes, capabilities.AlterColumnType.Notes...)
		if operation.AlterColumnType == nil {
			appendBlockingStructureWarning(plan, "invalid_operation", "alterColumnType payload is required", operationKind, "")
			return
		}
		columnName := strings.TrimSpace(operation.AlterColumnType.Column)
		newType := strings.TrimSpace(operation.AlterColumnType.NewType)
		if !capabilities.AlterColumnType.Supported {
			appendUnsupportedStructureWarning(plan, operationKind, columnName)
			return
		}
		current, ok := columnsByName[strings.ToLower(columnName)]
		if !ok {
			appendBlockingStructureWarning(plan, "unknown_column", fmt.Sprintf("column %q does not exist", columnName), operationKind, columnName)
			return
		}
		if newType == "" {
			appendBlockingStructureWarning(plan, "invalid_column", "newType is required for alterColumnType", operationKind, columnName)
			return
		}
		appendStructureWarning(plan, StructureChangeWarning{
			Code:          "risky_type_change",
			Message:       fmt.Sprintf("changing column %q from %s to %s may fail or rewrite data", columnName, current.Type, newType),
			Severity:      "warning",
			OperationKind: operationKind,
			Column:        columnName,
			Destructive:   false,
			Blocking:      false,
		})
		statement, err := buildAlterColumnTypeStatement(plan.DatabaseType, tableName, current, newType)
		if err != nil {
			appendBlockingStructureWarning(plan, "unsupported_operation", err.Error(), operationKind, columnName)
			return
		}
		plan.Statements = append(plan.Statements, statement)
		current.Type = newType
		columnsByName[strings.ToLower(columnName)] = current
	case "alterColumnDefault":
		plan.CapabilityNotes = appendCapabilityNotes(plan.CapabilityNotes, capabilities.AlterColumnDefault.Notes...)
		if operation.AlterColumnDefault == nil {
			appendBlockingStructureWarning(plan, "invalid_operation", "alterColumnDefault payload is required", operationKind, "")
			return
		}
		columnName := strings.TrimSpace(operation.AlterColumnDefault.Column)
		if !capabilities.AlterColumnDefault.Supported {
			appendUnsupportedStructureWarning(plan, operationKind, columnName)
			return
		}
		current, ok := columnsByName[strings.ToLower(columnName)]
		if !ok {
			appendBlockingStructureWarning(plan, "unknown_column", fmt.Sprintf("column %q does not exist", columnName), operationKind, columnName)
			return
		}
		statement, err := buildAlterColumnDefaultStatement(plan.DatabaseType, tableName, current, *operation.AlterColumnDefault)
		if err != nil {
			appendBlockingStructureWarning(plan, "unsupported_operation", err.Error(), operationKind, columnName)
			return
		}
		plan.Statements = append(plan.Statements, statement)
		if operation.AlterColumnDefault.HasDefault {
			current.DefaultValue = strings.TrimSpace(operation.AlterColumnDefault.DefaultValue)
		} else {
			current.DefaultValue = ""
		}
		columnsByName[strings.ToLower(columnName)] = current
	case "alterColumnNullability":
		plan.CapabilityNotes = appendCapabilityNotes(plan.CapabilityNotes, capabilities.AlterColumnNullability.Notes...)
		if operation.AlterColumnNullability == nil {
			appendBlockingStructureWarning(plan, "invalid_operation", "alterColumnNullability payload is required", operationKind, "")
			return
		}
		columnName := strings.TrimSpace(operation.AlterColumnNullability.Column)
		if !capabilities.AlterColumnNullability.Supported {
			appendUnsupportedStructureWarning(plan, operationKind, columnName)
			return
		}
		current, ok := columnsByName[strings.ToLower(columnName)]
		if !ok {
			appendBlockingStructureWarning(plan, "unknown_column", fmt.Sprintf("column %q does not exist", columnName), operationKind, columnName)
			return
		}
		if operation.AlterColumnNullability.NotNull {
			appendStructureWarning(plan, StructureChangeWarning{
				Code:          "set_not_null",
				Message:       fmt.Sprintf("setting column %q to NOT NULL can fail if existing rows contain NULL values", columnName),
				Severity:      "warning",
				OperationKind: operationKind,
				Column:        columnName,
				Destructive:   false,
				Blocking:      false,
			})
		}
		statement, err := buildAlterColumnNullabilityStatement(plan.DatabaseType, tableName, current, operation.AlterColumnNullability.NotNull)
		if err != nil {
			appendBlockingStructureWarning(plan, "unsupported_operation", err.Error(), operationKind, columnName)
			return
		}
		plan.Statements = append(plan.Statements, statement)
		current.Nullable = !operation.AlterColumnNullability.NotNull
		columnsByName[strings.ToLower(columnName)] = current
	case "dropColumn":
		plan.CapabilityNotes = appendCapabilityNotes(plan.CapabilityNotes, capabilities.DropColumn.Notes...)
		if operation.DropColumn == nil {
			appendBlockingStructureWarning(plan, "invalid_operation", "dropColumn payload is required", operationKind, "")
			return
		}
		columnName := strings.TrimSpace(operation.DropColumn.Column)
		if !capabilities.DropColumn.Supported {
			appendUnsupportedStructureWarning(plan, operationKind, columnName)
			return
		}
		if _, ok := columnsByName[strings.ToLower(columnName)]; !ok {
			appendBlockingStructureWarning(plan, "unknown_column", fmt.Sprintf("column %q does not exist", columnName), operationKind, columnName)
			return
		}
		appendStructureWarning(plan, StructureChangeWarning{
			Code:          "drop_column",
			Message:       fmt.Sprintf("dropping column %q permanently removes the column and its data", columnName),
			Severity:      "warning",
			OperationKind: operationKind,
			Column:        columnName,
			Destructive:   true,
			Blocking:      false,
		})
		statement := fmt.Sprintf("ALTER TABLE %s DROP COLUMN %s", quoteIdent(tableName, plan.DatabaseType), quoteIdent(columnName, plan.DatabaseType))
		plan.Statements = append(plan.Statements, statement)
		delete(columnsByName, strings.ToLower(columnName))
	default:
		appendBlockingStructureWarning(plan, "unsupported_operation", fmt.Sprintf("operation kind %q is not supported", operationKind), operationKind, "")
	}
}

func (s *SchemaService) getStructureChangeCapabilities(ctx context.Context, drv driver.Driver) (*driver.StructureChangeCapabilities, error) {
	capabilityDriver, ok := drv.(driver.StructureChangeCapabilityDriver)
	if !ok {
		return nil, fmt.Errorf("driver does not expose structure change capabilities")
	}
	return capabilityDriver.GetStructureChangeCapabilities(ctx)
}

func (s *SchemaService) getStructureColumns(ctx context.Context, drv driver.Driver, database string, table string) ([]driver.ColumnInfo, error) {
	if strings.TrimSpace(database) == "" {
		return drv.Columns(ctx, table)
	}
	if multiDB, ok := drv.(driver.MultiDatabaseDriver); ok {
		return multiDB.ColumnsInDB(ctx, database, table)
	}
	return drv.Columns(ctx, table)
}

func (s *SchemaService) switchStructureChangeDatabase(ctx context.Context, drv driver.Driver, database string) error {
	if strings.TrimSpace(database) == "" {
		return nil
	}
	multiDB, ok := drv.(driver.MultiDatabaseDriver)
	if !ok {
		return fmt.Errorf("driver does not support switching to database %q", database)
	}
	return multiDB.SwitchDatabase(ctx, database)
}

func buildCreateColumnDefinition(dbType driver.DatabaseType, column StructureColumnDefinition) (string, error) {
	columnName := strings.TrimSpace(column.Name)
	columnType := strings.TrimSpace(column.Type)
	if columnName == "" {
		return "", fmt.Errorf("column name is required")
	}
	if columnType == "" {
		return "", fmt.Errorf("column %q requires a type", columnName)
	}

	parts := []string{quoteIdent(columnName, dbType), columnType}
	if column.PrimaryKey {
		parts = append(parts, "PRIMARY KEY")
	}
	if column.NotNull {
		parts = append(parts, "NOT NULL")
	}
	if column.Unique && !column.PrimaryKey {
		parts = append(parts, "UNIQUE")
	}
	if defaultValue := strings.TrimSpace(column.DefaultValue); defaultValue != "" {
		parts = append(parts, "DEFAULT "+defaultValue)
	}

	return strings.Join(parts, " "), nil
}

func buildAddColumnDefinition(dbType driver.DatabaseType, column StructureColumnDefinition) (string, error) {
	return buildCreateColumnDefinition(dbType, column)
}

func buildAlterColumnTypeStatement(dbType driver.DatabaseType, tableName string, current driver.ColumnInfo, newType string) (string, error) {
	switch dbType {
	case driver.PostgreSQL, driver.Redshift:
		return fmt.Sprintf("ALTER TABLE %s ALTER COLUMN %s TYPE %s", quoteIdent(tableName, dbType), quoteIdent(current.Name, dbType), newType), nil
	case driver.MySQL, driver.MariaDB:
		definition := buildMySQLColumnDefinition(current.Name, newType, current.Nullable, current.DefaultValue, current.DefaultValue != "", current.Extra)
		return fmt.Sprintf("ALTER TABLE %s MODIFY COLUMN %s", quoteIdent(tableName, dbType), definition), nil
	default:
		return "", fmt.Errorf("changing column types is not supported for %s", dbType)
	}
}

func buildAlterColumnDefaultStatement(dbType driver.DatabaseType, tableName string, current driver.ColumnInfo, operation AlterColumnDefaultOperation) (string, error) {
	switch dbType {
	case driver.PostgreSQL, driver.Redshift:
		if operation.HasDefault {
			defaultValue := strings.TrimSpace(operation.DefaultValue)
			if defaultValue == "" {
				return "", fmt.Errorf("defaultValue is required when HasDefault is true")
			}
			return fmt.Sprintf("ALTER TABLE %s ALTER COLUMN %s SET DEFAULT %s", quoteIdent(tableName, dbType), quoteIdent(current.Name, dbType), defaultValue), nil
		}
		return fmt.Sprintf("ALTER TABLE %s ALTER COLUMN %s DROP DEFAULT", quoteIdent(tableName, dbType), quoteIdent(current.Name, dbType)), nil
	case driver.MySQL, driver.MariaDB:
		if operation.HasDefault {
			defaultValue := strings.TrimSpace(operation.DefaultValue)
			if defaultValue == "" {
				return "", fmt.Errorf("defaultValue is required when HasDefault is true")
			}
			return fmt.Sprintf("ALTER TABLE %s ALTER COLUMN %s SET DEFAULT %s", quoteIdent(tableName, dbType), quoteIdent(current.Name, dbType), defaultValue), nil
		}
		return fmt.Sprintf("ALTER TABLE %s ALTER COLUMN %s DROP DEFAULT", quoteIdent(tableName, dbType), quoteIdent(current.Name, dbType)), nil
	default:
		return "", fmt.Errorf("changing column defaults is not supported for %s", dbType)
	}
}

func buildAlterColumnNullabilityStatement(dbType driver.DatabaseType, tableName string, current driver.ColumnInfo, notNull bool) (string, error) {
	switch dbType {
	case driver.PostgreSQL:
		if notNull {
			return fmt.Sprintf("ALTER TABLE %s ALTER COLUMN %s SET NOT NULL", quoteIdent(tableName, dbType), quoteIdent(current.Name, dbType)), nil
		}
		return fmt.Sprintf("ALTER TABLE %s ALTER COLUMN %s DROP NOT NULL", quoteIdent(tableName, dbType), quoteIdent(current.Name, dbType)), nil
	case driver.MySQL, driver.MariaDB:
		definition := buildMySQLColumnDefinition(current.Name, current.Type, !notNull, current.DefaultValue, current.DefaultValue != "", current.Extra)
		return fmt.Sprintf("ALTER TABLE %s MODIFY COLUMN %s", quoteIdent(tableName, dbType), definition), nil
	default:
		return "", fmt.Errorf("changing column nullability is not supported for %s", dbType)
	}
}

func buildMySQLColumnDefinition(name string, columnType string, nullable bool, defaultValue string, hasDefault bool, extra string) string {
	parts := []string{quoteIdent(name, driver.MySQL), columnType}
	if nullable {
		parts = append(parts, "NULL")
	} else {
		parts = append(parts, "NOT NULL")
	}
	if hasDefault {
		parts = append(parts, "DEFAULT "+defaultValue)
	}
	if strings.TrimSpace(extra) != "" {
		parts = append(parts, extra)
	}
	return strings.Join(parts, " ")
}

func appendUnsupportedStructureWarning(plan *structureChangePlan, operationKind string, column string) {
	message := fmt.Sprintf("%s does not support %s in structure designer v1", plan.DatabaseType, operationKind)
	appendBlockingStructureWarning(plan, "unsupported_operation", message, operationKind, column)
}

func appendBlockingStructureWarning(plan *structureChangePlan, code string, message string, operationKind string, column string) {
	appendStructureWarning(plan, StructureChangeWarning{
		Code:              code,
		Message:           message,
		Severity:          "error",
		OperationKind:     operationKind,
		Column:            column,
		Destructive:       false,
		Blocking:          true,
		CapabilityRelated: code == "unsupported_operation",
	})
}

func appendStructureWarning(plan *structureChangePlan, warning StructureChangeWarning) {
	for _, existing := range plan.Warnings {
		if existing.Code == warning.Code && existing.OperationKind == warning.OperationKind && existing.Column == warning.Column && existing.Message == warning.Message {
			return
		}
	}
	plan.Warnings = append(plan.Warnings, warning)
}

func appendCapabilityNotes(existing []driver.StructureCapabilityNote, notes ...driver.StructureCapabilityNote) []driver.StructureCapabilityNote {
	return dedupeCapabilityNotes(append(existing, notes...))
}

func dedupeCapabilityNotes(notes []driver.StructureCapabilityNote) []driver.StructureCapabilityNote {
	if len(notes) == 0 {
		return []driver.StructureCapabilityNote{}
	}
	seen := make(map[string]struct{}, len(notes))
	result := make([]driver.StructureCapabilityNote, 0, len(notes))
	for _, note := range notes {
		key := note.Code + "\x00" + note.Severity + "\x00" + note.Message
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		result = append(result, note)
	}
	return result
}

func hasBlockingStructureWarnings(warnings []StructureChangeWarning) bool {
	for _, warning := range warnings {
		if warning.Blocking {
			return true
		}
	}
	return false
}

func hasDestructiveStructureWarnings(warnings []StructureChangeWarning) bool {
	for _, warning := range warnings {
		if warning.Destructive {
			return true
		}
	}
	return false
}

func requiresStructureConfirmation(warnings []StructureChangeWarning) bool {
	for _, warning := range warnings {
		if warning.Blocking {
			continue
		}
		if warning.Destructive || warning.Code == "risky_type_change" || warning.Code == "set_not_null" || warning.Code == "non_transactional_multi_statement" {
			return true
		}
	}
	return false
}

func engineHasLimitedDDLTransactions(dbType driver.DatabaseType) bool {
	switch dbType {
	case driver.MySQL, driver.MariaDB, driver.SQLite, driver.Redshift:
		return true
	default:
		return false
	}
}
