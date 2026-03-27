package services

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"strings"
	"sync"

	"soft-db/internal/driver"
	"soft-db/internal/store"

	"github.com/google/uuid"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type ImportService struct {
	store    *store.Store
	conn     *ConnectionService
	settings *SettingsService
	app      *application.App
	mu       sync.Mutex
	cancelFn context.CancelFunc
}

func NewImportService(s *store.Store, conn *ConnectionService, settings *SettingsService) *ImportService {
	return &ImportService{
		store:    s,
		conn:     conn,
		settings: settings,
	}
}

func (s *ImportService) SetApp(app *application.App) {
	s.app = app
}

func (s *ImportService) emit(event string, data interface{}) {
	if s.app != nil {
		s.app.Event.Emit(event, data)
	}
}

func (s *ImportService) emitProgress(phase string, current, total int64) {
	pct := float64(0)
	if total > 0 {
		pct = float64(current) / float64(total) * 100
	}
	s.emit("import:progress", ExportProgress{
		Phase:      phase,
		Current:    current,
		Total:      total,
		Percentage: pct,
		Message:    fmt.Sprintf("%s: %d/%d", phase, current, total),
	})
}

func (s *ImportService) ImportWorkspaceFromFile(filePath string, passphrase string, connectionStrategy ConflictStrategy) (*WorkspaceImportResult, error) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("read file: %w", err)
	}

	export, err := DeserializeWorkspace(data, passphrase)
	if err != nil {
		return nil, err
	}

	existing, err := s.store.LoadConnections()
	if err != nil {
		return nil, fmt.Errorf("load existing connections: %w", err)
	}

	existingByName := make(map[string]driver.ConnectionConfig, len(existing))
	for _, c := range existing {
		existingByName[c.Name] = c
	}

	result := &WorkspaceImportResult{}

	for _, ce := range export.Connections {
		conflict, hasConflict := existingByName[ce.Name]

		switch {
		case hasConflict && connectionStrategy == ConflictSkip:
			result.ConnectionsSkipped++
			continue

		case hasConflict && connectionStrategy == ConflictReplace:
			if err := s.store.DeleteConnection(conflict.ID); err != nil {
				return nil, fmt.Errorf("delete connection %q for replace: %w", ce.Name, err)
			}

		case hasConflict && connectionStrategy == ConflictRename:
			ce.Name = ce.Name + " (imported)"
		}

		cfg := connectionExportToConfig(ce)
		if err := s.store.SaveConnection(cfg); err != nil {
			return nil, fmt.Errorf("save connection %q: %w", ce.Name, err)
		}
		result.ConnectionsImported++
	}

	if export.Settings != nil {
		if err := s.settings.UpdateSettings(*export.Settings); err != nil {
			return nil, fmt.Errorf("save settings: %w", err)
		}
		result.SettingsImported = true
	}

	if len(export.Snippets) > 0 {
		existingSnippets, err := s.store.ListSnippets("")
		if err != nil {
			return nil, fmt.Errorf("load existing snippets: %w", err)
		}
		existingTitles := make(map[string]bool, len(existingSnippets))
		for _, sn := range existingSnippets {
			existingTitles[sn.Title] = true
		}

		for _, sn := range export.Snippets {
			if existingTitles[sn.Title] {
				continue
			}
			if err := s.store.SaveSnippet(store.Snippet{
				Title:     sn.Title,
				QueryText: sn.Content,
				Tags:      sn.Tags,
			}); err != nil {
				return nil, fmt.Errorf("save snippet %q: %w", sn.Title, err)
			}
			result.SnippetsImported++
		}
	}

	s.emit("import:complete", result)
	return result, nil
}

func connectionExportToConfig(ce ConnectionExport) driver.ConnectionConfig {
	return driver.ConnectionConfig{
		ID:       uuid.New().String(),
		Name:     ce.Name,
		Type:     driver.DatabaseType(ce.Type),
		Host:     ce.Host,
		Port:     ce.Port,
		Database: ce.Database,
		Username: ce.Username,
		Password: ce.Password,
		FilePath: ce.FilePath,
		URI:      ce.URI,
		SSLMode:  ce.SSLMode,
	}
}

func (s *ImportService) ImportDatabase(req DatabaseImportRequest) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	ctx, cancel := context.WithCancel(context.Background())
	s.cancelFn = cancel
	defer cancel()

	drv, err := s.conn.GetDriver(req.ConnectionID)
	if err != nil {
		return fmt.Errorf("get driver: %w", err)
	}

	fileData, err := os.ReadFile(req.FilePath)
	if err != nil {
		return fmt.Errorf("read file: %w", err)
	}

	lower := strings.ToLower(req.FilePath)
	isMongo := strings.HasSuffix(lower, ".json") || drv.Type() == driver.MongoDB

	if isMongo {
		return s.importMongoDatabase(ctx, drv, req, fileData)
	}
	return s.importSQLDatabase(ctx, drv, req, fileData)
}

func (s *ImportService) importSQLDatabase(ctx context.Context, drv driver.Driver, req DatabaseImportRequest, data []byte) error {
	statements := splitSQLStatements(string(data))

	var ddl []string
	var dml []string

	for _, stmt := range statements {
		trimmed := strings.TrimSpace(stmt)
		if trimmed == "" {
			continue
		}
		upper := strings.ToUpper(trimmed)
		if strings.HasPrefix(upper, "CREATE") || strings.HasPrefix(upper, "DROP") ||
			strings.HasPrefix(upper, "ALTER") || strings.HasPrefix(upper, "TRUNCATE") {
			ddl = append(ddl, stmt)
		} else {
			dml = append(dml, stmt)
		}
	}

	total := int64(len(ddl) + len(dml))
	var current int64

	for _, stmt := range ddl {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if _, err := drv.Execute(ctx, stmt); err != nil {
			return fmt.Errorf("execute DDL: %w", err)
		}
		current++
		s.emitProgress("ddl", current, total)
	}

	for _, stmt := range dml {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if _, err := drv.Execute(ctx, stmt); err != nil {
			return fmt.Errorf("execute DML: %w", err)
		}
		current++
		if current%100 == 0 {
			s.emitProgress("data", current, total)
		}
	}

	s.emit("import:complete", map[string]interface{}{
		"phase":   "done",
		"current": current,
		"total":   total,
	})

	_ = req
	return nil
}

func (s *ImportService) importMongoDatabase(ctx context.Context, drv driver.Driver, req DatabaseImportRequest, data []byte) error {
	_ = ctx

	if req.SchemaStrategy != "" {
		if err := ImportMongoSchema(drv, req.DatabaseName, data, req.SchemaStrategy); err != nil {
			return fmt.Errorf("import mongo schema: %w", err)
		}
	}

	reader := bytes.NewReader(data)
	if err := ImportMongoData(drv, req.DatabaseName, req.DatabaseName, reader, req.DataStrategy); err != nil {
		return fmt.Errorf("import mongo data: %w", err)
	}

	s.emit("import:complete", map[string]interface{}{"phase": "done"})
	return nil
}

func splitSQLStatements(content string) []string {
	var statements []string
	var current strings.Builder
	inString := false
	stringChar := byte(0)

	for i := 0; i < len(content); i++ {
		ch := content[i]
		if inString {
			current.WriteByte(ch)
			if ch == stringChar && (i == 0 || content[i-1] != '\\') {
				inString = false
			}
		} else if ch == '\'' || ch == '"' || ch == '`' {
			inString = true
			stringChar = ch
			current.WriteByte(ch)
		} else if ch == ';' {
			stmt := strings.TrimSpace(current.String())
			if stmt != "" {
				statements = append(statements, stmt)
			}
			current.Reset()
		} else if ch == '-' && i+1 < len(content) && content[i+1] == '-' {
			for i < len(content) && content[i] != '\n' {
				i++
			}
		} else {
			current.WriteByte(ch)
		}
	}

	if remaining := strings.TrimSpace(current.String()); remaining != "" {
		statements = append(statements, remaining)
	}

	return statements
}
