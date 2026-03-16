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

// ─── Multi-Database Schema ───
export const multiDbKeys = {
  hasMultiDB: (connId: string) => ['multidb', connId, 'has'] as const,
  databases: (connId: string) => ['multidb', connId, 'databases'] as const,
  tablesForDB: (connId: string, db: string) => ['multidb', connId, 'tables', db] as const,
}

export function useHasMultiDB(connectionId: string) {
  return useQuery({
    queryKey: multiDbKeys.hasMultiDB(connectionId),
    queryFn: () => SchemaService.HasMultiDB(connectionId),
    enabled: !!connectionId,
    staleTime: Infinity,
  })
}

export function useDatabases(connectionId: string) {
  return useQuery({
    queryKey: multiDbKeys.databases(connectionId),
    queryFn: () => SchemaService.GetDatabases(connectionId),
    enabled: !!connectionId,
  })
}

export function useTablesForDB(connectionId: string, database: string) {
  return useQuery({
    queryKey: multiDbKeys.tablesForDB(connectionId, database),
    queryFn: () => SchemaService.GetTablesForDB(connectionId, database),
    enabled: !!connectionId && !!database,
  })
}

export function useSwitchDatabase() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ connectionId, database }: { connectionId: string; database: string }) =>
      SchemaService.SwitchDatabase(connectionId, database),
    onSuccess: (_data, { connectionId }) => {
      // Invalidate table/column caches for this connection
      queryClient.invalidateQueries({ queryKey: schemaKeys.all(connectionId) })
    },
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
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (snippet: Parameters<typeof QueryService.SaveSnippet>[0]) =>
      QueryService.SaveSnippet(snippet),
    onSuccess: (_data, snippet) => {
      queryClient.invalidateQueries({ queryKey: ['snippets', snippet.connectionId] })
    },
  })
}

export function useDeleteSnippet() {
  return useMutation({
    mutationFn: (id: number) => QueryService.DeleteSnippet(id),
  })
}

// ─── MongoDB Schema Validation ───

export const mongoValidatorKeys = {
  validator: (connId: string, db: string, collection: string) =>
    ['mongoValidator', connId, db, collection] as const,
}

export function useMongoValidator(connectionId: string, database: string, collection: string) {
  return useQuery({
    queryKey: mongoValidatorKeys.validator(connectionId, database, collection),
    queryFn: () => SchemaService.GetMongoValidator(connectionId, database, collection),
    enabled: !!connectionId && !!database && !!collection,
  })
}

export function useSetMongoValidator() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      connectionId,
      database,
      collection,
      schema,
    }: {
      connectionId: string
      database: string
      collection: string
      schema: Record<string, unknown>
    }) => SchemaService.SetMongoValidator(connectionId, database, collection, schema),
    onSuccess: (_data, { connectionId, database, collection }) => {
      queryClient.invalidateQueries({
        queryKey: mongoValidatorKeys.validator(connectionId, database, collection),
      })
    },
  })
}
