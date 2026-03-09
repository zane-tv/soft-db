import { useCallback } from 'react'

// ─── DB Icon Mapping ───
const DB_ICONS: Record<string, { icon: string; color: string }> = {
  postgresql: { icon: 'database', color: '#336791' },
  mysql: { icon: 'table_view', color: '#F29111' },
  mariadb: { icon: 'table_view', color: '#4EA3A4' },
  sqlite: { icon: 'storage', color: '#44A8E0' },
  mongodb: { icon: 'data_object', color: '#00ED64' },
  redshift: { icon: 'cloud', color: '#8C4FFF' },
}

export interface ConnectionTab {
  id: string
  name: string
  type: string
}

interface ConnectionTabBarProps {
  tabs: ConnectionTab[]
  activeId: string
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onAdd: () => void
}

export function ConnectionTabBar({ tabs, activeId, onSelect, onClose, onAdd }: ConnectionTabBarProps) {
  const handleClose = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    onClose(id)
  }, [onClose])

  return (
    <div className="flex items-center h-[34px] bg-bg-app/80 border-b border-border-subtle/40 shrink-0 overflow-x-auto"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeId
        const db = DB_ICONS[tab.type] || { icon: 'database', color: '#888' }
        return (
          <button
            key={tab.id}
            onClick={() => onSelect(tab.id)}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            className={`flex items-center gap-1.5 px-3.5 h-full text-[11px] font-medium whitespace-nowrap transition-all duration-150 relative
              ${isActive
                ? 'bg-bg-card text-text-main border-x border-border-subtle/30'
                : 'text-text-muted/70 hover:text-text-main hover:bg-bg-hover/20'
              }`}
          >
            {/* Active top indicator */}
            {isActive && (
              <div className="absolute top-0 left-0 right-0 h-[2px] bg-primary rounded-b" />
            )}
            <span className="material-symbols-outlined text-[13px]" style={{ color: isActive ? db.color : undefined }}>
              {db.icon}
            </span>
            <span className="max-w-[120px] truncate">{tab.name}</span>
            {tabs.length > 1 && (
              <span
                onClick={(e) => handleClose(e, tab.id)}
                className="material-symbols-outlined text-[12px] opacity-0 group-hover:opacity-100 hover:!opacity-100 hover:text-error ml-0.5 transition-all cursor-pointer rounded-sm hover:bg-error/10 p-0.5"
                style={{ opacity: isActive ? 0.5 : undefined }}
              >
                close
              </span>
            )}
          </button>
        )
      })}

      {/* Add tab button */}
      <button
        onClick={onAdd}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        className="flex items-center justify-center w-8 h-full shrink-0 text-text-muted/50 hover:text-text-main hover:bg-bg-hover/20 transition-colors"
        title="Open another connection"
      >
        <span className="material-symbols-outlined text-[14px]">add</span>
      </button>
    </div>
  )
}
