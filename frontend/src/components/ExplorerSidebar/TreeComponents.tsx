import { useState, useEffect, useRef, useMemo } from 'react'
import { useColumns, useDatabases, useTablesForDB } from '@/hooks/useSchema'
import { useSettings } from '@/hooks/useSettings'
import { useTranslation, type TranslationKey } from '@/lib/i18n'

function getColumnIcon(type: string, isPk?: boolean): string {
  if (isPk) return 'key'
  const t = type.toLowerCase()
  if (t.includes('int') || t.includes('float') || t.includes('numeric') || t.includes('decimal') || t.includes('double') || t.includes('real')) return 'pin'
  if (t.includes('char') || t.includes('text') || t.includes('varchar') || t.includes('clob') || t.includes('string')) return 'text_fields'
  if (t.includes('date') || t.includes('time') || t.includes('timestamp')) return 'calendar_today'
  if (t.includes('bool')) return 'toggle_on'
  if (t.includes('json') || t.includes('object') || t.includes('array')) return 'data_object'
  if (t.includes('blob') || t.includes('binary')) return 'attachment'
  if (t.includes('uuid')) return 'fingerprint'
  return 'data_object'
}

export function MultiDBTree({
  connectionId,
  selectedTable,
  selectedDatabase,
  onTableClick,
  onStructureOpen,
  onDatabaseSelect,
  onTableContextMenu,
  onDbContextMenu,
  searchFilter,
}: {
  connectionId: string
  selectedTable: string | null
  selectedDatabase: string | null
  onTableClick: (name: string) => void
  onStructureOpen: (name: string) => void
  onDatabaseSelect?: (database: string) => void
  onTableContextMenu?: (e: React.MouseEvent, tableName: string, databaseName?: string) => void
  onDbContextMenu?: (e: React.MouseEvent, databaseName: string) => void
  searchFilter?: string
}) {
  const { data: databases = [], isLoading } = useDatabases(connectionId)

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-2 py-3 text-[11px] text-text-muted/50">
        <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>
        Loading databases...
      </div>
    )
  }

  return (
    <TreeSection label="Databases" icon="database" count={databases.length}>
      {databases.map((db: { name: string }) => (
        <DatabaseTreeItem
          key={db.name}
          name={db.name}
          connectionId={connectionId}
          active={selectedDatabase === db.name}
          selectedTable={selectedTable}
          onSelect={() => onDatabaseSelect?.(db.name)}
          onTableClick={onTableClick}
          onStructureOpen={onStructureOpen}
          onTableContextMenu={onTableContextMenu}
          onDbContextMenu={onDbContextMenu}
          searchFilter={searchFilter}
        />
      ))}
    </TreeSection>
  )
}

function DatabaseTreeItem({
  name,
  connectionId,
  active,
  selectedTable,
  onSelect,
  onTableClick,
  onStructureOpen,
  onTableContextMenu,
  onDbContextMenu,
  searchFilter,
}: {
  name: string
  connectionId: string
  active?: boolean
  selectedTable: string | null
  onSelect?: () => void
  onTableClick: (name: string) => void
  onStructureOpen: (name: string) => void
  onTableContextMenu?: (e: React.MouseEvent, tableName: string, databaseName?: string) => void
  onDbContextMenu?: (e: React.MouseEvent, databaseName: string) => void
  searchFilter?: string
}) {
  const { data: settings } = useSettings()
  const { t } = useTranslation((settings?.language as 'en' | 'vi') ?? 'en')
  const [manualExpanded, setManualExpanded] = useState(false)

  const hasTableSearch = !!searchFilter && !name.toLowerCase().includes(searchFilter)
  const shouldFetchTables = manualExpanded || hasTableSearch
  const { data: tables = [], isLoading } = useTablesForDB(connectionId, shouldFetchTables ? name : '')

  const filteredTables = useMemo(
    () => searchFilter ? tables.filter((tbl: { name: string }) => tbl.name.toLowerCase().includes(searchFilter)) : tables,
    [tables, searchFilter],
  )

  const dbNameMatches = !searchFilter || name.toLowerCase().includes(searchFilter)
  const hasMatchingTables = filteredTables.length > 0
  const isVisible = !searchFilter || dbNameMatches || hasMatchingTables
  const expanded = manualExpanded || (hasTableSearch && hasMatchingTables)

  if (!isVisible) return null

  return (
    <li>
      <div
        onContextMenu={onDbContextMenu ? (e) => onDbContextMenu(e, name) : undefined}
        className={`w-full flex items-center gap-0.5 px-1 py-1.5 text-[12px] rounded-md border-l-2 transition-all duration-150 group ${
          active
            ? 'text-text-main bg-bg-hover border-primary'
            : 'text-text-muted hover:text-text-main hover:bg-bg-hover/30 border-transparent'
        }`}
      >
        <button
          onClick={(e) => { e.stopPropagation(); setManualExpanded(!manualExpanded) }}
          className="shrink-0 w-5 h-5 flex items-center justify-center rounded hover:bg-bg-hover/50 transition-colors"
        >
          <span className={`material-symbols-outlined text-[14px] text-text-muted/50 transition-transform ${expanded ? '' : '-rotate-90'}`}>
            expand_more
          </span>
        </button>

        <button
          onClick={() => { onSelect?.(); setManualExpanded(true) }}
          className="flex items-center gap-2 flex-1 min-w-0 text-left"
        >
          <span className={`material-symbols-outlined text-[15px] transition-colors ${active ? 'text-primary' : 'opacity-40 group-hover:opacity-70'}`}>
            database
          </span>
          <span className="truncate">{name}</span>
        </button>
      </div>

      {expanded && (
        <ul className="ml-4 mt-0.5 mb-1 space-y-0.5 border-l border-border-subtle/30 pl-1">
          {isLoading ? (
            <li className="flex items-center gap-2 px-2 py-1.5 text-[11px] text-text-muted/50">
              <span className="material-symbols-outlined text-[12px] animate-spin">progress_activity</span>
              Loading...
            </li>
          ) : filteredTables.length > 0 ? (
            filteredTables.map((tbl: { name: string }) => (
              <TableTreeItem
                key={tbl.name}
                name={tbl.name}
                connectionId={connectionId}
                active={selectedTable === tbl.name}
                onClick={() => onTableClick(tbl.name)}
                onSettings={() => onStructureOpen(tbl.name)}
                onContextMenu={onTableContextMenu ? (e) => onTableContextMenu(e, tbl.name, name) : undefined}
              />
            ))
          ) : (
            <li className="px-2 py-1.5 text-[11px] text-text-muted/40 italic">{t('sidebar.noTables')}</li>
          )}
        </ul>
      )}
    </li>
  )
}

export function TreeSection({
  label,
  icon: _icon,
  count,
  isLoading,
  onAdd,
  children,
}: {
  label: string
  icon: string
  count: number
  isLoading?: boolean
  onAdd?: () => void
  children: React.ReactNode
}) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div>
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full px-2 mb-1 flex items-center justify-between text-[10px] font-bold text-text-muted/60 uppercase tracking-wider hover:text-text-main transition-colors"
      >
        <span className="flex items-center gap-2">
          <span className={`material-symbols-outlined text-[14px] transition-transform ${collapsed ? '-rotate-90' : ''}`}>
            expand_more
          </span>
          {label}
        </span>
        <span className="bg-bg-hover/30 px-1.5 py-0.5 rounded text-[9px] text-text-muted/50 font-mono">
          {isLoading ? '...' : count}
        </span>
        {onAdd && (
          <button
            onClick={(e) => { e.stopPropagation(); onAdd() }}
            className="p-0.5 rounded text-text-muted/30 hover:text-primary hover:bg-primary/10 transition-colors"
            title="Create new table"
          >
            <span className="material-symbols-outlined text-[14px]">add</span>
          </button>
        )}
      </button>
      {!collapsed && <ul className="space-y-0.5">{children}</ul>}
    </div>
  )
}

export function TableTreeItem({
  name,
  connectionId,
  active,
  focused,
  onClick,
  onSettings,
  onContextMenu,
  keyType,
}: {
  name: string
  connectionId: string
  active?: boolean
  focused?: boolean
  onClick?: () => void
  onSettings?: () => void
  onContextMenu?: (e: React.MouseEvent) => void
  keyType?: string
}) {
  const { data: settings } = useSettings()
  const { t } = useTranslation((settings?.language as 'en' | 'vi') ?? 'en')
  const [expanded, setExpanded] = useState(false)
  const { data: columns, isLoading } = useColumns(connectionId, expanded ? name : '')

  const itemRef = useRef<HTMLLIElement>(null)
  useEffect(() => {
    if (focused && itemRef.current) itemRef.current.scrollIntoView({ block: 'nearest' })
  }, [focused])

  return (
    <li ref={itemRef} role="treeitem" tabIndex={-1} aria-selected={active || false}>
      <div
        onContextMenu={onContextMenu}
        className={`w-full flex items-center gap-0.5 px-1 py-1.5 text-[12px] rounded-md border-l-2 transition-all duration-150 group ${
          active
            ? 'text-text-main bg-bg-hover border-primary'
            : focused
              ? 'text-text-main bg-bg-hover/50 border-primary/50'
              : 'text-text-muted hover:text-text-main hover:bg-bg-hover/30 border-transparent'
        }`}
      >
        {!keyType ? (
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded) }}
            className="shrink-0 w-5 h-5 flex items-center justify-center rounded hover:bg-bg-hover/50 transition-colors"
          >
            <span className={`material-symbols-outlined text-[14px] text-text-muted/50 transition-transform ${expanded ? '' : '-rotate-90'}`}>
              expand_more
            </span>
          </button>
        ) : (
          <span className="shrink-0 w-5 h-5" />
        )}

        <button onClick={onClick} className="flex items-center gap-2 flex-1 min-w-0 text-left overflow-hidden">
          <span className={`material-symbols-outlined text-[15px] transition-colors shrink-0 ${active ? 'text-primary' : 'opacity-40 group-hover:opacity-70'}`}>
            {keyType ? 'key' : 'table_chart'}
          </span>
          <span className="truncate">{name}</span>
          {keyType && (
            <span className="text-[9px] px-1 rounded bg-white/10 text-text-muted ml-1 shrink-0">{keyType}</span>
          )}
        </button>

        {onSettings && (
          <span
            onClick={(e) => { e.stopPropagation(); onSettings() }}
            className="material-symbols-outlined text-[16px] text-text-muted/0 group-hover:text-text-muted hover:!text-primary transition-colors cursor-pointer shrink-0"
          >
            settings
          </span>
        )}
      </div>

      {expanded && (
        <ul className="ml-6 mt-0.5 mb-1 space-y-px border-l border-border-subtle/30 pl-2">
          {isLoading ? (
            <li className="flex items-center gap-2 px-2 py-1.5 text-[11px] text-text-muted/50">
              <span className="material-symbols-outlined text-[12px] animate-spin">progress_activity</span>
              Loading...
            </li>
          ) : columns && columns.length > 0 ? (
            columns.map((col) => (
              <li
                key={col.name}
                className="flex items-center gap-2 px-2 py-1 text-[11px] text-text-muted hover:text-text-main hover:bg-bg-hover/20 rounded transition-colors cursor-default"
                title={`${col.name} (${col.type})${col.primaryKey ? ' — Primary Key' : ''}${col.nullable ? ' — Nullable' : ''}`}
              >
                <span className={`material-symbols-outlined text-[12px] ${col.primaryKey ? 'text-amber-400' : 'text-text-muted/40'}`}>
                  {getColumnIcon(col.type, col.primaryKey)}
                </span>
                <span className="truncate flex-1">{col.name}</span>
                <span className="text-[9px] text-text-muted/30 font-mono shrink-0">{col.type}</span>
              </li>
            ))
          ) : (
            <li className="px-2 py-1.5 text-[11px] text-text-muted/40 italic">{t('sidebar.noColumns')}</li>
          )}
        </ul>
      )}
    </li>
  )
}

export function TreeItem({
  icon,
  label,
  active,
  focused,
  onClick,
}: {
  icon: string
  label: string
  active?: boolean
  focused?: boolean
  onClick?: () => void
}) {
  const itemRef = useRef<HTMLLIElement>(null)
  useEffect(() => {
    if (focused && itemRef.current) itemRef.current.scrollIntoView({ block: 'nearest' })
  }, [focused])

  return (
    <li ref={itemRef} role="treeitem" tabIndex={-1} aria-selected={active || false}>
      <button
        onClick={onClick}
        className={`w-full flex items-center gap-2 px-2 py-1.5 text-[12px] rounded-md border-l-2 transition-all duration-150 group ${
          active
            ? 'text-text-main bg-bg-hover border-primary'
            : focused
              ? 'text-text-main bg-bg-hover/50 border-primary/50'
              : 'text-text-muted hover:text-text-main hover:bg-bg-hover/30 border-transparent'
        }`}
      >
        <span className={`material-symbols-outlined text-[15px] transition-colors ${active ? 'text-primary' : 'opacity-40 group-hover:opacity-70'}`}>
          {icon}
        </span>
        <span className="truncate flex-1 text-left">{label}</span>
      </button>
    </li>
  )
}

export function DatabaseContextMenu({
  x,
  y,
  databaseName,
  t: translate,
  onExportDatabase,
  onImportDatabase,
  onClose,
}: {
  x: number
  y: number
  databaseName: string
  t: (key: TranslationKey) => string
  onExportDatabase: () => void
  onImportDatabase: () => void
  onClose: () => void
}) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
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
    top: Math.min(y, window.innerHeight - 150),
    zIndex: 100,
  }

  return (
    <div ref={menuRef} style={style} className="w-[210px] bg-bg-card border border-border-subtle/50 rounded-xl py-1.5 backdrop-blur-sm shadow-lg">
      <div className="px-4 py-1.5 text-[10px] font-medium text-text-muted uppercase tracking-wider truncate" title={databaseName}>
        {databaseName}
      </div>
      <div className="my-1.5 border-t border-border-subtle/30" />
      <button
        type="button"
        onClick={onExportDatabase}
        className="w-full flex items-center gap-3 px-4 py-2 text-[12px] text-left transition-colors text-text-main hover:bg-bg-hover/50"
      >
        <span className="material-symbols-outlined text-[14px] text-text-muted">download</span>
        {translate('context.exportDatabase')}
      </button>
      <button
        type="button"
        onClick={onImportDatabase}
        className="w-full flex items-center gap-3 px-4 py-2 text-[12px] text-left transition-colors text-text-main hover:bg-bg-hover/50"
      >
        <span className="material-symbols-outlined text-[14px] text-text-muted">upload</span>
        {translate('context.importDatabase')}
      </button>
    </div>
  )
}
