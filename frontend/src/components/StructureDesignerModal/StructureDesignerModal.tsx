import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { MongoSchemaEditor } from '../MongoSchemaEditor'
import { ConfirmModal } from '../ConfirmModal'
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
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import {
  useApplyStructureChange,
  useColumns,
  usePreviewStructureChange,
  type StructureChangePreviewResult,
  type StructureChangeRequest,
  type StructureChangeOperation,
} from '@/hooks/useSchema'
import type { ColumnInfo } from '../../../bindings/soft-db/internal/driver/models'
import {
  type ColumnDef,
  newColId,
  createDefaultNewColumns,
  mapServerColumnsToDefs,
  toStructureColumn,
} from './structure-designer-types'
import { SortableColumnRow } from './SortableColumnRow'
import { DDLPreviewPanel } from './DDLPreviewPanel'

interface BuildStructureRequestResult {
  request: StructureChangeRequest | null
  issues: string[]
}

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
  const structureModalRef = useRef<HTMLDivElement>(null)
  useFocusTrap(structureModalRef, open, onClose)
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
    if (!open) return
    setEditableName(isNewTable ? 'new_table' : tableName)
    if (isNewTable) { setColumns(createDefaultNewColumns()); return }
    if (serverColumns.length > 0) { setColumns(mapServerColumnsToDefs(serverColumns)); return }
    setColumns([])
  }, [open, isNewTable, tableName, serverColumns])

  useEffect(() => { if (!open) resetReviewState() }, [open, resetReviewState])

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
    if (isNewTable) { setColumns(createDefaultNewColumns()); resetReviewState(); return }
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
      if (!table) issues.push('Table name is required.')
      const draftColumns = visibleColumns.map(toStructureColumn)
      if (!draftColumns.length) issues.push('At least one column is required to create a table.')
      const columnNames = new Set<string>()
      for (const column of draftColumns) {
        if (!column.name) { issues.push('Every column requires a name.'); continue }
        if (!column.type) issues.push(`Column "${column.name}" requires a type.`)
        const key = column.name.toLowerCase()
        if (columnNames.has(key)) issues.push(`Column "${column.name}" is duplicated.`)
        columnNames.add(key)
      }
      if (issues.length > 0) return { request: null, issues }
      return {
        request: { database: databaseName, mode: 'createTable', createTable: { table, columns: draftColumns } },
        issues,
      }
    }

    const operations: StructureChangeOperation[] = []
    const baselineByName = new Map(serverColumns.map((column) => [column.name.toLowerCase(), column]))

    for (const column of columns) {
      if (column.status === 'existing') continue
      if (column.status === 'new') {
        const addName = column.name.trim()
        const addType = column.type.trim()
        if (!addName) { issues.push('New columns require a name.'); continue }
        if (!addType) { issues.push(`Column "${addName}" requires a type.`); continue }
        if (baselineByName.has(addName.toLowerCase())) { issues.push(`Column "${addName}" already exists in this table.`); continue }
        operations.push({ kind: 'addColumn', addColumn: { column: toStructureColumn(column) } })
        baselineByName.set(addName.toLowerCase(), {
          name: addName, type: addType, nullable: !column.notNull,
          primaryKey: column.primaryKey, unique: column.unique, defaultValue: column.defaultValue.trim(),
        } as ColumnInfo)
        continue
      }
      if (column.status === 'deleted') {
        if (!column.originalName) continue
        operations.push({ kind: 'dropColumn', dropColumn: { column: column.originalName } })
        continue
      }
      const originalName = column.originalName?.trim()
      if (!originalName) { issues.push(`Unable to resolve original metadata for column "${column.name || 'unknown'}".`); continue }
      const baseline = baselineByName.get(originalName.toLowerCase())
      if (!baseline) { issues.push(`Column "${originalName}" no longer exists in the latest schema snapshot.`); continue }
      let targetName = originalName
      const nextName = column.name.trim()
      if (!nextName) { issues.push(`Column "${originalName}" requires a name.`); continue }
      if (nextName !== originalName) {
        operations.push({ kind: 'renameColumn', renameColumn: { column: originalName, newName: nextName } })
        targetName = nextName
      }
      const nextType = column.type.trim()
      if (!nextType) { issues.push(`Column "${targetName}" requires a type.`) }
      else if (nextType !== baseline.type.trim()) {
        operations.push({ kind: 'alterColumnType', alterColumnType: { column: targetName, newType: nextType } })
      }
      const baselineNotNull = !baseline.nullable
      if (column.notNull !== baselineNotNull) {
        operations.push({ kind: 'alterColumnNullability', alterColumnNullability: { column: targetName, notNull: column.notNull } })
      }
      const baselineDefault = (baseline.defaultValue || '').trim()
      const nextDefault = column.defaultValue.trim()
      if (nextDefault !== baselineDefault) {
        operations.push({ kind: 'alterColumnDefault', alterColumnDefault: { column: targetName, hasDefault: nextDefault.length > 0, defaultValue: nextDefault.length > 0 ? nextDefault : undefined } })
      }
      if (column.unique !== baseline.unique) {
        issues.push(`Changing UNIQUE for existing column "${targetName}" is not supported in Structure Designer v1.`)
      }
    }

    if (issues.length > 0) return { request: null, issues }
    if (!operations.length) return { request: null, issues: ['No supported structure changes detected.'] }
    return { request: { database: databaseName, mode: 'alterTable', alterTable: { table: tableName, operations } }, issues }
  }, [columns, database, editableName, isNewTable, serverColumns, tableName, visibleColumns])

  const runPreview = useCallback(async () => {
    if (!pendingChanges.length) {
      setRequestIssues(['No pending changes to review.'])
      setPreviewError(''); setPreviewResult(null); setPreviewRequest(null); setShowDDL(true)
      return null
    }
    if (!previewDirty && previewRequest && previewResult && requestIssues.length === 0) {
      setShowDDL(true)
      return { request: previewRequest, preview: previewResult }
    }
    const built = buildStructureRequest()
    setRequestIssues(built.issues); setPreviewError(''); setApplyError(''); setFailedStatement(''); setShowDDL(true)
    if (!built.request) {
      setPreviewResult(null); setPreviewRequest(null)
      if (built.issues.length === 0) setPreviewError('No supported structure changes were generated for this draft.')
      return null
    }
    try {
      const preview = await previewMutation.mutateAsync({ connectionId, request: built.request })
      setPreviewResult(preview); setPreviewRequest(built.request); setPreviewDirty(false)
      return { request: built.request, preview }
    } catch (err) {
      setPreviewResult(null); setPreviewRequest(null)
      setPreviewError(err instanceof Error ? err.message : String(err))
      return null
    }
  }, [buildStructureRequest, connectionId, pendingChanges.length, previewDirty, previewMutation, previewRequest, previewResult, requestIssues.length])

  const executeApply = useCallback(async (request: StructureChangeRequest, confirmApply: boolean) => {
    setApplyError(''); setFailedStatement('')
    try {
      const result = await applyMutation.mutateAsync({ connectionId, request: { ...request, confirmApply } })
      setPreviewResult((current) => {
        const updated = {
          databaseType: result.databaseType, statements: result.plannedStatements, warnings: result.warnings,
          capabilityNotes: result.capabilityNotes, supported: result.supported,
          hasDestructiveChanges: result.hasDestructiveChanges, requiresConfirmation: result.requiresConfirmation, error: result.error,
        }
        return current ? { ...current, ...updated } : updated
      })
      if (result.success) { onClose(); return }
      setApplyError(result.error || 'Failed to apply structure changes.')
      setFailedStatement(result.failedStatement || ''); setShowDDL(true)
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : String(err)); setShowDDL(true)
    }
  }, [applyMutation, connectionId, onClose])

  const handleApplyClick = useCallback(async () => {
    const prepared = await runPreview()
    if (!prepared) return
    const hasBlockingWarnings = prepared.preview.warnings.some((warning) => warning.blocking)
    if (!prepared.preview.supported || hasBlockingWarnings) return
    if (prepared.preview.requiresConfirmation) { setConfirmOpen(true); return }
    await executeApply(prepared.request, false)
  }, [executeApply, runPreview])

  const handleConfirmApply = useCallback(async () => {
    setConfirmOpen(false)
    const prepared = await runPreview()
    if (!prepared) return
    const hasBlockingWarnings = prepared.preview.warnings.some((warning) => warning.blocking)
    if (!prepared.preview.supported || hasBlockingWarnings) return
    await executeApply(prepared.request, true)
  }, [executeApply, runPreview])

  const handleTogglePreview = useCallback(() => {
    const next = !showDDL
    setShowDDL(next)
    if (next && pendingChanges.length > 0) void runPreview()
  }, [pendingChanges.length, runPreview, showDDL])

  useEffect(() => {
    if (!open) return
    const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  const previewStatements = previewResult?.statements || []
  const blockingWarnings = (previewResult?.warnings || []).filter((warning) => warning.blocking)
  const primaryButtonLabel = previewMutation.isPending
    ? 'Reviewing...'
    : applyMutation.isPending
      ? 'Applying...'
      : previewDirty || !previewResult
        ? 'Review Changes'
        : 'Apply Changes'

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true" aria-label="Structure Designer">
        <button
          type="button"
          aria-label="Close structure designer"
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={onClose}
        />

        <div ref={structureModalRef} className="relative w-full max-w-[1000px] max-h-[85vh] bg-bg-card rounded-xl border border-border-subtle flex flex-col overflow-hidden animate-fade-in-up mx-4">
          <div className="px-6 py-5 border-b border-border-subtle flex items-center justify-between bg-bg-card z-10 shrink-0">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-text-muted">table_chart</span>
                {isNewTable ? (
                  <input
                    className="text-xl font-bold text-text-main font-display tracking-tight bg-transparent border-b-2 border-primary/50 focus:border-primary outline-none px-1 py-0.5 w-64"
                    value={editableName}
                    onChange={(event) => { setEditableName(event.target.value); resetReviewState() }}
                    placeholder="table_name"
                  />
                ) : (
                  <h1 className="text-xl font-bold text-text-main font-display tracking-tight">{tableName}</h1>
                )}
                {dbType && (
                  <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-bg-hover text-text-muted">{dbType}</span>
                )}
              </div>
              <p className="text-sm text-text-muted pl-9">
                {isNewTable
                  ? 'Design your new table. Add columns and set constraints.'
                  : 'Modify columns and constraints visually. Changes are staged until applied.'}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button type="button" onClick={handleTogglePreview} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-bg-hover hover:bg-border-subtle text-text-main text-sm font-medium transition-all">
                <span className="material-symbols-outlined text-[18px]">code</span>
                DDL
              </button>
              <button type="button" onClick={addColumn} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary hover:bg-primary-hover text-white text-sm font-bold transition-all">
                <span className="material-symbols-outlined text-[18px]">add_column_right</span>
                Add Column
              </button>
              <button type="button" onClick={onClose} className="p-2 rounded-lg text-text-muted hover:text-text-main hover:bg-bg-hover transition-colors ml-1">
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto bg-bg-card/50">
            {showDDL && (
              <DDLPreviewPanel
                isPending={previewMutation.isPending}
                requestIssues={requestIssues}
                previewError={previewError}
                previewResult={previewResult}
                onClose={() => setShowDDL(false)}
              />
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
              <p><span className="font-semibold">Apply Error:</span> {applyError}</p>
              {failedStatement && (
                <pre className="text-xs font-mono whitespace-pre-wrap break-all p-2 rounded bg-bg-editor border border-red-500/20">{failedStatement}</pre>
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
                <button type="button" onClick={discardChanges} disabled={previewMutation.isPending || applyMutation.isPending} className="px-4 py-2 rounded-lg text-text-muted hover:text-text-main text-sm font-medium transition-colors disabled:opacity-50">
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
