import { useEffect, useRef } from 'react'
import type { TranslationKey } from '@/lib/i18n'

interface TableContextMenuProps {
  x: number
  y: number
  tableName: string
  t: (key: TranslationKey) => string
  onViewFullData: () => void
  onAttachToAI: () => void
  onOpenStructure: () => void
  onCopyName: () => void
  onExportTable?: () => void
  onDropTable?: () => void
  onClose: () => void
}

export function TableContextMenu({
  x, y, tableName, t,
  onViewFullData, onAttachToAI, onOpenStructure, onCopyName, onExportTable, onDropTable, onClose,
}: TableContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

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

  const style: React.CSSProperties = {
    position: 'fixed',
    left: Math.min(x, window.innerWidth - 220),
    top: Math.min(y, window.innerHeight - 250),
    zIndex: 100,
  }

  return (
    <div ref={menuRef} style={style} className="w-[210px] bg-bg-card border border-border-subtle/50 rounded-xl py-1.5 backdrop-blur-sm shadow-lg">
      <div className="px-4 py-1.5 text-[10px] font-medium text-text-muted uppercase tracking-wider truncate" title={tableName}>
        {tableName}
      </div>
      <Separator />

      <MenuItem icon="table_view" label={t('context.viewFullData')} onClick={() => { onViewFullData(); onClose() }} />
      <MenuItem icon="auto_awesome" label={t('context.attachToAI')} onClick={() => { onAttachToAI(); onClose() }} />
      <Separator />
      <MenuItem icon="settings" label={t('context.openStructure')} onClick={() => { onOpenStructure(); onClose() }} />
      <MenuItem icon="content_copy" label={t('context.copyTableName')} onClick={() => { onCopyName(); onClose() }} />
      {onExportTable && (
        <>
          <Separator />
          <MenuItem icon="download" label={t('context.exportTable')} onClick={() => { onExportTable(); onClose() }} />
        </>
      )}
      {onDropTable && (
        <>
          <Separator />
          <MenuItem icon="delete" label={t('context.dropTable')} onClick={() => { onDropTable(); onClose() }} danger />
        </>
      )}
    </div>
  )
}

function MenuItem({ icon, label, onClick, danger }: {
  icon: string
  label: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-2 text-[12px] text-left transition-colors ${
        danger
          ? 'text-red-400 hover:bg-red-500/10'
          : 'text-text-main hover:bg-bg-hover/50'
      }`}
    >
      <span className={`material-symbols-outlined text-[14px] ${danger ? 'text-red-400' : 'text-text-muted'}`}>{icon}</span>
      {label}
    </button>
  )
}

function Separator() {
  return <div className="my-1.5 border-t border-border-subtle/30" />
}
