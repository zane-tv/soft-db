import { useEffect, useRef } from 'react'

type Row = Record<string, unknown>

interface RowContextMenuProps {
  x: number
  y: number
  row: Row
  rowIndex: number
  isEditable: boolean
  onEdit: () => void
  onDuplicate: () => void
  onDelete: () => void
  onCopyValue: (value: string) => void
  onCopyRowJSON: () => void
  onClose: () => void
  selectedColumn?: string
}

export function RowContextMenu({
  x, y, row, rowIndex: _rowIndex, isEditable,
  onEdit, onDuplicate, onDelete,
  onCopyValue, onCopyRowJSON, onClose,
  selectedColumn,
}: RowContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  // Close on click outside or Escape
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  // Adjust position to stay within viewport
  const style: React.CSSProperties = {
    position: 'fixed',
    left: Math.min(x, window.innerWidth - 220),
    top: Math.min(y, window.innerHeight - 300),
    zIndex: 100,
  }

  const cellValue = selectedColumn ? String(row[selectedColumn] ?? '') : ''

  return (
    <div ref={menuRef} style={style} className="w-[200px] bg-bg-card border border-border-subtle/50 rounded-xl py-1.5 backdrop-blur-sm">
      {/* Edit actions (only if editable) */}
      {isEditable && (
        <>
          <MenuItem icon="edit" label="Edit Row" onClick={() => { onEdit(); onClose() }} />
          <MenuItem icon="content_copy" label="Duplicate Row" onClick={() => { onDuplicate(); onClose() }} />
          <MenuItem icon="delete" label="Delete Row" onClick={() => { onDelete(); onClose() }} danger />
          <Separator />
        </>
      )}

      {/* Copy actions (always available) */}
      {selectedColumn && (
        <MenuItem
          icon="content_paste"
          label={`Copy "${truncate(cellValue, 20)}"`}
          onClick={() => { onCopyValue(cellValue); onClose() }}
        />
      )}
      <MenuItem icon="data_object" label="Copy Row as JSON" onClick={() => { onCopyRowJSON(); onClose() }} />
    </div>
  )
}

// ─── Sub-components ───

function MenuItem({ icon, label, onClick, danger }: {
  icon: string
  label: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-2 text-[12px] text-left transition-colors ${
        danger
          ? 'text-red-400 hover:bg-red-500/10'
          : 'text-text-main hover:bg-bg-hover/50'
      }`}
    >
      <span className={`material-symbols-outlined text-[16px] ${danger ? 'text-red-400' : 'text-text-muted'}`}>{icon}</span>
      {label}
    </button>
  )
}

function Separator() {
  return <div className="my-1.5 border-t border-border-subtle/30" />
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) + '...' : str
}
