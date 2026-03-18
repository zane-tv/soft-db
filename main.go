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
	editService := services.NewEditService(connService, queryService, settingsService, appStore)
	oauthService := services.NewOAuthService(appStore)
	aiService := services.NewAIService(oauthService, schemaService, connService, appStore)
	updateService := services.NewUpdateService(Version)

	// Create Wails app
	app := application.New(application.Options{
		Name:        "SoftDB",
		Description: "Database Management Tool - MySQL, MariaDB, PostgreSQL, SQLite, MongoDB, Redshift",
		Services: []application.Service{
			application.NewService(connService),
			application.NewService(queryService),
			application.NewService(schemaService),
			application.NewService(settingsService),
			application.NewService(editService),
			application.NewService(oauthService),
			application.NewService(aiService),
			application.NewService(updateService),
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

	// Run
	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
