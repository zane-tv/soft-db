package main

import (
	"embed"
	_ "embed"
	"log"

	"soft-db/internal/store"
	"soft-db/services"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// Version is set at build time via -ldflags "-X main.Version=v1.2.0"
var Version = "dev"

//go:embed all:frontend/dist
var assets embed.FS

//go:embed build/appicon-256.png
var appIcon []byte

func main() {
	// Initialize local store
	appStore, err := store.New()
	if err != nil {
		log.Fatalf("Failed to initialize store: %v", err)
	}
	defer appStore.Close()

	// Create services
	settingsService := services.NewSettingsService(appStore)
	connService := services.NewConnectionService(appStore, settingsService)
	queryService := services.NewQueryService(connService, settingsService, appStore)
	schemaService := services.NewSchemaService(connService)
	compareService := services.NewCompareService(connService)
	editService := services.NewEditService(connService, queryService, settingsService, appStore)
	oauthService := services.NewOAuthService(appStore)
	aiService := services.NewAIService(oauthService, schemaService, connService, settingsService, appStore)
	updateService := services.NewUpdateService(Version)
	exportService := services.NewExportService(appStore, connService, settingsService)
	importService := services.NewImportService(appStore, connService, settingsService)
	mcpService := services.NewMCPService(connService, queryService, schemaService, settingsService, appStore)

	// Create Wails app
	app := application.New(application.Options{
		Name:        "SoftDB",
		Description: "Database Management Tool - MySQL, MariaDB, PostgreSQL, SQLite, MongoDB, Redshift",
		Services: []application.Service{
			application.NewService(connService),
			application.NewService(queryService),
			application.NewService(schemaService),
			application.NewService(compareService),
			application.NewService(settingsService),
			application.NewService(editService),
			application.NewService(oauthService),
			application.NewService(aiService),
			application.NewService(updateService),
			application.NewService(exportService),
			application.NewService(importService),
			application.NewService(mcpService),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
		Linux: application.LinuxOptions{
			ProgramName: "softdb",
		},
	})

	// Inject app reference for event emission
	oauthService.SetApp(app)
	aiService.SetApp(app)
	updateService.SetApp(app)
	exportService.SetApp(app)
	importService.SetApp(app)
	mcpService.SetApp(app)

	// Create main window
	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:            "SoftDB",
		Frameless:        true,
		Width:            1400,
		Height:           900,
		MinWidth:         1024,
		MinHeight:        700,
		BackgroundColour: application.NewRGB(24, 24, 27),
		URL:              "/",
		Mac: application.MacWindow{
			InvisibleTitleBarHeight: 40,
			Backdrop:                application.MacBackdropTranslucent,
			TitleBar:                application.MacTitleBarHiddenInset,
		},
		Linux: application.LinuxWindow{
			Icon: appIcon,
		},
	})

	// Auto-start MCP server if enabled in settings
	if settings, err := settingsService.GetSettings(); err == nil && settings.MCPEnabled {
		if err := mcpService.StartServer(); err != nil {
			log.Printf("MCP auto-start failed: %v", err)
		}
	}

	// Run
	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
