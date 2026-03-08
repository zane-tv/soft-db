import React from 'react'
import ReactDOM from 'react-dom/client'
import { createRouter, createHashHistory, RouterProvider } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { routeTree } from './routeTree.gen'
import './app.css'

// Hash history for Wails desktop app
const hashHistory = createHashHistory()

// TanStack Router
const router = createRouter({
  routeTree,
  history: hashHistory,
})

// Type-safe router
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

// TanStack Query client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60, // 1 minute
      retry: 1,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
)
