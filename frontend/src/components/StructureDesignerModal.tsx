import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { MongoSchemaEditor } from './MongoSchemaEditor'
import { ConfirmModal } from './ConfirmModal'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  useApplyStructureChange,
  useColumns,
  usePreviewStructureChange,
  type StructureChangePreviewResult,
  type StructureChangeRequest,
  type StructureChangeOperation,
  type StructureColumnDefinition,
} from '@/hooks/useSchema'
import type { ColumnInfo } from '../../bindings/soft-db/internal/driver/models'

// ─── SQL Types ───
const SQL_TYPES = [
  'uuid', 'serial', 'bigserial',
  'integer', 'bigint', 'smallint',
  'numeric', 'decimal', 'real', 'double precision',
  'varchar', 'char', 'text',
  'boolean',
  'date', 'time', 'timestamp', 'timestamptz',
  'json', 'jsonb',
  'bytea', 'blob',
]

// ─── Column Definition ───
interface ColumnDef {
  id: string
  name: string
  type: string
  primaryKey: boolean
  notNull: boolean
  unique: boolean
  defaultValue: string
  status: 'existing' | 'new' | 'modified' | 'deleted'
  originalName?: string
}

interface BuildStructureRequestResult {
  request: StructureChangeRequest | null
  issues: string[]
}

let colIdCounter = 0
function newColId() {
  return `col_${Date.now()}_${colIdCounter++}`
}

function createDefaultNewColumns(): ColumnDef[] {
  return [
    {
      id: newColId(),
      name: 'id',
      type: 'uuid',
      primaryKey: true,
      notNull: true,
      unique: false,
      defaultValue: 'gen_random_uuid()',
      status: 'new',
    },
    {
      id: newColId(),
      name: 'created_at',
      type: 'timestamptz',
      primaryKey: false,
      notNull: true,
      unique: false,
      defaultValue: 'now()',
      status: 'new',
    },
  ]
}

function mapServerColumnsToDefs(serverColumns: ColumnInfo[]): ColumnDef[] {
  return serverColumns.map((column) => ({
    id: newColId(),
    name: column.name,
    type: column.type,
    primaryKey: column.primaryKey,
    notNull: !column.nullable,
    unique: column.unique,
    defaultValue: column.defaultValue || '',
    status: 'existing' as const,
    originalName: column.name,
  }))
}

function toStructureColumn(column: ColumnDef): StructureColumnDefinition {
  const defaultValue = column.defaultValue.trim()
  return {
    name: column.name.trim(),
    type: column.type.trim(),
    primaryKey: column.primaryKey,
    notNull: column.notNull,
    unique: column.unique,
    defaultValue: defaultValue.length > 0 ? defaultValue : undefined,
  }
}

// ─── Props ───
interface StructureDesignerModalProps {
  open: boolean
  onClose: () => void
  connectionId: string
  tableName: string
  dbType?: string
  database?: string
}

export function StructureDesignerModal(props: StructureDesignerModalProps) {
  const { dbType, database, open, onClose, connectionId, tableName } = props

  if (dbType === 'mongodb' && database) {
    return (
      <MongoSchemaEditor
        open={open}
        onClose={onClose}
        connectionId={connectionId}
        collection={tableName}
        database={database}
      />
    )
  }

  return <SqlStructureDesignerModal {...props} />
}

function SqlStructureDesignerModal({ open, onClose, connectionId, tableName, dbType, database }: StructureDesignerModalProps) {
  const isNewTable = tableName === '__new__'
  const { data: serverColumns = [] } = useColumns(connectionId, isNewTable ? '' : tableName)
  const previewMutation = usePreviewStructureChange()
  const applyMutation = useApplyStructureChange()

  const [editableName, setEditableName] = useState(isNewTable ? 'new_table' : tableName)
  const [columns, setColumns] = useState<ColumnDef[]>(() => (isNewTable ? createDefaultNewColumns() : []))
  const [showDDL, setShowDDL] = useState(false)
  const [previewDirty, setPreviewDirty] = useState(true)
  const [previewRequest, setPreviewRequest] = useState<StructureChangeRequest | null>(null)
  const [previewResult, setPreviewResult] = useState<StructureChangePreviewResult | null>(null)
  const [requestIssues, setRequestIssues] = useState<string[]>([])
  const [previewError, setPreviewError] = useState('')
  const [applyError, setApplyError] = useState('')
  const [failedStatement, setFailedStatement] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)

  const resetReviewState = useCallback(() => {
    setPreviewDirty(true)
    setPreviewRequest(null)
    setPreviewResult(null)
    setRequestIssues([])
    setPreviewError('')
    setApplyError('')
    setFailedStatement('')
    setConfirmOpen(false)
  }, [])

  useEffect(() => {
    if (!open) {
      return
    }

    setEditableName(isNewTable ? 'new_table' : tableName)
    if (isNewTable) {
      setColumns(createDefaultNewColumns())
      return
    }
    if (serverColumns.length > 0) {
      setColumns(mapServerColumnsToDefs(serverColumns))
      return
    }
    setColumns([])
  }, [open, isNewTable, tableName, serverColumns])

  useEffect(() => {
    if (!open) {
      resetReviewState()
    }
  }, [open, resetReviewState])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      setColumns((prev) => {
        const oldIdx = prev.findIndex((column) => column.id === active.id)
        const newIdx = prev.findIndex((column) => column.id === over.id)
        return arrayMove(prev, oldIdx, newIdx)
      })
      resetReviewState()
    }
  }, [resetReviewState])

  const updateColumn = useCallback((id: string, updates: Partial<ColumnDef>) => {
    setColumns((prev) =>
      prev.map((column) =>
        column.id === id
          ? { ...column, ...updates, status: column.status === 'new' ? 'new' : 'modified' }
          : column
      )
    )
    resetReviewState()
  }, [resetReviewState])

  const addColumn = useCallback(() => {
    setColumns((prev) => [
      ...prev,
      {
        id: newColId(),
        name: `new_column_${prev.length + 1}`,
        type: 'varchar(255)',
        primaryKey: false,
        notNull: false,
        unique: false,
        defaultValue: '',
        status: 'new',
      },
    ])
    resetReviewState()
  }, [resetReviewState])

  const removeColumn = useCallback((id: string) => {
    setColumns((prev) =>
      prev.map((column) => (column.id === id ? { ...column, status: 'deleted' as const } : column))
    )
    resetReviewState()
  }, [resetReviewState])

  const discardChanges = useCallback(() => {
    if (isNewTable) {
      setColumns(createDefaultNewColumns())
      resetReviewState()
      return
    }

    setColumns((prev) =>
      prev
        .filter((column) => column.status !== 'new')
        .map((column) => (
          column.status === 'deleted' || column.status === 'modified'
            ? { ...column, status: 'existing' as const }
            : column
        ))
    )
    resetReviewState()
  }, [isNewTable, resetReviewState])

  const pendingChanges = useMemo(() => columns.filter((column) => column.status !== 'existing'), [columns])
  const visibleColumns = useMemo(() => columns.filter((column) => column.status !== 'deleted'), [columns])

  const buildStructureRequest = useCallback((): BuildStructureRequestResult => {
    const issues: string[] = []
    const databaseName = database?.trim() || undefined

    if (isNewTable) {
      const table = editableName.trim()
      if (!table) {
        issues.push('Table name is required.')
      }

      const draftColumns = visibleColumns.map(toStructureColumn)
      if (!draftColumns.length) {
        issues.push('At least one column is required to create a table.')
      }

      const columnNames = new Set<string>()
      for (const column of draftColumns) {
        if (!column.name) {
          issues.push('Every column requires a name.')
          continue
        }
        if (!column.type) {
          issues.push(`Column "${column.name}" requires a type.`)
        }
        const key = column.name.toLowerCase()
        if (columnNames.has(key)) {
          issues.push(`Column "${column.name}" is duplicated.`)
        }
        columnNames.add(key)
      }

      if (issues.length > 0) {
        return { request: null, issues }
      }

      return {
        request: {
          database: databaseName,
          mode: 'createTable',
          createTable: {
            table,
            columns: draftColumns,
          },
        },
        issues,
      }
    }

    const operations: StructureChangeOperation[] = []
    const baselineByName = new Map(serverColumns.map((column) => [column.name.toLowerCase(), column]))

    for (const column of columns) {
      if (column.status === 'existing') {
        continue
      }

      if (column.status === 'new') {
        const addName = column.name.trim()
        const addType = column.type.trim()
        if (!addName) {
          issues.push('New columns require a name.')
          continue
        }
        if (!addType) {
          issues.push(`Column "${addName}" requires a type.`)
          continue
        }
        if (baselineByName.has(addName.toLowerCase())) {
          issues.push(`Column "${addName}" already exists in this table.`)
          continue
        }

        operations.push({
          kind: 'addColumn',
          addColumn: {
            column: toStructureColumn(column),
          },
        })
        baselineByName.set(addName.toLowerCase(), {
          name: addName,
          type: addType,
          nullable: !column.notNull,
          primaryKey: column.primaryKey,
          unique: column.unique,
          defaultValue: column.defaultValue.trim(),
        } as ColumnInfo)
        continue
      }

      if (column.status === 'deleted') {
        if (!column.originalName) {
          continue
        }
        operations.push({
          kind: 'dropColumn',
          dropColumn: { column: column.originalName },
        })
        continue
      }

      const originalName = column.originalName?.trim()
      if (!originalName) {
        issues.push(`Unable to resolve original metadata for column "${column.name || 'unknown'}".`)
        continue
      }

      const baseline = baselineByName.get(originalName.toLowerCase())
      if (!baseline) {
        issues.push(`Column "${originalName}" no longer exists in the latest schema snapshot.`)
        continue
      }

      let targetName = originalName
      const nextName = column.name.trim()
      if (!nextName) {
        issues.push(`Column "${originalName}" requires a name.`)
        continue
      }
      if (nextName !== originalName) {
        operations.push({
          kind: 'renameColumn',
          renameColumn: {
            column: originalName,
            newName: nextName,
          },
        })
        targetName = nextName
      }

      const nextType = column.type.trim()
      if (!nextType) {
        issues.push(`Column "${targetName}" requires a type.`)
      } else if (nextType !== baseline.type.trim()) {
        operations.push({
          kind: 'alterColumnType',
          alterColumnType: {
            column: targetName,
            newType: nextType,
          },
        })
      }

      const baselineNotNull = !baseline.nullable
      if (column.notNull !== baselineNotNull) {
        operations.push({
          kind: 'alterColumnNullability',
          alterColumnNullability: {
            column: targetName,
            notNull: column.notNull,
          },
        })
      }

      const baselineDefault = (baseline.defaultValue || '').trim()
      const nextDefault = column.defaultValue.trim()
      if (nextDefault !== baselineDefault) {
        operations.push({
          kind: 'alterColumnDefault',
          alterColumnDefault: {
            column: targetName,
            hasDefault: nextDefault.length > 0,
            defaultValue: nextDefault.length > 0 ? nextDefault : undefined,
          },
        })
      }

      if (column.unique !== baseline.unique) {
        issues.push(`Changing UNIQUE for existing column "${targetName}" is not supported in Structure Designer v1.`)
      }
    }

    if (issues.length > 0) {
      return { request: null, issues }
    }
    if (!operations.length) {
      return {
        request: null,
        issues: ['No supported structure changes detected.'],
      }
    }

    return {
      request: {
        database: databaseName,
        mode: 'alterTable',
        alterTable: {
          table: tableName,
          operations,
        },
      },
      issues,
    }
  }, [columns, database, editableName, isNewTable, serverColumns, tableName, visibleColumns])

  const runPreview = useCallback(async () => {
    if (!pendingChanges.length) {
      setRequestIssues(['No pending changes to review.'])
      setPreviewError('')
      setPreviewResult(null)
      setPreviewRequest(null)
      setShowDDL(true)
      return null
    }

    if (!previewDirty && previewRequest && previewResult && requestIssues.length === 0) {
      setShowDDL(true)
      return { request: previewRequest, preview: previewResult }
    }

    const built = buildStructureRequest()
    setRequestIssues(built.issues)
    setPreviewError('')
    setApplyError('')
    setFailedStatement('')
    setShowDDL(true)

    if (!built.request) {
      setPreviewResult(null)
      setPreviewRequest(null)
      if (built.issues.length === 0) {
        setPreviewError('No supported structure changes were generated for this draft.')
      }
      return null
    }

    try {
      const preview = await previewMutation.mutateAsync({
        connectionId,
        request: built.request,
      })

      setPreviewResult(preview)
      setPreviewRequest(built.request)
      setPreviewDirty(false)
      return { request: built.request, preview }
    } catch (err) {
      setPreviewResult(null)
      setPreviewRequest(null)
      setPreviewError(err instanceof Error ? err.message : String(err))
      return null
    }
  }, [
    buildStructureRequest,
    connectionId,
    pendingChanges.length,
    previewDirty,
    previewMutation,
    previewRequest,
    previewResult,
    requestIssues.length,
  ])

  const executeApply = useCallback(async (request: StructureChangeRequest, confirmApply: boolean) => {
    setApplyError('')
    setFailedStatement('')

    try {
      const result = await applyMutation.mutateAsync({
        connectionId,
        request: {
          ...request,
          confirmApply,
        },
      })

      setPreviewResult((current) => {
        if (current) {
          return {
            ...current,
            databaseType: result.databaseType,
            statements: result.plannedStatements,
            warnings: result.warnings,
            capabilityNotes: result.capabilityNotes,
            supported: result.supported,
            hasDestructiveChanges: result.hasDestructiveChanges,
            requiresConfirmation: result.requiresConfirmation,
            error: result.error,
          }
        }

        return {
          databaseType: result.databaseType,
          statements: result.plannedStatements,
          warnings: result.warnings,
          capabilityNotes: result.capabilityNotes,
          supported: result.supported,
          hasDestructiveChanges: result.hasDestructiveChanges,
          requiresConfirmation: result.requiresConfirmation,
          error: result.error,
        }
      })

      if (result.success) {
        onClose()
        return
      }

      setApplyError(result.error || 'Failed to apply structure changes.')
      setFailedStatement(result.failedStatement || '')
      setShowDDL(true)
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : String(err))
      setShowDDL(true)
    }
  }, [applyMutation, connectionId, onClose])

  const handleApplyClick = useCallback(async () => {
    const prepared = await runPreview()
    if (!prepared) {
      return
    }

    const hasBlockingWarnings = prepared.preview.warnings.some((warning) => warning.blocking)
    if (!prepared.preview.supported || hasBlockingWarnings) {
      return
    }

    if (prepared.preview.requiresConfirmation) {
      setConfirmOpen(true)
      return
    }

    await executeApply(prepared.request, false)
  }, [executeApply, runPreview])

  const handleConfirmApply = useCallback(async () => {
    setConfirmOpen(false)

    const prepared = await runPreview()
    if (!prepared) {
      return
    }

    const hasBlockingWarnings = prepared.preview.warnings.some((warning) => warning.blocking)
    if (!prepared.preview.supported || hasBlockingWarnings) {
      return
    }

    await executeApply(prepared.request, true)
  }, [executeApply, runPreview])

  const handleTogglePreview = useCallback(() => {
    const next = !showDDL
    setShowDDL(next)
    if (next && pendingChanges.length > 0) {
      void runPreview()
    }
  }, [pendingChanges.length, runPreview, showDDL])

  useEffect(() => {
    if (!open) return
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) {
    return null
  }

  const previewWarnings = previewResult?.warnings || []
  const blockingWarnings = previewWarnings.filter((warning) => warning.blocking)
  const previewStatements = previewResult?.statements || []
  const previewNotes = previewResult?.capabilityNotes || []
  const primaryButtonLabel = previewMutation.isPending
    ? 'Reviewing...'
    : applyMutation.isPending
      ? 'Applying...'
      : previewDirty || !previewResult
        ? 'Review Changes'
        : 'Apply Changes'

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <button
          type="button"
          aria-label="Close structure designer"
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={onClose}
        />

        <div className="relative w-full max-w-[1000px] max-h-[85vh] bg-bg-card rounded-xl border border-border-subtle flex flex-col overflow-hidden animate-fade-in-up mx-4">
          <div className="px-6 py-5 border-b border-border-subtle flex items-center justify-between bg-bg-card z-10 shrink-0">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-text-muted">table_chart</span>
                {isNewTable ? (
                  <input
                    className="text-xl font-bold text-text-main font-display tracking-tight bg-transparent border-b-2 border-primary/50 focus:border-primary outline-none px-1 py-0.5 w-64"
                    value={editableName}
                    onChange={(event) => {
                      setEditableName(event.target.value)
                      resetReviewState()
                    }}
                    placeholder="table_name"
                  />
                ) : (
                  <h1 className="text-xl font-bold text-text-main font-display tracking-tight">{tableName}</h1>
                )}
                {dbType && (
                  <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-bg-hover text-text-muted">
                    {dbType}
                  </span>
                )}
              </div>
              <p className="text-sm text-text-muted pl-9">
                {isNewTable
                  ? 'Design your new table. Add columns and set constraints.'
                  : 'Modify columns and constraints visually. Changes are staged until applied.'}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleTogglePreview}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-bg-hover hover:bg-border-subtle text-text-main text-sm font-medium transition-all"
              >
                <span className="material-symbols-outlined text-[18px]">code</span>
                DDL
              </button>
              <button
                type="button"
                onClick={addColumn}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary hover:bg-primary-hover text-white text-sm font-bold transition-all"
              >
                <span className="material-symbols-outlined text-[18px]">add_column_right</span>
                Add Column
              </button>
              <button
                type="button"
                onClick={onClose}
                className="p-2 rounded-lg text-text-muted hover:text-text-main hover:bg-bg-hover transition-colors ml-1"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto bg-bg-card/50">
            {showDDL && (
              <div className="mx-6 mt-4 bg-bg-editor rounded-lg border border-border-subtle overflow-hidden">
                <div className="px-4 py-2.5 border-b border-border-subtle/50 flex items-center justify-between">
                  <span className="text-xs font-semibold text-text-main">Backend Preview</span>
                  <button type="button" onClick={() => setShowDDL(false)} className="text-text-muted hover:text-text-main">
                    <span className="material-symbols-outlined text-[16px]">close</span>
                  </button>
                </div>

                {previewMutation.isPending ? (
                  <div className="p-4 text-sm text-text-muted font-mono">Preparing backend preview...</div>
                ) : (
                  <>
                    {requestIssues.length > 0 && (
                      <div className="px-4 py-3 border-b border-red-500/30 bg-red-500/10 text-red-300 text-xs space-y-1">
                        {requestIssues.map((issue) => (
                          <p key={issue}>- {issue}</p>
                        ))}
                      </div>
                    )}

                    {previewError && (
                      <div className="px-4 py-3 border-b border-red-500/30 bg-red-500/10 text-red-300 text-xs">
                        {previewError}
                      </div>
                    )}

                    <pre className="p-4 text-[13px] font-mono text-emerald-400 overflow-x-auto whitespace-pre-wrap">
                      {previewStatements.length > 0 ? previewStatements.join('\n') : '-- No backend preview available'}
                    </pre>

                    {previewWarnings.length > 0 && (
                      <div className="px-4 pb-4 space-y-2">
                        <p className="text-xs font-semibold text-text-main">Warnings</p>
                        {previewWarnings.map((warning) => (
                          <div
                            key={`${warning.code}-${warning.operationKind || 'general'}-${warning.column || 'none'}`}
                            className={`rounded-md px-3 py-2 text-xs border ${
                              warning.blocking
                                ? 'bg-red-500/10 border-red-500/30 text-red-300'
                                : 'bg-amber-500/10 border-amber-500/30 text-amber-200'
                            }`}
                          >
                            {warning.message}
                          </div>
                        ))}
                      </div>
                    )}

                    {previewNotes.length > 0 && (
                      <div className="px-4 pb-4 space-y-2">
                        <p className="text-xs font-semibold text-text-main">Capability Notes</p>
                        {previewNotes.map((note) => (
                          <div
                            key={`${note.code}-${note.severity}`}
                            className="rounded-md px-3 py-2 text-xs border bg-bg-hover/60 border-border-subtle text-text-muted"
                          >
                            {note.message}
                          </div>
                        ))}
                      </div>
                    )}

                    {previewResult?.requiresConfirmation && (
                      <div className="mx-4 mb-4 rounded-md px-3 py-2 text-xs border bg-amber-500/10 border-amber-500/30 text-amber-200">
                        Confirmation is required before applying this structure change.
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            <div className="grid grid-cols-12 gap-4 px-6 py-3 border-b border-border-subtle bg-bg-card sticky top-0 z-10 text-xs font-semibold text-text-muted uppercase tracking-wider">
              <div className="col-span-1 text-center">Order</div>
              <div className="col-span-4">Column Name</div>
              <div className="col-span-3">Type</div>
              <div className="col-span-3">Constraints</div>
              <div className="col-span-1 text-right">Actions</div>
            </div>

            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={visibleColumns.map((column) => column.id)} strategy={verticalListSortingStrategy}>
                <div className="divide-y divide-border-subtle/50">
                  {visibleColumns.map((column) => (
                    <SortableColumnRow
                      key={column.id}
                      column={column}
                      onUpdate={(updates) => updateColumn(column.id, updates)}
                      onRemove={() => removeColumn(column.id)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>

            <button
              type="button"
              onClick={addColumn}
              className="grid grid-cols-12 gap-4 px-6 py-3 items-center hover:bg-bg-hover/20 transition-colors group w-full text-left"
            >
              <div className="col-span-1" />
              <div className="col-span-11 flex items-center gap-2 text-text-muted group-hover:text-primary transition-colors">
                <span className="material-symbols-outlined text-[18px]">add</span>
                <span className="text-sm font-mono">Add new column...</span>
              </div>
            </button>
          </div>

          {(applyError || failedStatement) && (
            <div className="px-6 py-3 bg-red-500/10 border-t border-red-500/30 text-red-300 text-sm space-y-2">
              <p>
                <span className="font-semibold">Apply Error:</span> {applyError}
              </p>
              {failedStatement && (
                <pre className="text-xs font-mono whitespace-pre-wrap break-all p-2 rounded bg-bg-editor border border-red-500/20">
                  {failedStatement}
                </pre>
              )}
            </div>
          )}

          {pendingChanges.length > 0 && (
            <div className="px-6 py-4 bg-bg-card border-t border-border-subtle z-20 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center size-8 rounded-full text-primary">
                  <span className="material-symbols-outlined text-[18px]">history_edu</span>
                </div>
                <div>
                  <p className="text-sm font-medium text-text-main">
                    {pendingChanges.length} Change{pendingChanges.length > 1 ? 's' : ''} Pending
                  </p>
                  <p className="text-xs text-text-muted">Review backend preview before applying to production.</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={discardChanges}
                  disabled={previewMutation.isPending || applyMutation.isPending}
                  className="px-4 py-2 rounded-lg text-text-muted hover:text-text-main text-sm font-medium transition-colors disabled:opacity-50"
                >
                  Discard
                </button>
                <button
                  type="button"
                  onClick={() => void handleApplyClick()}
                  disabled={previewMutation.isPending || applyMutation.isPending || blockingWarnings.length > 0}
                  className="flex items-center gap-2 px-5 py-2 rounded-lg bg-primary hover:bg-primary-hover text-white text-sm font-bold transition-all active:scale-95 disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-[18px]">
                    {previewMutation.isPending || applyMutation.isPending ? 'hourglass_top' : 'check'}
                  </span>
                  {primaryButtonLabel}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <ConfirmModal
        open={confirmOpen}
        title="Confirm Structure Changes"
        message="This plan includes potentially risky operations. Review the backend preview and confirm to proceed."
        detail={previewStatements.join('\n')}
        confirmText="Apply Changes"
        cancelText="Cancel"
        variant="warning"
        onConfirm={() => void handleConfirmApply()}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  )
}

// ─── Sortable Column Row ───
function SortableColumnRow({ column, onUpdate, onRemove }: {
  column: ColumnDef
  onUpdate: (updates: Partial<ColumnDef>) => void
  onRemove: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: column.id })
  const [typeOpen, setTypeOpen] = useState(false)
  const [typeSearch, setTypeSearch] = useState('')
  const typeBtnRef = useRef<HTMLButtonElement>(null)
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 0 })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : undefined,
  }

  const filteredTypes = useMemo(
    () => (typeSearch ? SQL_TYPES.filter((t) => t.includes(typeSearch.toLowerCase())) : SQL_TYPES),
    [typeSearch]
  )

  const handleTypeOpen = useCallback(() => {
    if (!typeOpen && typeBtnRef.current) {
      const rect = typeBtnRef.current.getBoundingClientRect()
      setDropdownPos({ top: rect.top, left: rect.left, width: rect.width })
    }
    setTypeOpen((prev) => !prev)
  }, [typeOpen])

  const statusBorder =
    column.status === 'new'
      ? 'border-l-2 border-l-emerald-500 bg-emerald-500/5'
      : column.status === 'modified'
        ? 'border-l-2 border-l-primary'
        : ''

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`grid grid-cols-12 gap-4 px-6 py-4 items-center hover:bg-bg-hover/30 transition-colors group ${statusBorder}`}
    >
      {/* Drag Handle */}
      <div className="col-span-1 flex justify-center">
        <button type="button" {...attributes} {...listeners} className="cursor-grab text-text-muted hover:text-text-main active:cursor-grabbing">
          <span className="material-symbols-outlined text-[20px]">drag_indicator</span>
        </button>
      </div>

      {/* Column Name */}
      <div className="col-span-4">
        <div className="flex items-center gap-2">
          {column.primaryKey ? (
            <span className="material-symbols-outlined text-[16px] text-amber-400">key</span>
          ) : (
            <div className="w-4" />
          )}
          <input
            className="bg-transparent border-none p-0 text-text-main font-mono text-sm focus:ring-0 w-full hover:text-primary transition-colors cursor-text outline-none"
            type="text"
            value={column.name}
            onChange={(e) => onUpdate({ name: e.target.value })}
          />
        </div>
      </div>

      {/* Type Dropdown */}
      <div className="col-span-3">
        <button
          type="button"
          ref={typeBtnRef}
          onClick={handleTypeOpen}
          className="flex items-center justify-between w-full px-3 py-1.5 rounded bg-bg-hover/50 hover:bg-bg-hover border border-transparent hover:border-border-subtle text-emerald-400 font-mono text-xs transition-all"
        >
          <span>{column.type}</span>
          <span className="material-symbols-outlined text-[16px] text-text-muted">expand_more</span>
        </button>

        {typeOpen && (
          <>
            <button
              type="button"
              aria-label="Close type menu"
              className="fixed inset-0 z-[60]"
              onClick={() => {
                setTypeOpen(false)
                setTypeSearch('')
              }}
            />
            <div
              className="fixed z-[70] bg-bg-hover border border-primary rounded-lg overflow-hidden animate-fade-in shadow-xl"
              style={{ top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width }}
            >
              <div className="p-2 border-b border-border-subtle/50">
                <div className="flex items-center gap-2 bg-bg-card px-2 py-1.5 rounded border border-border-subtle/50">
                  <span className="material-symbols-outlined text-[14px] text-text-muted">search</span>
                  <input
                    className="bg-transparent border-none p-0 text-xs text-text-main w-full focus:ring-0 outline-none"
                    placeholder="Search type..."
                    value={typeSearch}
                    onChange={(e) => setTypeSearch(e.target.value)}
                  />
                </div>
              </div>
              <div className="max-h-[200px] overflow-y-auto">
                {filteredTypes.map((t) => (
                  <button
                    type="button"
                    key={t}
                    onClick={() => {
                      onUpdate({ type: t })
                      setTypeOpen(false)
                      setTypeSearch('')
                    }}
                    className={`w-full px-3 py-2 text-xs font-mono text-left flex justify-between items-center transition-colors ${
                      t === column.type ? 'text-text-main bg-primary/20' : 'text-text-muted hover:text-text-main hover:bg-bg-card/50'
                    }`}
                  >
                    <span>{t}</span>
                    {t === column.type && <span className="material-symbols-outlined text-[14px]">check</span>}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Constraint Toggles */}
      <div className="col-span-3 flex items-center gap-2">
        <ConstraintPill label="PK" active={column.primaryKey} onClick={() => onUpdate({ primaryKey: !column.primaryKey })} title="Primary Key" />
        <ConstraintPill label="NN" active={column.notNull} onClick={() => onUpdate({ notNull: !column.notNull })} title="Not Null" />
        <ConstraintPill label="UN" active={column.unique} onClick={() => onUpdate({ unique: !column.unique })} title="Unique" />
      </div>

      {/* Actions */}
      <div className="col-span-1 flex justify-end">
        {column.status === 'new' ? (
          <div className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span className="text-[10px] text-emerald-500 font-medium">New</span>
          </div>
        ) : column.status === 'modified' ? (
          <div className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            <span className="text-[10px] text-amber-400 font-medium">Edit</span>
          </div>
        ) : (
          <button
            type="button"
            onClick={onRemove}
            className="p-1.5 rounded-lg text-text-muted hover:text-red-400 hover:bg-red-400/10 transition-colors opacity-0 group-hover:opacity-100"
          >
            <span className="material-symbols-outlined text-[18px]">delete</span>
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Constraint Pill Toggle ───
function ConstraintPill({ label, active, onClick, title }: { label: string; active: boolean; onClick: () => void; title: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`h-6 px-2 rounded-full text-[10px] font-bold tracking-wide transition-all ${
        active
          ? 'bg-primary text-text-main'
          : 'border border-border-subtle text-text-muted hover:border-text-muted/50 hover:text-text-main'
      }`}
    >
      {label}
    </button>
  )
}
