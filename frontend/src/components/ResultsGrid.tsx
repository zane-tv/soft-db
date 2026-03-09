import { useMemo, useRef, useState, useCallback } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type ColumnFiltersState,
  type FilterFn,
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { QueryResult, ColumnMeta } from '../../bindings/soft-db/internal/driver/models'
import type { ColumnInfo } from '../../bindings/soft-db/internal/driver/models'
import { useSettingsContext } from '@/hooks/useSettings'
import { ColumnFilter, textFilterFn, numberFilterFn, booleanFilterFn, dateFilterFn } from './ColumnFilter'
import { EditableCell } from './EditableCell'
import { PendingChangesBar, SQLReviewModal } from './PendingChangesBar'
import { useEditableGrid } from '@/hooks/useEditableGrid'
import { RowContextMenu } from './RowContextMenu'
import { AddRecordModal } from './AddRecordModal'
import { ConfirmDialog } from './ConfirmDialog'

type Row = Record<string, unknown>

interface ResultsGridProps {
  queryResult: QueryResult | null
  query?: string
  connectionId?: string
  pkColumns?: string[]
  columnInfos?: ColumnInfo[]
  onDataChange?: () => void
}

// ─── Custom filter function that routes to typed filters ───
const typedFilterFn: FilterFn<Row> = (row, columnId, filterValue) => {
  if (!filterValue) return true
  if (typeof filterValue === 'string') return booleanFilterFn(row.original, columnId, filterValue)
  if (filterValue.from !== undefined || filterValue.to !== undefined) return dateFilterFn(row.original, columnId, filterValue)
  if (['=', '!=', '>', '<', '>=', '<='].includes(filterValue.op)) return numberFilterFn(row.original, columnId, filterValue)
  return textFilterFn(row.original, columnId, filterValue)
}

// ─── Component ───
export function ResultsGrid({ queryResult, query = '', connectionId = '', pkColumns = [], columnInfos = [], onDataChange }: ResultsGridProps) {
  const resultContainerRef = useRef<HTMLDivElement>(null)
  const { settings } = useSettingsContext()

  // ─── Sort State ───
  const [sorting, setSorting] = useState<SortingState>([])

  // ─── Filter State ───
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [showFilters, setShowFilters] = useState(false)

  // ─── Edit State ───
  const tableData = useMemo(() => (queryResult?.rows as Row[]) || [], [queryResult?.rows])

  const editGrid = useEditableGrid({
    query,
    connectionId,
    rows: tableData,
    pkColumns,
  })

  const [showSQLReview, setShowSQLReview] = useState(false)

  // ─── Context Menu State ───
  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number; row: Row; rowIndex: number; selectedColumn?: string
  } | null>(null)

  // ─── Modal State ───
  const [recordModal, setRecordModal] = useState<{
    mode: 'add' | 'edit' | 'duplicate'; row?: Row; rowIndex?: number
  } | null>(null)

  // ─── Delete Confirm State ───
  const [deleteTarget, setDeleteTarget] = useState<{ rowIndex: number; row: Row } | null>(null)

  // ─── Columns ───
  const columns = useMemo<ColumnDef<Row, unknown>[]>(() => {
    if (!queryResult?.columns?.length) return []
    return queryResult.columns.map((col: ColumnMeta) => ({
      accessorKey: col.name,
      header: col.name,
      meta: { type: col.type },
      filterFn: typedFilterFn,
      cell: ({ getValue, row, column }: { getValue: () => unknown; row: { index: number }; column: { id: string } }) => {
        const rowIndex = row.index
        const columnId = column.id
        const colType = col.type

        // Editing mode
        if (editGrid.editingCell?.row === rowIndex && editGrid.editingCell?.col === columnId) {
          return (
            <EditableCell
              value={editGrid.getCellValue(rowIndex, columnId)}
              columnType={colType}
              onCommit={(val) => editGrid.commitEdit(val)}
              onCancel={() => editGrid.cancelEdit()}
            />
          )
        }

        // Display mode
        const val = editGrid.isCellDirty(rowIndex, columnId)
          ? editGrid.getCellValue(rowIndex, columnId)
          : getValue()

        if (val === null || val === undefined) {
          return (
            settings.nullDisplay === 'badge' ? (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-bg-hover/50 text-text-muted border border-border-subtle italic">
                NULL
              </span>
            ) : settings.nullDisplay === 'dash' ? (
              <span className="text-text-muted/50">—</span>
            ) : (
              <span className="text-text-muted/50 italic">null</span>
            )
          )
        }
        if (typeof val === 'object') return JSON.stringify(val)
        return String(val)
      },
    }))
  }, [queryResult?.columns, settings.nullDisplay, editGrid.editingCell, editGrid])

  // ─── Table ───
  const table = useReactTable({
    data: tableData,
    columns,
    state: { sorting, columnFilters, globalFilter },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  })

  const { rows: tableRows } = table.getRowModel()

  const rowVirtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => resultContainerRef.current,
    estimateSize: () => settings.rowDensity === 'compact' ? 28 : settings.rowDensity === 'comfortable' ? 44 : 36,
    overscan: 20,
  })

  // ─── Handlers ───
  const handleApply = useCallback(async () => {
    if (settings.confirmMutations) { setShowSQLReview(true); return }
    await editGrid.applyAll()
    onDataChange?.()
  }, [settings.confirmMutations, editGrid, onDataChange])

  const handleConfirmApply = useCallback(async () => {
    setShowSQLReview(false)
    await editGrid.applyAll()
    onDataChange?.()
  }, [editGrid, onDataChange])

  const handleContextMenu = useCallback((e: React.MouseEvent, row: Row, rowIndex: number, columnId?: string) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, row, rowIndex, selectedColumn: columnId })
  }, [])

  const handleModalSubmit = useCallback(async (values: Record<string, unknown>) => {
    if (recordModal?.mode === 'edit' && recordModal.rowIndex !== undefined) {
      // Stage as pending edits (same flow as inline cell editing)
      editGrid.stageRowEdits(recordModal.rowIndex, values)
    } else {
      // Add or Duplicate → InsertRow immediately
      await editGrid.insertRow(values)
      onDataChange?.()
    }
  }, [editGrid, onDataChange, recordModal])

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return
    await editGrid.deleteRows([deleteTarget.rowIndex])
    setDeleteTarget(null)
    onDataChange?.()
  }, [deleteTarget, editGrid, onDataChange])

  const activeFilterCount = columnFilters.length + (globalFilter ? 1 : 0)

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-bg-app">
      {/* Meta Bar */}
      <div className="h-10 flex items-center justify-between px-4 border-b border-border-subtle/30 bg-bg-app text-xs shrink-0">
        <div className="flex items-center gap-4 text-text-muted">
          {queryResult ? (
            queryResult.error ? (
              <span className="flex items-center gap-1.5 text-red-400 font-medium">
                <span className="material-symbols-outlined text-[16px]">error</span>
                Query error
              </span>
            ) : (
              <>
                <span className="flex items-center gap-1.5 text-success font-medium">
                  <span className="material-symbols-outlined text-[16px]">check_circle</span>
                  Query successful
                </span>
                <span>{queryResult.executionTime}ms</span>
                <span>
                  {tableRows.length !== queryResult.rowCount
                    ? `${tableRows.length} / ${queryResult.rowCount} rows`
                    : `${queryResult.rowCount} rows`
                  }
                </span>
                {editGrid.isEditable ? (
                  <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    <span className="material-symbols-outlined text-[12px]">edit</span>
                    Editable
                  </span>
                ) : query && (
                  <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-bg-hover/50 text-text-muted border border-border-subtle">
                    <span className="material-symbols-outlined text-[12px]">lock</span>
                    Read-only
                  </span>
                )}
              </>
            )
          ) : (
            <span className="text-text-muted/50">Execute a query to see results</span>
          )}
        </div>
        {queryResult && !queryResult.error && (
          <div className="flex items-center gap-1.5">
            {/* Add Record Button */}
            {editGrid.isEditable && (
              <button
                onClick={() => setRecordModal({ mode: 'add' })}
                className="flex items-center gap-1 px-2 py-1 rounded text-emerald-400 hover:bg-emerald-500/10 transition-colors text-[11px] font-medium"
              >
                <span className="material-symbols-outlined text-[16px]">add</span>
                Add
              </button>
            )}

            {/* Global Search */}
            <div className="relative">
              <span className="material-symbols-outlined text-[14px] text-text-muted/40 absolute left-1.5 top-1/2 -translate-y-1/2">search</span>
              <input
                type="text"
                value={globalFilter}
                onChange={(e) => setGlobalFilter(e.target.value)}
                placeholder="Search..."
                className="h-6 pl-6 pr-2 text-[11px] bg-bg-hover/30 border border-border-subtle/30 rounded text-text-main placeholder:text-text-muted/30 focus:outline-none focus:border-primary/50 w-[140px]"
              />
            </div>

            {/* Filter Toggle */}
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`relative flex items-center gap-1 px-2 py-1 rounded text-text-muted transition-colors ${showFilters ? 'bg-primary/10 text-primary' : 'hover:bg-bg-hover/50 hover:text-text-main'}`}
            >
              <span className="material-symbols-outlined text-[16px]">filter_list</span>
              {activeFilterCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] flex items-center justify-center px-0.5 text-[9px] font-bold bg-primary text-white rounded-full">
                  {activeFilterCount}
                </span>
              )}
            </button>

            {/* Clear Filters */}
            {activeFilterCount > 0 && (
              <button
                onClick={() => { setColumnFilters([]); setGlobalFilter('') }}
                className="flex items-center gap-1 px-2 py-1 hover:bg-bg-hover/50 rounded text-text-muted hover:text-text-main transition-colors text-[10px]"
              >
                <span className="material-symbols-outlined text-[14px]">filter_list_off</span>
              </button>
            )}

            {/* Export */}
            <button className="flex items-center gap-1.5 px-2 py-1 hover:bg-bg-hover/50 rounded text-text-muted hover:text-text-main transition-colors">
              <span className="material-symbols-outlined text-[16px]">download</span>
              Export
            </button>
          </div>
        )}
      </div>

      {/* Results Content */}
      {queryResult?.error ? (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-6 max-w-lg text-center">
            <span className="material-symbols-outlined text-[48px] text-red-400/50 mb-4 block">error_outline</span>
            <p className="text-red-400 text-sm font-mono whitespace-pre-wrap break-all">{queryResult.error}</p>
          </div>
        </div>
      ) : queryResult?.columns?.length ? (
        <div ref={resultContainerRef} className="flex-1 overflow-auto">
          <table className="w-full border-collapse text-left whitespace-nowrap">
            <thead className="sticky top-0 z-10 bg-bg-card">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <th
                      key={header.id}
                      className="px-4 py-2.5 text-xs font-bold text-text-muted uppercase tracking-wider border-b border-border-subtle/50"
                    >
                      <div
                        className={`flex items-center gap-1.5 ${header.column.getCanSort() ? 'cursor-pointer select-none hover:text-text-main' : ''}`}
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        <span className="material-symbols-outlined text-[14px] text-text-muted/40">
                          {getColumnIcon((header.column.columnDef.meta as Record<string, string>)?.type)}
                        </span>
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {{
                          asc: <span className="material-symbols-outlined text-[14px] text-primary">arrow_upward</span>,
                          desc: <span className="material-symbols-outlined text-[14px] text-primary">arrow_downward</span>,
                        }[header.column.getIsSorted() as string] ?? null}
                        {pkColumns.includes(header.column.id) && (
                          <span className="material-symbols-outlined text-[10px] text-amber-400" title="Primary Key">key</span>
                        )}
                      </div>

                      {showFilters && header.column.getCanFilter() && (
                        <div className="mt-1.5">
                          <ColumnFilter column={header.column} />
                        </div>
                      )}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody className="font-mono text-text-muted" style={{ fontSize: `${settings.fontSize}px` }}>
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const row = tableRows[virtualRow.index]
                const isEven = virtualRow.index % 2 === 0
                const isRowDirty = editGrid.pendingEdits.some((e) => e.rowIndex === row.index)
                return (
                  <tr
                    key={row.id}
                    className={`border-b border-border-subtle/10 hover:bg-bg-hover/30 transition-colors group
                      ${isRowDirty
                        ? 'bg-amber-500/8 border-l-2 border-l-amber-400'
                        : isEven ? 'bg-bg-app' : 'bg-bg-card'
                      }`}
                    style={{ height: `${virtualRow.size}px` }}
                    onContextMenu={(e) => handleContextMenu(e, row.original, row.index)}
                  >
                    {row.getVisibleCells().map((cell) => {
                      const isDirty = editGrid.isCellDirty(row.index, cell.column.id)
                      const isPk = pkColumns.includes(cell.column.id)
                      return (
                        <td
                          key={cell.id}
                          className={`px-4 py-2 group-hover:text-text-main transition-colors max-w-[300px] truncate relative
                            ${isDirty ? 'border-l-2 border-l-amber-400 bg-amber-500/5' : ''}
                            ${editGrid.isEditable && !isPk ? 'cursor-text' : ''}
                            ${isPk ? 'text-text-muted/60' : ''}`}
                          onDoubleClick={() => editGrid.startEdit(row.index, cell.column.id)}
                          onContextMenu={(e) => { e.stopPropagation(); handleContextMenu(e, row.original, row.index, cell.column.id) }}
                          title={isDirty ? `Original: ${String(editGrid.pendingEdits.find(e => e.rowIndex === row.index && e.columnId === cell.column.id)?.originalValue)}` : undefined}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <span className="material-symbols-outlined text-[56px] text-text-muted/10 mb-3 block">database</span>
            <p className="text-text-muted/40 text-sm">Run a query to see results here</p>
          </div>
        </div>
      )}

      {/* Pending Changes Bar */}
      <PendingChangesBar
        count={editGrid.pendingEdits.length}
        onReviewSQL={() => setShowSQLReview(true)}
        onDiscard={() => editGrid.discardAll()}
        onApply={handleApply}
        isApplying={editGrid.isApplying}
      />

      {/* Pagination Footer */}
      {queryResult && !queryResult.error && queryResult.rowCount > 0 && editGrid.pendingEdits.length === 0 && (
        <div className="h-10 flex items-center justify-between px-4 border-t border-border-subtle/30 bg-bg-app text-xs text-text-muted shrink-0">
          <span>Showing {tableRows.length} rows ({queryResult.executionTime}ms)</span>
          <span className="text-text-muted/40 font-mono">
            {queryResult.affectedRows > 0 && `${queryResult.affectedRows} affected`}
          </span>
        </div>
      )}

      {/* SQL Review Modal */}
      {showSQLReview && (
        <SQLReviewModal
          sqlStatements={editGrid.getGeneratedSQL()}
          onClose={() => setShowSQLReview(false)}
          onConfirm={handleConfirmApply}
        />
      )}

      {/* Context Menu */}
      {contextMenu && (
        <RowContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          row={contextMenu.row}
          rowIndex={contextMenu.rowIndex}
          selectedColumn={contextMenu.selectedColumn}
          isEditable={editGrid.isEditable}
          onEdit={() => setRecordModal({ mode: 'edit', row: contextMenu.row, rowIndex: contextMenu.rowIndex })}
          onDuplicate={() => setRecordModal({ mode: 'duplicate', row: contextMenu.row })}
          onDelete={() => setDeleteTarget({ rowIndex: contextMenu.rowIndex, row: contextMenu.row })}
          onCopyValue={(val) => navigator.clipboard.writeText(val)}
          onCopyRowJSON={() => navigator.clipboard.writeText(JSON.stringify(contextMenu.row, null, 2))}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Add/Edit/Duplicate Record Modal */}
      {recordModal && (
        <AddRecordModal
          mode={recordModal.mode}
          columns={columnInfos}
          initialValues={recordModal.row}
          onSubmit={handleModalSubmit}
          onClose={() => setRecordModal(null)}
        />
      )}

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Row"
        message="Are you sure you want to delete this row? This action cannot be undone."
        confirmLabel="Delete"
        danger
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}

// ─── Helpers ───
function getColumnIcon(type?: string): string {
  if (!type) return 'data_object'
  const t = type.toLowerCase()
  if (t.includes('int') || t.includes('float') || t.includes('numeric') || t.includes('decimal')) return 'pin'
  if (t.includes('char') || t.includes('text') || t.includes('varchar')) return 'text_fields'
  if (t.includes('date') || t.includes('time') || t.includes('timestamp')) return 'calendar_today'
  if (t.includes('bool')) return 'toggle_on'
  if (t.includes('json') || t.includes('jsonb')) return 'data_object'
  if (t.includes('uuid')) return 'fingerprint'
  return 'data_object'
}
