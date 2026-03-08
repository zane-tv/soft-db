import { createRootRoute, Outlet } from '@tanstack/react-router'
// Devtools only in development
// import { TanStackRouterDevtools } from '@tanstack/router-devtools'

export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  return (
    <div className="h-full flex flex-col overflow-hidden">
      <Outlet />
    </div>
  )
}
