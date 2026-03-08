import { createFileRoute } from '@tanstack/react-router'
import { TableExplorer } from '@/pages/TableExplorer'

export const Route = createFileRoute('/explorer/$connectionId')({
  component: TableExplorer,
})
