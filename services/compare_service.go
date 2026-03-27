package services

import (
	"context"
	"fmt"
	"strings"
	"time"

	"soft-db/internal/driver"
)

// CompareService compares schemas between two database connections.
type CompareService struct {
	connService *ConnectionService
}

// NewCompareService creates a new CompareService.
func NewCompareService(cs *ConnectionService) *CompareService {
	return &CompareService{connService: cs}
}

// ─── Result types ───

// ColumnChange describes a single column difference within a modified table.
type ColumnChange struct {
	Name           string `json:"name"`
	ChangeKind     string `json:"changeKind"`
	SourceType     string `json:"sourceType,omitempty"`
	TargetType     string `json:"targetType,omitempty"`
	SourceNullable bool   `json:"sourceNullable,omitempty"`
	TargetNullable bool   `json:"targetNullable,omitempty"`
	SourceDefault  string `json:"sourceDefault,omitempty"`
	TargetDefault  string `json:"targetDefault,omitempty"`
}

// TableDiff describes the difference for a single table.
type TableDiff struct {
	TableName  string         `json:"tableName"`
	ChangeKind string         `json:"changeKind"`
	Columns    []ColumnChange `json:"columns"`
}

// SchemaDiff is the top-level comparison result returned by CompareSchemas.
type SchemaDiff struct {
	SourceConnID   string      `json:"sourceConnId"`
	TargetConnID   string      `json:"targetConnId"`
	SourceDB       string      `json:"sourceDb"`
	TargetDB       string      `json:"targetDb"`
	AddedTables    []TableDiff `json:"addedTables"`
	RemovedTables  []TableDiff `json:"removedTables"`
	ModifiedTables []TableDiff `json:"modifiedTables"`
	MigrationSQL   []string    `json:"migrationSQL"`
}

// CompareSchemas compares the schemas of two databases and returns a diff with migration SQL.
// conn1ID/db1 is the "source"; conn2ID/db2 is the "target".
// Migration SQL is generated to bring source into alignment with target.
func (s *CompareService) CompareSchemas(conn1ID, db1, conn2ID, db2 string) (SchemaDiff, error) {
	result := SchemaDiff{
		SourceConnID:   conn1ID,
		TargetConnID:   conn2ID,
		SourceDB:       db1,
		TargetDB:       db2,
		AddedTables:    []TableDiff{},
		RemovedTables:  []TableDiff{},
		ModifiedTables: []TableDiff{},
		MigrationSQL:   []string{},
	}

	sourceTables, err := s.fetchSchema(conn1ID, db1)
	if err != nil {
		return result, fmt.Errorf("source schema: %w", err)
	}

	targetTables, err := s.fetchSchema(conn2ID, db2)
	if err != nil {
		return result, fmt.Errorf("target schema: %w", err)
	}

	sourceDBType := s.getDBType(conn1ID)
	ddlType := s.getDBType(conn2ID)

	sourceMap := make(map[string][]driver.ColumnInfo, len(sourceTables))
	for tableName, cols := range sourceTables {
		sourceMap[strings.ToLower(tableName)] = cols
	}
	targetMap := make(map[string][]driver.ColumnInfo, len(targetTables))
	for tableName, cols := range targetTables {
		targetMap[strings.ToLower(tableName)] = cols
	}

	sourceNames := make(map[string]string)
	for n := range sourceTables {
		sourceNames[strings.ToLower(n)] = n
	}
	targetNames := make(map[string]string)
	for n := range targetTables {
		targetNames[strings.ToLower(n)] = n
	}

	for lowerName, targetCols := range targetMap {
		if _, exists := sourceMap[lowerName]; !exists {
			diff := TableDiff{
				TableName:  targetNames[lowerName],
				ChangeKind: "added",
				Columns:    []ColumnChange{},
			}
			result.AddedTables = append(result.AddedTables, diff)
			sql := GenerateCreateTableDDL(ddlType, targetNames[lowerName], targetCols, false)
			result.MigrationSQL = append(result.MigrationSQL, sql)
		}
	}

	for lowerName := range sourceMap {
		if _, exists := targetMap[lowerName]; !exists {
			diff := TableDiff{
				TableName:  sourceNames[lowerName],
				ChangeKind: "removed",
				Columns:    []ColumnChange{},
			}
			result.RemovedTables = append(result.RemovedTables, diff)
		}
	}

	for lowerName, sourceCols := range sourceMap {
		targetCols, exists := targetMap[lowerName]
		if !exists {
			continue
		}
		tableName := sourceNames[lowerName]
		colDiffs := compareColumns(sourceCols, targetCols)
		if len(colDiffs) == 0 {
			continue
		}
		diff := TableDiff{
			TableName:  tableName,
			ChangeKind: "modified",
			Columns:    colDiffs,
		}
		result.ModifiedTables = append(result.ModifiedTables, diff)

		for _, colDiff := range colDiffs {
			switch colDiff.ChangeKind {
			case "added":
				for _, tc := range targetCols {
					if strings.EqualFold(tc.Name, colDiff.Name) {
						definition, err := buildAddColumnDefinition(ddlType, StructureColumnDefinition{
							Name:         tc.Name,
							Type:         tc.Type,
							NotNull:      !tc.Nullable,
							DefaultValue: tc.DefaultValue,
							Unique:       tc.Unique,
						})
						if err == nil {
							stmt := fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s;",
								QuoteIdentifier(ddlType, tableName), definition)
							result.MigrationSQL = append(result.MigrationSQL, stmt)
						}
						break
					}
				}
			case "removed":
				stmt := fmt.Sprintf("ALTER TABLE %s DROP COLUMN %s;",
					QuoteIdentifier(ddlType, tableName),
					QuoteIdentifier(ddlType, colDiff.Name))
				result.MigrationSQL = append(result.MigrationSQL, stmt)
			case "modified":
				if colDiff.SourceType != colDiff.TargetType {
					var stmt string
					switch ddlType {
					case driver.PostgreSQL, driver.Redshift:
						stmt = fmt.Sprintf("ALTER TABLE %s ALTER COLUMN %s TYPE %s;",
							QuoteIdentifier(ddlType, tableName),
							QuoteIdentifier(ddlType, colDiff.Name),
							colDiff.TargetType)
					case driver.MySQL, driver.MariaDB:
						nullable := colDiff.TargetNullable
						def := buildMySQLColumnDefinition(colDiff.Name, colDiff.TargetType, nullable, colDiff.TargetDefault, colDiff.TargetDefault != "", "")
						stmt = fmt.Sprintf("ALTER TABLE %s MODIFY COLUMN %s;",
							QuoteIdentifier(ddlType, tableName), def)
					default:
						stmt = fmt.Sprintf("-- Cannot auto-alter column %s.%s type from %s to %s for %s",
							tableName, colDiff.Name, colDiff.SourceType, colDiff.TargetType, ddlType)
					}
					if stmt != "" {
						result.MigrationSQL = append(result.MigrationSQL, stmt)
					}
				}
				if colDiff.SourceNullable != colDiff.TargetNullable {
					var stmt string
					switch ddlType {
					case driver.PostgreSQL:
						if !colDiff.TargetNullable {
							stmt = fmt.Sprintf("ALTER TABLE %s ALTER COLUMN %s SET NOT NULL;",
								QuoteIdentifier(ddlType, tableName),
								QuoteIdentifier(ddlType, colDiff.Name))
						} else {
							stmt = fmt.Sprintf("ALTER TABLE %s ALTER COLUMN %s DROP NOT NULL;",
								QuoteIdentifier(ddlType, tableName),
								QuoteIdentifier(ddlType, colDiff.Name))
						}
					}
					if stmt != "" {
						result.MigrationSQL = append(result.MigrationSQL, stmt)
					}
				}
			}
		}
	}

	_ = sourceDBType
	return result, nil
}

// fetchSchema retrieves a map of tableName → []ColumnInfo for a connection/database.
func (s *CompareService) fetchSchema(connID, database string) (map[string][]driver.ColumnInfo, error) {
	drv, err := s.connService.GetDriver(connID)
	if err != nil {
		return nil, err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	var tables []driver.TableInfo
	var getColumns func(table string) ([]driver.ColumnInfo, error)

	if database != "" {
		multiDB, ok := drv.(driver.MultiDatabaseDriver)
		if !ok {
			return nil, fmt.Errorf("connection does not support multi-database browsing")
		}
		tables, err = multiDB.TablesInDB(ctx, database)
		if err != nil {
			return nil, err
		}
		getColumns = func(table string) ([]driver.ColumnInfo, error) {
			return multiDB.ColumnsInDB(ctx, database, table)
		}
	} else {
		tables, err = drv.Tables(ctx)
		if err != nil {
			return nil, err
		}
		getColumns = func(table string) ([]driver.ColumnInfo, error) {
			return drv.Columns(ctx, table)
		}
	}

	schema := make(map[string][]driver.ColumnInfo, len(tables))
	for _, t := range tables {
		if t.Type == "view" {
			continue
		}
		cols, err := getColumns(t.Name)
		if err != nil {
			return nil, fmt.Errorf("columns for %s: %w", t.Name, err)
		}
		schema[t.Name] = cols
	}
	return schema, nil
}

// getDBType returns the DatabaseType for a connection, defaulting to PostgreSQL.
func (s *CompareService) getDBType(connID string) driver.DatabaseType {
	drv, err := s.connService.GetDriver(connID)
	if err != nil {
		return driver.PostgreSQL
	}
	return drv.Type()
}

// compareColumns returns the list of column changes between source and target column sets.
func compareColumns(sourceCols, targetCols []driver.ColumnInfo) []ColumnChange {
	var diffs []ColumnChange

	sourceMap := make(map[string]driver.ColumnInfo, len(sourceCols))
	for _, c := range sourceCols {
		sourceMap[strings.ToLower(c.Name)] = c
	}
	targetMap := make(map[string]driver.ColumnInfo, len(targetCols))
	for _, c := range targetCols {
		targetMap[strings.ToLower(c.Name)] = c
	}

	for lk, tc := range targetMap {
		if _, exists := sourceMap[lk]; !exists {
			diffs = append(diffs, ColumnChange{
				Name:       tc.Name,
				ChangeKind: "added",
				TargetType: tc.Type,
			})
		}
	}

	for lk, sc := range sourceMap {
		if _, exists := targetMap[lk]; !exists {
			diffs = append(diffs, ColumnChange{
				Name:       sc.Name,
				ChangeKind: "removed",
				SourceType: sc.Type,
			})
		}
	}

	for lk, sc := range sourceMap {
		tc, exists := targetMap[lk]
		if !exists {
			continue
		}

		typeChanged := !strings.EqualFold(strings.TrimSpace(sc.Type), strings.TrimSpace(tc.Type))
		nullabilityChanged := sc.Nullable != tc.Nullable
		defaultChanged := strings.TrimSpace(sc.DefaultValue) != strings.TrimSpace(tc.DefaultValue)

		if typeChanged || nullabilityChanged || defaultChanged {
			diffs = append(diffs, ColumnChange{
				Name:           sc.Name,
				ChangeKind:     "modified",
				SourceType:     sc.Type,
				TargetType:     tc.Type,
				SourceNullable: sc.Nullable,
				TargetNullable: tc.Nullable,
				SourceDefault:  sc.DefaultValue,
				TargetDefault:  tc.DefaultValue,
			})
		}
	}

	return diffs
}
