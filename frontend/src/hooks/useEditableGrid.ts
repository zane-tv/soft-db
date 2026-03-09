import { useState, useCallback, useMemo } from 'react'
import * as EditServiceBindings from '../../bindings/soft-db/services/editservice'

// ─── Types ───
export interface PendingEdit {
  rowIndex: number
  columnId: string
  originalValue: unknown
  newValue: unknown
  table: string
  pkValues: Record<string, unknown>
}

export interface UseEditableGridOptions {
  query: string
  connectionId: string
  rows: Record<string, unknown>[]
  pkColumns: string[]
}

export interface UseEditableGridReturn {
  pendingEdits: PendingEdit[]
  editingCell: { row: number; col: string } | null
  startEdit: (row: number, col: string) => void
  commitEdit: (value: unknown) => void
  cancelEdit: () => void
  applyAll: () => Promise<void>
  discardAll: () => void
  insertRow: (values: Record<string, unknown>) => Promise<void>
  deleteRows: (rowIndices: number[]) => Promise<void>
  stageRowEdits: (rowIndex: number, newValues: Record<string, unknown>) => void
  isEditable: boolean
  editableTable: string | null
  isApplying: boolean
  getGeneratedSQL: () => string[]
  getCellValue: (rowIndex: number, columnId: string) => unknown
  isCellDirty: (rowIndex: number, columnId: string) => boolean
}

// ─── Query Editability Detection ───
export function detectEditableTable(query: string): string | null {
  if (!query) return null
  const trimmed = query.trim()

  // Must start with SELECT
  if (!/^SELECT\b/i.test(trimmed)) return null

  // No GROUP BY, DISTINCT, UNION, subqueries in FROM
  const upper = trimmed.toUpperCase()
  if (upper.includes('GROUP BY')) return null
  if (upper.includes('DISTINCT')) return null
  if (upper.includes('UNION')) return null
  if (/\b(COUNT|SUM|AVG|MIN|MAX|ARRAY_AGG|STRING_AGG)\s*\(/i.test(trimmed)) return null

  // Extract FROM clause
  const fromMatch = trimmed.match(/\bFROM\s+([`"[\w]+[`"\]]?\.)?([`"[\w]+[`"\]]?)\b/i)
  if (!fromMatch) return null

  const tableName = fromMatch[2].replace(/[`"[\]]/g, '')

  // No JOIN
  if (/\bJOIN\b/i.test(upper)) return null

  // No multiple tables in FROM (comma-separated)
  const afterFrom = trimmed.substring(trimmed.toUpperCase().indexOf('FROM') + 4)
  const beforeWhere = afterFrom.split(/\b(WHERE|ORDER|LIMIT|GROUP|HAVING)\b/i)[0]
  if (beforeWhere.includes(',')) return null

  // No subquery in FROM
  if (beforeWhere.includes('(')) return null

  return tableName
}

// ─── Hook ───
export function useEditableGrid({ query, connectionId, rows, pkColumns }: UseEditableGridOptions): UseEditableGridReturn {
  const [pendingEdits, setPendingEdits] = useState<PendingEdit[]>([])
  const [editingCell, setEditingCell] = useState<{ row: number; col: string } | null>(null)
  const [isApplying, setIsApplying] = useState(false)

  const editableTable = useMemo(() => detectEditableTable(query), [query])
  const isEditable = editableTable !== null && pkColumns.length > 0

  // Get PK values for a row
  const getPkValues = useCallback((rowIndex: number): Record<string, unknown> => {
    const row = rows[rowIndex]
    if (!row) return {}
    const pkValues: Record<string, unknown> = {}
    for (const pk of pkColumns) {
      pkValues[pk] = row[pk]
    }
    return pkValues
  }, [rows, pkColumns])

  // Get value (pending edit or original)
  const getCellValue = useCallback((rowIndex: number, columnId: string): unknown => {
    const edit = pendingEdits.find((e) => e.rowIndex === rowIndex && e.columnId === columnId)
    if (edit) return edit.newValue
    return rows[rowIndex]?.[columnId]
  }, [pendingEdits, rows])

  // Check if cell has pending edit
  const isCellDirty = useCallback((rowIndex: number, columnId: string): boolean => {
    return pendingEdits.some((e) => e.rowIndex === rowIndex && e.columnId === columnId)
  }, [pendingEdits])

  // Start editing
  const startEdit = useCallback((row: number, col: string) => {
    if (!isEditable) return
    // Don't allow editing PK columns
    if (pkColumns.includes(col)) return
    setEditingCell({ row, col })
  }, [isEditable, pkColumns])

  // Commit edit
  const commitEdit = useCallback((value: unknown) => {
    if (!editingCell || !editableTable) return

    const { row, col } = editingCell
    const originalValue = rows[row]?.[col]

    // Skip if value hasn't changed
    if (value === originalValue) {
      setEditingCell(null)
      return
    }

    // Remove existing edit for this cell if any
    setPendingEdits((prev) => {
      const filtered = prev.filter((e) => !(e.rowIndex === row && e.columnId === col))
      // If new value equals original, don't add edit (user reverted)
      if (value === originalValue) return filtered
      return [
        ...filtered,
        {
          rowIndex: row,
          columnId: col,
          originalValue,
          newValue: value,
          table: editableTable,
          pkValues: getPkValues(row),
        },
      ]
    })

    setEditingCell(null)
  }, [editingCell, editableTable, rows, getPkValues])

  // Cancel edit
  const cancelEdit = useCallback(() => {
    setEditingCell(null)
  }, [])

  // Generate SQL for display
  const getGeneratedSQL = useCallback((): string[] => {
    return pendingEdits.map((edit) => {
      const setPart = edit.newValue === null
        ? `"${edit.columnId}" = NULL`
        : `"${edit.columnId}" = ${formatSQLValue(edit.newValue)}`
      const whereParts = Object.entries(edit.pkValues)
        .map(([col, val]) => `"${col}" = ${formatSQLValue(val)}`)
        .join(' AND ')
      return `UPDATE "${edit.table}" SET ${setPart} WHERE ${whereParts};`
    })
  }, [pendingEdits])

  // Apply all changes
  const applyAll = useCallback(async () => {
    if (pendingEdits.length === 0 || !editableTable) return

    setIsApplying(true)
    try {
      const requests = pendingEdits.map((edit) => ({
        table: edit.table,
        pkColumns: edit.pkValues,
        column: edit.columnId,
        newValue: edit.newValue,
      }))

      await EditServiceBindings.BatchUpdateCells(connectionId, requests)
      setPendingEdits([])
    } finally {
      setIsApplying(false)
    }
  }, [pendingEdits, editableTable, connectionId])

  // Discard all
  const discardAll = useCallback(() => {
    setPendingEdits([])
    setEditingCell(null)
  }, [])

  // Insert a new row
  const insertRow = useCallback(async (values: Record<string, unknown>): Promise<void> => {
    if (!editableTable) throw new Error('Not editable')
    const result = await EditServiceBindings.InsertRow(connectionId, editableTable, values)
    if (!result || !result.success) throw new Error(result?.error || 'Insert failed')
  }, [editableTable, connectionId])

  // Delete rows by PK values
  const deleteRows = useCallback(async (rowIndices: number[]): Promise<void> => {
    if (!editableTable) throw new Error('Not editable')
    const pkValuesList = rowIndices.map((i) => getPkValues(i))
    const result = await EditServiceBindings.DeleteRows(connectionId, editableTable, pkValuesList)
    if (!result || !result.success) throw new Error(result?.error || 'Delete failed')
  }, [editableTable, connectionId, getPkValues])

  // Stage multiple cell edits from modal (same as inline editing flow)
  const stageRowEdits = useCallback((rowIndex: number, newValues: Record<string, unknown>) => {
    if (!editableTable) return
    const row = rows[rowIndex]
    if (!row) return
    const pkVals = getPkValues(rowIndex)

    setPendingEdits((prev) => {
      let updated = [...prev]
      for (const [col, newVal] of Object.entries(newValues)) {
        // Skip PK columns
        if (pkColumns.includes(col)) continue
        const originalValue = row[col]
        // Remove existing edit for this cell
        updated = updated.filter((e) => !(e.rowIndex === rowIndex && e.columnId === col))
        // Only add if value actually changed
        if (newVal !== originalValue) {
          updated.push({
            rowIndex,
            columnId: col,
            originalValue,
            newValue: newVal,
            table: editableTable,
            pkValues: pkVals,
          })
        }
      }
      return updated
    })
  }, [editableTable, rows, getPkValues, pkColumns])

  return {
    pendingEdits,
    editingCell,
    startEdit,
    commitEdit,
    cancelEdit,
    applyAll,
    discardAll,
    insertRow,
    deleteRows,
    stageRowEdits,
    isEditable,
    editableTable,
    isApplying,
    getGeneratedSQL,
    getCellValue,
    isCellDirty,
  }
}

// ─── Helpers ───
function formatSQLValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  return `'${String(value).replace(/'/g, "''")}'`
}

