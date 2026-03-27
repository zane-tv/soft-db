package main

import (
	"fmt"
	"os"
)

func main() {
	// TODO: Initialize store: store.New()
	// TODO: Create services (settingsService, connService, queryService, schemaService)
	// TODO: Create MCPService: services.NewMCPService(connService, queryService, schemaService, settingsService, store)
	// TODO: Call mcpService.InitServer() to register all 8 tools
	// TODO: Run stdio transport: server.Run(ctx, &mcp.StdioTransport{})
	fmt.Fprintln(os.Stderr, "SoftDB MCP Server — stdio mode not yet implemented")
}
