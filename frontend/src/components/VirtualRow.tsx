import React, { useCallback } from 'react'
import type { Row as TanStackRow } from '@tanstack/react-table'
import type { VirtualItem } from '@tanstack/react-virtual'
import { VirtualCell } from './VirtualCell'

type Row = Record<string, unknown>

// ─── Types ───
interface VirtualRowProps {
  row: TanStackRow<Row>
  virtualRow: VirtualItem
  virtualColumns: VirtualItem[]
  visibleColumns: { id: string; type: string; width: number }[]
  virtualPaddingLeft: number
  virtualPaddingRight: number
  pkColumns: string[]
  isEditable: boolean
  editingCell: { row: number; col: string } | null
  isCellDirty: (rowIndex: number, columnId: string) => boolean
  getCellValue: (rowIndex: number, columnId: string) => unknown
  isRowDirty: boolean
  getOriginalValue: (rowIndex: number, columnId: string) => unknown | undefined
  onStartEdit: (row: number, col: string) => void
  onCommitEdit: (value: unknown) => void
  onCancelEdit: () => void
  onContextMenu: (e: React.MouseEvent, row: Row, rowIndex: number, columnId?: string) => void
}

export const VirtualRow = React.memo(function VirtualRow({
  row,
  virtualRow,
  virtualColumns,
  visibleColumns,
  virtualPaddingLeft,
  virtualPaddingRight,
  pkColumns,
  isEditable,
  editingCell,
  isCellDirty,
  getCellValue,
  isRowDirty: rowDirty,
  getOriginalValue,
  onStartEdit,
  onCommitEdit,
  onCancelEdit,
  onContextMenu,
}: VirtualRowProps) {
  const isEven = virtualRow.index % 2 === 0

  const handleRowContextMenu = useCallback((e: React.MouseEvent) => {
    onContextMenu(e, row.original, row.index)
  }, [onContextMenu, row.original, row.index])

  return (
    <div
      className={`flex items-center border-b border-border-subtle/10 hover:bg-bg-hover/30 transition-colors group
        ${rowDirty
          ? 'bg-amber-500/8 border-l-2 border-l-amber-400'
          : isEven ? 'bg-bg-app' : 'bg-bg-card'
        }`}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: `${virtualRow.size}px`,
        transform: `translateY(${virtualRow.start}px)`,
      }}
      onContextMenu={handleRowContextMenu}
    >
      {/* Left padding for column virtualization */}
      {virtualPaddingLeft > 0 && <div style={{ width: virtualPaddingLeft, flexShrink: 0 }} />}

      {virtualColumns.map((vc) => {
        const colMeta = visibleColumns[vc.index]
        if (!colMeta) return null
        const columnId = colMeta.id
        const isDirty = isCellDirty(row.index, columnId)
        const isPk = pkColumns.includes(columnId)
        const isEditingThis = editingCell?.row === row.index && editingCell?.col === columnId
        const rawValue = row.original[columnId]

        return (
          <VirtualCell
            key={columnId}
            rowIndex={row.index}
            columnId={columnId}
            columnType={colMeta.type}
            rawValue={rawValue}
            isDirty={isDirty}
            dirtyValue={isDirty ? getCellValue(row.index, columnId) : rawValue}
            isEditing={isEditingThis}
            isEditable={isEditable}
            isPk={isPk}
            originalValue={isDirty ? getOriginalValue(row.index, columnId) : undefined}
            onStartEdit={onStartEdit}
            onCommitEdit={onCommitEdit}
            onCancelEdit={onCancelEdit}
            onContextMenu={(e: React.MouseEvent) => {
              e.stopPropagation()
              onContextMenu(e, row.original, row.index, columnId)
            }}
            width={vc.size}
          />
        )
      })}

      {/* Right padding for column virtualization */}
      {virtualPaddingRight > 0 && <div style={{ width: virtualPaddingRight, flexShrink: 0 }} />}
    </div>
  )
})
