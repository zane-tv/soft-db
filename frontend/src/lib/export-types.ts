// Re-export Wails-generated types for export/import feature.
// Types that exist in generated bindings MUST be imported from there
// to avoid type incompatibility (Wails generates enums, not union types).

export {
  ConflictStrategy,
  DataExportFormat,
  DatabaseExportRequest,
  DatabaseImportRequest,
  WorkspaceImportResult,
} from '../../bindings/soft-db/services/models'

export type ExportMode = 'workspace' | 'schema' | 'data'

export interface ExportProgress {
  phase: string
  current: number
  total: number
  percentage: number
  message: string
}
