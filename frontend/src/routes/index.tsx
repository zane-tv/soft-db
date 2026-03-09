import { createFileRoute } from '@tanstack/react-router'

// The index route is a no-op — RootLayout handles all view switching
export const Route = createFileRoute('/') ({
  component: () => null,
})
