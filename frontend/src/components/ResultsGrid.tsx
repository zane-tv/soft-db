import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  type ColumnDef,
  type SortingState,
  type ColumnFiltersState,
  type FilterFn,
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { QueryResult, ColumnMeta } from '../../bindings/soft-db/internal/driver/models'
import type { ColumnInfo } from '../../bindings/soft-db/internal/driver/models'
import { useSettingsContext } from '@/hooks/useSettings'
import { useTranslation } from '@/lib/i18n'
import { ColumnFilter, textFilterFn, numberFilterFn, booleanFilterFn, dateFilterFn } from './ColumnFilter'
import { PendingChangesBar, SQLReviewModal } from './PendingChangesBar'
import { useEditableGrid } from '@/hooks/useEditableGrid'
import { RowContextMenu } from './RowContextMenu'
import { AddRecordModal } from './AddRecordModal'
import { ConfirmDialog } from './ConfirmDialog'
import { VirtualRow } from './VirtualRow'

type Row = Record<string, unknown>

// ─── Default column width ───
const DEFAULT_COL_WIDTH = 180
const MIN_COL_WIDTH = 80

interface PaginationInfo {
  page: number
  pageSize: number
  totalRows: number
  totalPages: number
}

interface ResultsGridProps {
  queryResult: QueryResult | null
  query?: string
  connectionId?: string
  pkColumns?: string[]
  columnInfos?: ColumnInfo[]
  onDataChange?: () => void
  pagination?: PaginationInfo
  onPageChange?: (page: number) => void
  onPageSizeChange?: (size: number) => void
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
export function ResultsGrid({ queryResult, query = '', connectionId = '', pkColumns = [], columnInfos = [], onDataChange, pagination, onPageChange, onPageSizeChange }: ResultsGridProps) {
  const resultContainerRef = useRef<HTMLDivElement>(null)
  const { settings } = useSettingsContext()
  const { t } = useTranslation((settings?.language as 'en' | 'vi') ?? 'en')

  // ─── Reset scroll to top on page change ───
  useEffect(() => {
    resultContainerRef.current?.scrollTo({ top: 0 })
  }, [pagination?.page, pagination?.pageSize])

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

  // ─── Columns (no editGrid dependency — pure column definitions) ───
  const columns = useMemo<ColumnDef<Row, unknown>[]>(() => {
    if (!queryResult?.columns?.length) return []
    return queryResult.columns.map((col: ColumnMeta) => ({
      accessorKey: col.name,
      header: col.name,
      meta: { type: col.type },
      filterFn: typedFilterFn,
      size: DEFAULT_COL_WIDTH,
      minSize: MIN_COL_WIDTH,
    }))
  }, [queryResult?.columns])

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
    columnResizeMode: 'onChange',
    enableColumnResizing: true,
  })

  const { rows: tableRows } = table.getRowModel()

  // ─── Visible columns metadata (for VirtualRow) ───
  const columnSizing = table.getState().columnSizing
  const visibleColumns = useMemo(() =>
    table.getVisibleLeafColumns().map((col) => ({
      id: col.id,
      type: (col.columnDef.meta as Record<string, string>)?.type || '',
      width: col.getSize(),
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [table.getVisibleLeafColumns().length, queryResult?.columns, columnSizing]
  )

  // ─── Row Virtualizer ───
  const rowVirtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => resultContainerRef.current,
    estimateSize: () => settings.rowDensity === 'compact' ? 28 : settings.rowDensity === 'comfortable' ? 44 : 36,
    overscan: 20,
  })

  // ─── Total column width (for header + body sync) ───
  const totalColumnWidth = table.getTotalSize()

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

  const handleExport = useCallback(() => {
    if (!queryResult?.columns?.length) return
    const cols = queryResult.columns
    const rows = table.getFilteredRowModel().rows

    const escapeCsv = (val: unknown): string => {
      if (val === null || val === undefined) return ''
      const str = String(val)
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"'
      }
      return str
    }

    const header = cols.map((c) => escapeCsv(c.name)).join(',')
    const dataRows = rows.map((row) =>
      cols.map((c) => escapeCsv(row.original[c.name])).join(',')
    )
    const csv = [header, ...dataRows].join('\n')

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `export_${new Date().toISOString().slice(0, 19).replace(/[:-]/g, '')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [queryResult, table])

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
                    {t('editor.readOnly')}
                  </span>
                )}
              </>
            )
          ) : (
            <span className="text-text-muted/50">{t('results.execute')}</span>
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
            <button
              onClick={handleExport}
              aria-label="Export results"
              className="flex items-center gap-1.5 px-2 py-1 hover:bg-bg-hover/50 rounded text-text-muted hover:text-text-main transition-colors"
            >
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
        <div ref={resultContainerRef} className="flex-1 overflow-auto" role="grid" aria-label="Query results">
          {/* ─── HEADER (sticky, outside virtual scroll) ─── */}
          <div className="sticky top-0 z-10 bg-bg-card" style={{ width: totalColumnWidth }}>
            {table.getHeaderGroups().map((headerGroup) => (
              <div key={headerGroup.id} className="flex">
                {headerGroup.headers.map((header) => (
                    <div
                      key={header.id}
                      role="columnheader"
                      className="relative px-4 py-2.5 text-xs font-bold text-text-muted uppercase tracking-wider border-b border-border-subtle/50 shrink-0 group/col"
                      style={{ width: header.column.getSize() }}
                    >
                      <div
                        className={`flex items-center gap-1.5 overflow-hidden ${header.column.getCanSort() ? 'cursor-pointer select-none hover:text-text-main' : ''}`}
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        <span className="material-symbols-outlined text-[14px] text-text-muted/40 shrink-0">
                          {getColumnIcon((header.column.columnDef.meta as Record<string, string>)?.type)}
                        </span>
                        <span className="truncate" title={header.column.columnDef.header as string}>
                          {header.column.columnDef.header as string}
                        </span>
                        <span className="shrink-0">
                          {{
                            asc: <span className="material-symbols-outlined text-[14px] text-primary">arrow_upward</span>,
                            desc: <span className="material-symbols-outlined text-[14px] text-primary">arrow_downward</span>,
                          }[header.column.getIsSorted() as string] ?? null}
                        </span>
                        {pkColumns.includes(header.column.id) && (
                          <span className="material-symbols-outlined text-[10px] text-amber-400 shrink-0" title="Primary Key">key</span>
                        )}
                      </div>

                      {showFilters && header.column.getCanFilter() && (
                        <div className="mt-1.5">
                          <ColumnFilter column={header.column} />
                        </div>
                      )}

                      {/* Column Resize Handle */}
                      <div
                        onMouseDown={header.getResizeHandler()}
                        onTouchStart={header.getResizeHandler()}
                        className="absolute right-0 top-0 h-full w-[8px] cursor-col-resize select-none touch-none -translate-x-1/2 z-10"
                      >
                        <div
                          className={`absolute right-[3px] top-[6px] bottom-[6px] w-[2px] rounded-full transition-colors ${
                            header.column.getIsResizing()
                              ? 'bg-primary'
                              : 'bg-border-subtle/40 group-hover/col:bg-primary/60'
                          }`}
                        />
                      </div>
                    </div>
                ))}
              </div>
            ))}
          </div>

          {/* ─── BODY (virtualized rows with absolute positioning) ─── */}
          <div
            className="font-mono text-text-muted relative"
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              width: `${totalColumnWidth}px`,
              fontSize: `${settings.fontSize}px`,
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const row = tableRows[virtualRow.index]
              return (
                <VirtualRow
                  key={row.id}
                  row={row}
                  virtualRow={virtualRow}
                  visibleColumns={visibleColumns}
                  pkColumns={pkColumns}
                  isEditable={editGrid.isEditable}
                  editingCell={editGrid.editingCell}
                  isCellDirty={editGrid.isCellDirty}
                  getCellValue={editGrid.getCellValue}
                  isRowDirty={editGrid.isRowDirty(row.index)}
                  getOriginalValue={editGrid.getOriginalValue}
                  onStartEdit={editGrid.startEdit}
                  onCommitEdit={editGrid.commitEdit}
                  onCancelEdit={editGrid.cancelEdit}
                  onContextMenu={handleContextMenu}
                />
              )
            })}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <span className="material-symbols-outlined text-[56px] text-text-muted/10 mb-3 block">database</span>
            <p className="text-text-muted/40 text-sm">{t('results.noData')}</p>
          </div>
        </div>
      )}

      {/* Pending Changes Bar */}
      <PendingChangesBar
        count={editGrid.pendingEditsCount}
        onReviewSQL={() => setShowSQLReview(true)}
        onDiscard={() => editGrid.discardAll()}
        onApply={handleApply}
        isApplying={editGrid.isApplying}
      />

      {/* Footer: Pagination or Static */}
      {queryResult && !queryResult.error && queryResult.rowCount > 0 && editGrid.pendingEditsCount === 0 && (
        pagination ? (
          <div className="h-10 flex items-center justify-between px-4 border-t border-border-subtle/30 bg-bg-app text-xs text-text-muted shrink-0">
            {/* Page navigation */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => onPageChange?.(1)}
                disabled={pagination.page <= 1}
                className="px-1.5 py-1 rounded hover:bg-bg-hover/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="First page"
              >«</button>
              <button
                onClick={() => onPageChange?.(pagination.page - 1)}
                disabled={pagination.page <= 1}
                className="px-1.5 py-1 rounded hover:bg-bg-hover/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Previous page"
              >‹</button>
              <span className="px-2 text-text-main font-medium">
                Page {pagination.page} of {pagination.totalPages}
              </span>
              <button
                onClick={() => onPageChange?.(pagination.page + 1)}
                disabled={pagination.page >= pagination.totalPages}
                className="px-1.5 py-1 rounded hover:bg-bg-hover/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Next page"
              >›</button>
              <button
                onClick={() => onPageChange?.(pagination.totalPages)}
                disabled={pagination.page >= pagination.totalPages}
                className="px-1.5 py-1 rounded hover:bg-bg-hover/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Last page"
              >»</button>
            </div>

            {/* Page size selector */}
            <div className="flex items-center gap-2">
              <span className="text-text-muted/60">Rows per page:</span>
              <select
                value={pagination.pageSize}
                onChange={(e) => onPageSizeChange?.(Number(e.target.value))}
                className="bg-bg-hover/30 border border-border-subtle/30 rounded px-1.5 py-0.5 text-xs text-text-main outline-none cursor-pointer"
              >
                {[25, 50, 100, 250, 500].map((size) => (
                  <option key={size} value={size}>{size}</option>
                ))}
              </select>
            </div>

            {/* Total rows */}
            <span className="text-text-muted/60">
              Total: {pagination.totalRows.toLocaleString()} rows
            </span>
          </div>
        ) : (
          <div className="h-10 flex items-center justify-between px-4 border-t border-border-subtle/30 bg-bg-app text-xs text-text-muted shrink-0">
            <span>Showing {tableRows.length} rows ({queryResult.executionTime}ms)</span>
            <span className="text-text-muted/40 font-mono">
              {queryResult.affectedRows > 0 && `${queryResult.affectedRows} affected`}
            </span>
          </div>
        )
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
