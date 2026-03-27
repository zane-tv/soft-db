import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import * as SchemaService from '../../bindings/soft-db/services/schemaservice'
import * as QueryService from '../../bindings/soft-db/services/queryservice'
import { Call as WailsCall } from '@wailsio/runtime'
import type { Snippet, SnippetListFilter } from '../../bindings/soft-db/internal/store/models'

const PREVIEW_STRUCTURE_CHANGE_METHOD_ID = 1797572774
const APPLY_STRUCTURE_CHANGE_METHOD_ID = 474600782

export type StructureChangeMode = 'createTable' | 'alterTable'

export interface StructureColumnDefinition {
  name: string
  type: string
  primaryKey: boolean
  notNull: boolean
  unique: boolean
  defaultValue?: string
}

export interface AddColumnOperation {
  column: StructureColumnDefinition
}

export interface RenameColumnOperation {
  column: string
  newName: string
}

export interface AlterColumnTypeOperation {
  column: string
  newType: string
}

export interface AlterColumnDefaultOperation {
  column: string
  hasDefault: boolean
  defaultValue?: string
}

export interface AlterColumnNullabilityOperation {
  column: string
  notNull: boolean
}

export interface DropColumnOperation {
  column: string
}

export interface StructureChangeOperation {
  kind:
    | 'addColumn'
    | 'renameColumn'
    | 'alterColumnType'
    | 'alterColumnDefault'
    | 'alterColumnNullability'
    | 'dropColumn'
  addColumn?: AddColumnOperation
  renameColumn?: RenameColumnOperation
  alterColumnType?: AlterColumnTypeOperation
  alterColumnDefault?: AlterColumnDefaultOperation
  alterColumnNullability?: AlterColumnNullabilityOperation
  dropColumn?: DropColumnOperation
}

export interface CreateTableRequest {
  table: string
  columns: StructureColumnDefinition[]
}

export interface AlterTableRequest {
  table: string
  operations: StructureChangeOperation[]
}

export interface StructureChangeRequest {
  database?: string
  mode: StructureChangeMode
  confirmApply?: boolean
  createTable?: CreateTableRequest
  alterTable?: AlterTableRequest
}

export interface StructureChangeWarning {
  code: string
  message: string
  severity: string
  operationKind?: string
  column?: string
  destructive: boolean
  blocking: boolean
  capabilityRelated: boolean
}

export interface StructureCapabilityNote {
  code: string
  message: string
  severity: string
}

export interface StructureChangePreviewResult {
  databaseType: string
  statements: string[]
  warnings: StructureChangeWarning[]
  capabilityNotes: StructureCapabilityNote[]
  supported: boolean
  hasDestructiveChanges: boolean
  requiresConfirmation: boolean
  error?: string
}

export interface StructureChangeApplyResult {
  databaseType: string
  plannedStatements: string[]
  executedStatements: string[]
  warnings: StructureChangeWarning[]
  capabilityNotes: StructureCapabilityNote[]
  supported: boolean
  success: boolean
  blocked: boolean
  hasDestructiveChanges: boolean
  requiresConfirmation: boolean
  failedStatement?: string
  error?: string
}

function previewStructureChange(connectionId: string, request: StructureChangeRequest) {
  return WailsCall.ByID(PREVIEW_STRUCTURE_CHANGE_METHOD_ID, connectionId, request) as Promise<StructureChangePreviewResult>
}

function applyStructureChange(connectionId: string, request: StructureChangeRequest) {
  return WailsCall.ByID(APPLY_STRUCTURE_CHANGE_METHOD_ID, connectionId, request) as Promise<StructureChangeApplyResult>
}

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

export function useDropTable() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ connectionId, table }: { connectionId: string; table: string }) =>
      SchemaService.DropTable(connectionId, table),
    onSuccess: (_data, { connectionId }) => {
      queryClient.invalidateQueries({ queryKey: schemaKeys.all(connectionId) })
      queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'multidb' && q.queryKey[1] === connectionId })
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

export type SnippetScope = 'all' | 'global' | 'connection'

interface UseSnippetFilters {
  scope?: SnippetScope
  folderPath?: string
  tags?: string[]
}

interface SnippetMutationPayload {
  connectionId: string
  snippet: Snippet
}

function normalizeSnippetFilter(connectionId: string, filters?: UseSnippetFilters): SnippetListFilter {
  return {
    connectionId,
    scope: filters?.scope ?? 'all',
    folderPath: filters?.folderPath?.trim() ?? '',
    tags: filters?.tags ?? [],
  }
}

export function useSnippets(connectionId: string, filters?: UseSnippetFilters) {
  const normalizedFilter = normalizeSnippetFilter(connectionId, filters)
  const queryKey = [
    'snippets',
    connectionId,
    normalizedFilter.scope,
    normalizedFilter.folderPath,
    normalizedFilter.tags.join('|'),
  ] as const

  return useQuery({
    queryKey,
    queryFn: () => QueryService.ListSnippetsWithFilter(normalizedFilter),
    enabled: !!connectionId,
  })
}

export function useSaveSnippet() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ connectionId, snippet }: SnippetMutationPayload) =>
      snippet.id > 0
        ? QueryService.UpdateSnippet(connectionId, snippet)
        : QueryService.CreateSnippet(connectionId, snippet),
    onSuccess: (_data, { connectionId }) => {
      queryClient.invalidateQueries({ queryKey: ['snippets', connectionId] })
    },
  })
}

export function useMoveSnippet() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ connectionId, id, folderPath }: { connectionId: string; id: number; folderPath: string }) =>
      QueryService.MoveSnippet(connectionId, id, folderPath),
    onSuccess: (_data, { connectionId }) => {
      queryClient.invalidateQueries({ queryKey: ['snippets', connectionId] })
    },
  })
}

export function useDeleteSnippet() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, connectionId }: { id: number; connectionId: string }) =>
      QueryService.DeleteSnippetForConnection(connectionId, id),
    onSuccess: (_data, { connectionId }) => {
      queryClient.invalidateQueries({ queryKey: ['snippets', connectionId] })
    },
  })
}

export function usePreviewStructureChange() {
  return useMutation({
    mutationFn: ({
      connectionId,
      request,
    }: {
      connectionId: string
      request: StructureChangeRequest
    }) => previewStructureChange(connectionId, request),
  })
}

export function useApplyStructureChange() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      connectionId,
      request,
    }: {
      connectionId: string
      request: StructureChangeRequest
    }) => applyStructureChange(connectionId, request),
    onSuccess: (result, { connectionId, request }) => {
      if (!result.success) {
        return
      }

      queryClient.invalidateQueries({ queryKey: schemaKeys.all(connectionId) })
      queryClient.invalidateQueries({ queryKey: ['multidb', connectionId] })

      if (request.mode === 'alterTable' && request.alterTable?.table) {
        queryClient.invalidateQueries({
          queryKey: schemaKeys.columns(connectionId, request.alterTable.table),
        })
      }
      if (request.mode === 'createTable' && request.createTable?.table) {
        queryClient.invalidateQueries({
          queryKey: schemaKeys.columns(connectionId, request.createTable.table),
        })
      }
    },
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
