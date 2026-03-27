package services

import (
	"context"
	"fmt"
	"os"
	"strings"
	"sync"

	"soft-db/internal/driver"
	"soft-db/internal/store"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type ExportService struct {
	store    *store.Store
	conn     *ConnectionService
	settings *SettingsService
	app      *application.App
	mu       sync.Mutex
	cancelFn context.CancelFunc
}

func NewExportService(s *store.Store, conn *ConnectionService, settings *SettingsService) *ExportService {
	return &ExportService{
		store:    s,
		conn:     conn,
		settings: settings,
	}
}

func (s *ExportService) SetApp(app *application.App) {
	s.app = app
}

func (s *ExportService) emit(event string, payload interface{}) {
	if s.app != nil {
		s.app.Event.Emit(event, payload)
	}
}

// ExportWorkspaceToFile serialises the full workspace (connections, settings,
// snippets) to a JSON file at filePath. If passphrase is non-empty, connection
// passwords and URIs are encrypted in the output.
func (s *ExportService) ExportWorkspaceToFile(filePath string, passphrase string) error {
	connections, err := s.store.LoadConnections()
	if err != nil {
		return fmt.Errorf("load connections: %w", err)
	}

	appSettings, err := s.settings.GetSettings()
	if err != nil {
		return fmt.Errorf("load settings: %w", err)
	}

	snippets, err := s.store.ListSnippets("")
	if err != nil {
		return fmt.Errorf("load snippets: %w", err)
	}

	data, err := SerializeWorkspace(connections, &appSettings, snippets, passphrase)
	if err != nil {
		return fmt.Errorf("serialize workspace: %w", err)
	}

	if err := os.WriteFile(filePath, data, 0644); err != nil {
		return fmt.Errorf("write workspace file: %w", err)
	}

	s.emit("export:complete", ExportProgress{
		Phase:      "workspace",
		Current:    1,
		Total:      1,
		Percentage: 100,
		Message:    "Workspace exported successfully",
	})

	return nil
}

// ExportDatabase exports schema and/or data for the requested tables to a file.
// At most one export runs at a time; concurrent calls return an error immediately.
// Wails events emitted: "export:progress" per table, "export:complete" on success,
// "export:error" on failure (partial file is removed).
func (s *ExportService) ExportDatabase(req DatabaseExportRequest) error {
	if !s.mu.TryLock() {
		return fmt.Errorf("an export is already in progress")
	}
	defer s.mu.Unlock()

	ctx, cancel := context.WithCancel(context.Background())
	s.cancelFn = cancel
	defer func() {
		cancel()
		s.cancelFn = nil
	}()

	if err := s.runExport(ctx, req); err != nil {
		if req.FilePath != "" {
			_ = os.Remove(req.FilePath)
		}
		s.emit("export:error", map[string]string{"error": err.Error()})
		return err
	}

	s.emit("export:complete", ExportProgress{
		Phase:      "database",
		Current:    1,
		Total:      1,
		Percentage: 100,
		Message:    "Database exported successfully",
	})
	return nil
}

func (s *ExportService) runExport(ctx context.Context, req DatabaseExportRequest) error {
	drv, err := s.conn.GetDriver(req.ConnectionID)
	if err != nil {
		return fmt.Errorf("get driver: %w", err)
	}

	exportDrv, ok := drv.(driver.ExportableDriver)
	if !ok {
		return fmt.Errorf("driver for connection %q does not support export", req.ConnectionID)
	}

	dbType := driver.DatabaseType(s.conn.GetConnectionType(req.ConnectionID))
	isMongo := dbType == driver.MongoDB

	tables, err := s.resolveTables(ctx, drv, req)
	if err != nil {
		return fmt.Errorf("resolve tables: %w", err)
	}

	file, err := os.Create(req.FilePath)
	if err != nil {
		return fmt.Errorf("create output file: %w", err)
	}
	defer file.Close()

	totalTables := int64(len(tables))

	if req.IncludeSchema {
		if err := ctx.Err(); err != nil {
			return err
		}

		if isMongo {
			schemaBytes, err := ExportMongoSchema(drv, req.DatabaseName, tables)
			if err != nil {
				return fmt.Errorf("export mongo schema: %w", err)
			}
			if _, err := file.Write(schemaBytes); err != nil {
				return fmt.Errorf("write mongo schema: %w", err)
			}
			if _, err := file.WriteString("\n"); err != nil {
				return fmt.Errorf("write newline after schema: %w", err)
			}
		} else {
			for i, table := range tables {
				if err := ctx.Err(); err != nil {
					return err
				}

				ddl, ddlErr := exportDrv.GetCreateTableDDL(table)
				if ddlErr != nil {
					cols, colErr := drv.Columns(ctx, table)
					if colErr != nil {
						return fmt.Errorf("get columns for %q: %w", table, colErr)
					}
					ddl = GenerateCreateTableDDL(dbType, table, cols, true)
				}

				if !strings.HasSuffix(strings.TrimSpace(ddl), ";") {
					ddl = strings.TrimSpace(ddl) + ";"
				}
				if _, err := file.WriteString(ddl + "\n\n"); err != nil {
					return fmt.Errorf("write DDL for %q: %w", table, err)
				}

				s.emit("export:progress", ExportProgress{
					Phase:      "schema",
					Current:    int64(i + 1),
					Total:      totalTables,
					Percentage: float64(i+1) / float64(totalTables) * 100,
					Message:    fmt.Sprintf("Exported schema: %s", table),
				})
			}
		}
	}

	if req.IncludeData {
		settings, _ := s.settings.GetSettings()
		delimiter := settings.CsvDelimiter

		for i, table := range tables {
			if err := ctx.Err(); err != nil {
				return err
			}

			tableIdx := int64(i)
			progressFn := func(current, total int64) {
				pct := float64(0)
				if total > 0 {
					pct = float64(current) / float64(total) * 100
				}
				s.emit("export:progress", ExportProgress{
					Phase:      "data",
					Current:    tableIdx*1000 + current,
					Total:      totalTables * 1000,
					Percentage: (float64(tableIdx)/float64(totalTables) + pct/100/float64(totalTables)) * 100,
					Message:    fmt.Sprintf("Exporting data: %s (%d / %d rows)", table, current, total),
				})
			}

			if isMongo {
				if err := ExportMongoData(exportDrv, req.DatabaseName, table, file, progressFn); err != nil {
					return fmt.Errorf("export mongo data for %q: %w", table, err)
				}
				if i < len(tables)-1 {
					if _, err := file.WriteString("\n"); err != nil {
						return err
					}
				}
			} else {
				if err := WriteChunkedExport(file, exportDrv, table, req.DataFormat, dbType, delimiter, progressFn); err != nil {
					return fmt.Errorf("export data for %q: %w", table, err)
				}
			}
		}
	}

	return nil
}

func (s *ExportService) resolveTables(ctx context.Context, drv driver.Driver, req DatabaseExportRequest) ([]string, error) {
	if len(req.Tables) > 0 {
		return req.Tables, nil
	}

	var tableInfos []driver.TableInfo
	var err error

	if req.DatabaseName != "" {
		if md, ok := drv.(driver.MultiDatabaseDriver); ok {
			tableInfos, err = md.TablesInDB(ctx, req.DatabaseName)
		} else {
			tableInfos, err = drv.Tables(ctx)
		}
	} else {
		tableInfos, err = drv.Tables(ctx)
	}

	if err != nil {
		return nil, err
	}

	names := make([]string, 0, len(tableInfos))
	for _, t := range tableInfos {
		names = append(names, t.Name)
	}
	return names, nil
}

// CancelExport cancels any in-progress database export.
func (s *ExportService) CancelExport() {
	s.mu.Lock()
	fn := s.cancelFn
	s.mu.Unlock()

	if fn != nil {
		fn()
	}
	s.emit("export:cancelled", map[string]string{"message": "Export cancelled"})
}
