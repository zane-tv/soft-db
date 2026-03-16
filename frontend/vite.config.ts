import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import path from 'path'

const WAILS_BACKEND_PORT = 8080

export default defineConfig({
  plugins: [
    TanStackRouterVite({
      routesDirectory: './src/routes',
      generatedRouteTree: './src/routeTree.gen.ts',
    }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    hmr: {
      protocol: 'ws',
    },
    proxy: {
      // Proxy Wails runtime calls to Go backend (server mode)
      '/wails': {
        target: `http://localhost:${WAILS_BACKEND_PORT}`,
        changeOrigin: true,
        ws: true,
      },
      '/health': {
        target: `http://localhost:${WAILS_BACKEND_PORT}`,
        changeOrigin: true,
      },
    },
  },
})
