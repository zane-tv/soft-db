import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import * as ConnectionService from '../../bindings/soft-db/services/connectionservice'
import { ConnectionConfig } from '../../bindings/soft-db/internal/driver/models'

export const connectionKeys = {
  all: ['connections'] as const,
  list: () => [...connectionKeys.all, 'list'] as const,
}

export function useConnections() {
  return useQuery({
    queryKey: connectionKeys.list(),
    queryFn: () => ConnectionService.ListConnections(),
    refetchInterval: 10_000, // poll every 10s for status updates
  })
}

export function useSaveConnection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (cfg: ConnectionConfig) => ConnectionService.SaveConnection(cfg),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: connectionKeys.list() })
    },
  })
}

export function useDeleteConnection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => ConnectionService.DeleteConnection(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: connectionKeys.list() })
    },
  })
}

export function useTestConnection() {
  return useMutation({
    mutationFn: (cfg: ConnectionConfig) => ConnectionService.TestConnection(cfg),
  })
}

export function useConnect() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => ConnectionService.Connect(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: connectionKeys.list() })
    },
  })
}

export function useDisconnect() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => ConnectionService.Disconnect(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: connectionKeys.list() })
    },
  })
}
