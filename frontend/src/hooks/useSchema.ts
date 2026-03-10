import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import * as SchemaService from '../../bindings/soft-db/services/schemaservice'
import * as QueryService from '../../bindings/soft-db/services/queryservice'

// ─── Schema Keys ───
export const schemaKeys = {
  all: (connId: string) => ['schema', connId] as const,
  tables: (connId: string) => [...schemaKeys.all(connId), 'tables'] as const,
  columns: (connId: string, table: string) => [...schemaKeys.all(connId), 'columns', table] as const,
  views: (connId: string) => [...schemaKeys.all(connId), 'views'] as const,
  functions: (connId: string) => [...schemaKeys.all(connId), 'functions'] as const,
}

export function useTables(connectionId: string) {
  return useQuery({
    queryKey: schemaKeys.tables(connectionId),
    queryFn: () => SchemaService.GetTables(connectionId),
    enabled: !!connectionId,
  })
}

export function useColumns(connectionId: string, table: string) {
  return useQuery({
    queryKey: schemaKeys.columns(connectionId, table),
    queryFn: () => SchemaService.GetColumns(connectionId, table),
    enabled: !!connectionId && !!table,
  })
}

export function useViews(connectionId: string) {
  return useQuery({
    queryKey: schemaKeys.views(connectionId),
    queryFn: () => SchemaService.GetViews(connectionId),
    enabled: !!connectionId,
  })
}

export function useFunctions(connectionId: string) {
  return useQuery({
    queryKey: schemaKeys.functions(connectionId),
    queryFn: () => SchemaService.GetFunctions(connectionId),
    enabled: !!connectionId,
  })
}

// ─── Query Execution ───
export function useExecuteQuery() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ connectionId, query }: { connectionId: string; query: string }) =>
      QueryService.ExecuteQuery(connectionId, query),
    onSettled: (_data, _err, { connectionId }) => {
      queryClient.refetchQueries({ queryKey: ['history', connectionId] })
    },
  })
}


export function useQueryHistory(connectionId: string, limit = 50) {
  return useQuery({
    queryKey: ['history', connectionId, limit] as const,
    queryFn: () => QueryService.GetHistory(connectionId, limit),
    enabled: !!connectionId,
    staleTime: 0,
  })
}

export function useSnippets(connectionId: string) {
  return useQuery({
    queryKey: ['snippets', connectionId] as const,
    queryFn: () => QueryService.ListSnippets(connectionId),
    enabled: !!connectionId,
  })
}

export function useSaveSnippet() {
  return useMutation({
    mutationFn: (snippet: Parameters<typeof QueryService.SaveSnippet>[0]) =>
      QueryService.SaveSnippet(snippet),
  })
}

export function useDeleteSnippet() {
  return useMutation({
    mutationFn: (id: number) => QueryService.DeleteSnippet(id),
  })
}
