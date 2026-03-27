package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	"soft-db/internal/store"
	"soft-db/services"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func main() {
	appStore, err := store.New()
	if err != nil {
		log.Fatalf("failed to initialize store: %v", err)
	}
	defer appStore.Close()

	settingsService := services.NewSettingsService(appStore)
	connService := services.NewConnectionService(appStore, settingsService)
	queryService := services.NewQueryService(connService, settingsService, appStore)
	schemaService := services.NewSchemaService(connService)

	mcpService := services.NewMCPService(connService, queryService, schemaService, settingsService, appStore)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigCh
		cancel()
	}()

	if err := mcpService.GetMCPServer().Run(ctx, &mcp.StdioTransport{}); err != nil && err != context.Canceled {
		log.Fatalf("MCP server error: %v", err)
	}
}
