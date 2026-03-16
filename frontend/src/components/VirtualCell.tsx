import React from 'react'
import { useSettingsContext } from '@/hooks/useSettings'
import { EditableCell } from './EditableCell'

// ─── Date formatting helper ───
const DATE_TYPES = /date|time|timestamp/i
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}(T|\s)\d{2}:\d{2}/

function formatCellValue(val: string, columnType: string, dateFormat: string): string {
  if (dateFormat === 'iso') return val
  // Only format if column type hints at date or value looks like ISO date
  if (!DATE_TYPES.test(columnType) && !ISO_PATTERN.test(val)) return val

  const d = new Date(val)
  if (isNaN(d.getTime())) return val

  switch (dateFormat) {
    case 'us': {
      const mm = String(d.getMonth() + 1).padStart(2, '0')
      const dd = String(d.getDate()).padStart(2, '0')
      const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })
      return `${mm}/${dd}/${d.getFullYear()} ${time}`
    }
    case 'eu': {
      const dd = String(d.getDate()).padStart(2, '0')
      const mm = String(d.getMonth() + 1).padStart(2, '0')
      const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      return `${dd}/${mm}/${d.getFullYear()} ${time}`
    }
    case 'relative': {
      const now = Date.now()
      const diffMs = now - d.getTime()
      const absDiff = Math.abs(diffMs)
      if (absDiff < 60_000) return 'just now'
      if (absDiff < 3_600_000) return `${Math.floor(absDiff / 60_000)}m ago`
      if (absDiff < 86_400_000) return `${Math.floor(absDiff / 3_600_000)}h ago`
      if (absDiff < 2_592_000_000) return `${Math.floor(absDiff / 86_400_000)}d ago`
      return `${Math.floor(absDiff / 2_592_000_000)}mo ago`
    }
    default:
      return val
  }
}

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
    // Format dates if dateFormat setting is not 'iso'
    const strVal = String(val)
    content = formatCellValue(strVal, columnType, settings.dateFormat)
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
