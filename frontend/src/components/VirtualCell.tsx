import React from 'react'
import { useSettingsContext } from '@/hooks/useSettings'
import { EditableCell } from './EditableCell'

// ─── Types ───
interface VirtualCellProps {
  rowIndex: number
  columnId: string
  columnType: string
  rawValue: unknown
  isDirty: boolean
  dirtyValue: unknown
  isEditing: boolean
  isEditable: boolean
  isPk: boolean
  originalValue: unknown | undefined
  onStartEdit: (row: number, col: string) => void
  onCommitEdit: (value: unknown) => void
  onCancelEdit: () => void
  onContextMenu: (e: React.MouseEvent) => void
  width: number
}

export const VirtualCell = React.memo(function VirtualCell({
  rowIndex,
  columnId,
  columnType,
  rawValue,
  isDirty,
  dirtyValue,
  isEditing,
  isEditable,
  isPk,
  originalValue,
  onStartEdit,
  onCommitEdit,
  onCancelEdit,
  onContextMenu,
  width,
}: VirtualCellProps) {
  const { settings } = useSettingsContext()

  // Editing mode
  if (isEditing) {
    return (
      <div
        className="px-4 py-2 shrink-0"
        style={{ width }}
      >
        <EditableCell
          value={isDirty ? dirtyValue : rawValue}
          columnType={columnType}
          onCommit={onCommitEdit}
          onCancel={onCancelEdit}
        />
      </div>
    )
  }

  // Display value
  const val = isDirty ? dirtyValue : rawValue

  let content: React.ReactNode
  if (val === null || val === undefined) {
    content = settings.nullDisplay === 'badge' ? (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-bg-hover/50 text-text-muted border border-border-subtle italic">
        NULL
      </span>
    ) : settings.nullDisplay === 'dash' ? (
      <span className="text-text-muted/50">—</span>
    ) : (
      <span className="text-text-muted/50 italic">null</span>
    )
  } else if (typeof val === 'object') {
    content = JSON.stringify(val)
  } else {
    content = String(val)
  }

  return (
    <div
      className={`px-4 py-2 group-hover:text-text-main transition-colors truncate shrink-0 relative
        ${isDirty ? 'border-l-2 border-l-amber-400 bg-amber-500/5' : ''}
        ${isEditable && !isPk ? 'cursor-text' : ''}
        ${isPk ? 'text-text-muted/60' : ''}`}
      style={{ width }}
      onDoubleClick={() => onStartEdit(rowIndex, columnId)}
      onContextMenu={onContextMenu}
      title={isDirty ? `Original: ${String(originalValue)}` : undefined}
    >
      {content}
    </div>
  )
})
