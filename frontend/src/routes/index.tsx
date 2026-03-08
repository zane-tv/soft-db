import { createFileRoute } from '@tanstack/react-router'
import { ConnectionHub } from '@/pages/ConnectionHub'

export const Route = createFileRoute('/')({
  component: ConnectionHub,
})
