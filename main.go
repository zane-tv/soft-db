package main

import (
	"embed"
	_ "embed"
	"log"

	"soft-db/internal/store"
	"soft-db/services"

	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	// Initialize local store
	appStore, err := store.New()
	if err != nil {
		log.Fatalf("Failed to initialize store: %v", err)
	}
	defer appStore.Close()

	// Create services
	connService := services.NewConnectionService(appStore)
	queryService := services.NewQueryService(connService, appStore)
	schemaService := services.NewSchemaService(connService)

	// Create Wails app
	app := application.New(application.Options{
		Name:        "SoftDB",
		Description: "Database Management Tool - MySQL, MariaDB, PostgreSQL, SQLite, MongoDB, Redshift",
		Services: []application.Service{
			application.NewService(connService),
			application.NewService(queryService),
			application.NewService(schemaService),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})

	// Create main window
	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:            "SoftDB",
		Width:            1400,
		Height:           900,
		MinWidth:         1024,
		MinHeight:        700,
		BackgroundColour: application.NewRGB(24, 24, 27),
		URL:              "/",
		Mac: application.MacWindow{
			InvisibleTitleBarHeight: 50,
			Backdrop:                application.MacBackdropTranslucent,
			TitleBar:                application.MacTitleBarHiddenInset,
		},
	})

	// Run
	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
