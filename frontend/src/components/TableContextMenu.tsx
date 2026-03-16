import { useEffect, useRef } from 'react'

interface TableContextMenuProps {
  x: number
  y: number
  tableName: string
  onViewFullData: () => void
  onAttachToAI: () => void
  onOpenStructure: () => void
  onCopyName: () => void
  onClose: () => void
}

export function TableContextMenu({
  x, y, tableName,
  onViewFullData, onAttachToAI, onOpenStructure, onCopyName, onClose,
}: TableContextMenuProps) {
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
    top: Math.min(y, window.innerHeight - 250),
    zIndex: 100,
  }

  return (
    <div ref={menuRef} style={style} className="w-[210px] bg-bg-card border border-border-subtle/50 rounded-xl py-1.5 backdrop-blur-sm shadow-lg">
      {/* Header: table name */}
      <div className="px-4 py-1.5 text-[10px] font-medium text-text-muted uppercase tracking-wider truncate" title={tableName}>
        {tableName}
      </div>
      <Separator />

      <MenuItem icon="table_view" label="View Full Data" onClick={() => { onViewFullData(); onClose() }} />
      <MenuItem icon="auto_awesome" label="Attach to AI Chat" onClick={() => { onAttachToAI(); onClose() }} />
      <Separator />
      <MenuItem icon="settings" label="Open Structure" onClick={() => { onOpenStructure(); onClose() }} />
      <MenuItem icon="content_copy" label="Copy Table Name" onClick={() => { onCopyName(); onClose() }} />
    </div>
  )
}

// ─── Sub-components ───

function MenuItem({ icon, label, onClick }: {
  icon: string
  label: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-2 text-[12px] text-left transition-colors text-text-main hover:bg-bg-hover/50"
    >
      <span className="material-symbols-outlined text-[14px] text-text-muted">{icon}</span>
      {label}
    </button>
  )
}

function Separator() {
  return <div className="my-1.5 border-t border-border-subtle/30" />
}
