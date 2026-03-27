import { useState, useEffect, useRef, useCallback } from 'react'
import { useColumns, useHasMultiDB, useDatabases, useTablesForDB, useDropTable } from '@/hooks/useSchema'
import { useSettings } from '@/hooks/useSettings'
import { useTranslation, type TranslationKey } from '@/lib/i18n'
import { TableContextMenu } from './TableContextMenu'
import { ConfirmDialog } from './ConfirmDialog'
import { ExportModal } from './ExportModal'
import { ImportModal } from './ImportModal'

// ─── Types ───
interface ExplorerSidebarProps {
  connName?: string
  connType?: string
  connectionId: string
  tables: { name: string; type?: string }[]
  views: string[]
  functions: { name: string }[]
  tablesLoading?: boolean
  selectedTable: string | null
  selectedDatabase?: string | null
  collapsed: boolean
  sidebarWidth?: number
  onTableClick: (name: string) => void
  onStructureOpen: (name: string) => void
  onSettingsOpen?: () => void
  onCreateTable?: () => void
  onDatabaseSelect?: (database: string) => void
  onViewFullData?: (name: string) => void
  onAttachToAI?: (name: string) => void
}

export function ExplorerSidebar({
  connName,
  connType,
  connectionId,
  tables,
  views,
  functions,
  tablesLoading,
  selectedTable,
  selectedDatabase,
  collapsed,
  sidebarWidth = 220,
  onTableClick,
  onStructureOpen,
  onSettingsOpen,
  onCreateTable,
  onDatabaseSelect,
  onViewFullData,
  onAttachToAI,
}: ExplorerSidebarProps) {
  const { data: settings } = useSettings()
  const { t } = useTranslation((settings?.language as 'en' | 'vi') ?? 'en')
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; tableName: string; databaseName?: string } | null>(null)
  const [dbContextMenu, setDbContextMenu] = useState<{ x: number; y: number; databaseName: string } | null>(null)

  const [exportOpen, setExportOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [modalDbName, setModalDbName] = useState<string | undefined>()
  const [exportTables, setExportTables] = useState<string[]>([])
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const dropTable = useDropTable()

  const handleDropTableConfirm = useCallback(async () => {
    if (!dropTarget) return
    try {
      await dropTable.mutateAsync({ connectionId, table: dropTarget })
    } finally {
      setDropTarget(null)
    }
  }, [dropTarget, connectionId, dropTable])

  const handleTableContextMenu = (e: React.MouseEvent, tableName: string, databaseName?: string) => {
    e.preventDefault()
    e.stopPropagation()
    setDbContextMenu(null)
    setContextMenu({ x: e.clientX, y: e.clientY, tableName, databaseName: databaseName || selectedDatabase || undefined })
  }

  const handleDbContextMenu = (e: React.MouseEvent, databaseName: string) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu(null)
    setDbContextMenu({ x: e.clientX, y: e.clientY, databaseName })
  }

  const handleExportTable = (tableName: string, databaseName?: string) => {
    setModalDbName(databaseName || selectedDatabase || undefined)
    setExportTables([tableName])
    setExportOpen(true)
  }

  const handleExportDatabase = (databaseName: string) => {
    setModalDbName(databaseName)
    setExportTables([])
    setExportOpen(true)
  }

  const handleImportDatabase = (databaseName: string) => {
    setModalDbName(databaseName)
    setImportOpen(true)
  }

  const { data: hasMultiDB } = useHasMultiDB(connectionId)
  const isRedis = connType === 'redis'

  return (
    <aside
      className={`flex-shrink-0 flex flex-col border-r border-border-subtle/30 bg-bg-app overflow-hidden ${collapsed ? 'w-0' : ''}`}
      style={collapsed ? undefined : { width: `${sidebarWidth}px` }}
    >
      {/* DB Header */}
      <div className="h-10 flex items-center gap-2 px-3.5 border-b border-border-subtle/20 shrink-0">
        <div className="flex-1 min-w-0">
          <span className="text-[12px] font-semibold text-text-main truncate block leading-tight">{connName || 'Database'}</span>
          <span className="text-[10px] text-text-muted/60 font-mono flex items-center gap-1">
            <span className="w-1 h-1 rounded-full bg-success" />
            {connType || 'Unknown'}
          </span>
        </div>
      </div>

      {/* Object Tree */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-2 px-2 space-y-3">
        {hasMultiDB ? (
          <MultiDBTree
            connectionId={connectionId}
            selectedTable={selectedTable}
            selectedDatabase={selectedDatabase || null}
            onTableClick={onTableClick}
            onStructureOpen={onStructureOpen}
            onDatabaseSelect={onDatabaseSelect}
            onTableContextMenu={handleTableContextMenu}
            onDbContextMenu={handleDbContextMenu}
          />
        ) : (
          <>
            <TreeSection label={isRedis ? t('explorer.keys') : 'Tables'} icon="table_chart" count={tables.length} isLoading={tablesLoading} onAdd={isRedis ? undefined : onCreateTable}>
              {tables.map((tbl) => (
                <TableTreeItem
                  key={tbl.name}
                  name={tbl.name}
                  keyType={isRedis && tbl.type ? tbl.type : undefined}
                  connectionId={connectionId}
                  active={selectedTable === tbl.name}
                  onClick={() => onTableClick(tbl.name)}
                  onSettings={() => onStructureOpen(tbl.name)}
                  onContextMenu={(e) => handleTableContextMenu(e, tbl.name)}
                />
              ))}
            </TreeSection>

            <TreeSection label="Views" icon="visibility" count={views.length}>
              {views.map((v) => (
                <TreeItem key={v} icon="visibility" label={v} onClick={() => onTableClick(v)} />
              ))}
            </TreeSection>

            <TreeSection label="Functions" icon="functions" count={functions.length}>
              {functions.map((f) => (
                <TreeItem key={f.name} icon="functions" label={f.name} />
              ))}
            </TreeSection>
          </>
        )}
      </div>

      {/* Settings Footer */}
      <div className="h-9 flex items-center px-2.5 border-t border-border-subtle/20 shrink-0">
        <button
          onClick={onSettingsOpen}
          className="flex items-center gap-1.5 px-2 py-1 rounded-md text-text-muted/50 hover:text-text-main hover:bg-bg-hover/30 transition-colors text-[11px]"
        >
          <span className="material-symbols-outlined text-[14px]">settings</span>
          <span>{t('sidebar.settings')}</span>
        </button>
      </div>

      {contextMenu && (
        <TableContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          tableName={contextMenu.tableName}
          t={t}
          onViewFullData={() => onViewFullData?.(contextMenu.tableName)}
          onAttachToAI={() => onAttachToAI?.(contextMenu.tableName)}
          onOpenStructure={() => onStructureOpen(contextMenu.tableName)}
          onCopyName={() => navigator.clipboard.writeText(contextMenu.tableName)}
          onExportTable={() => handleExportTable(contextMenu.tableName, contextMenu.databaseName)}
          onDropTable={() => setDropTarget(contextMenu.tableName)}
          onClose={() => setContextMenu(null)}
        />
      )}

      <ConfirmDialog
        open={!!dropTarget}
        title={t('dropTable.title')}
        message={t('dropTable.message').replace('{table}', dropTarget || '')}
        confirmLabel={t('dropTable.confirm')}
        danger
        icon="delete_forever"
        onConfirm={handleDropTableConfirm}
        onCancel={() => setDropTarget(null)}
      />

      {dbContextMenu && (
        <DatabaseContextMenu
          x={dbContextMenu.x}
          y={dbContextMenu.y}
          databaseName={dbContextMenu.databaseName}
          t={t}
          onExportDatabase={() => { handleExportDatabase(dbContextMenu.databaseName); setDbContextMenu(null) }}
          onImportDatabase={() => { handleImportDatabase(dbContextMenu.databaseName); setDbContextMenu(null) }}
          onClose={() => setDbContextMenu(null)}
        />
      )}

      <ExportModal
        open={exportOpen}
        onClose={() => { setExportOpen(false); setExportTables([]) }}
        mode="database"
        connectionId={connectionId}
        databaseName={modalDbName}
        tables={exportTables}
        dbType={connType}
      />

      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        mode="database"
        connectionId={connectionId}
        databaseName={modalDbName}
      />
    </aside>
  )
}

// ─── MultiDBTree: 3-level tree (Connection → Database → Tables) ───
function MultiDBTree({
  connectionId,
  selectedTable,
  selectedDatabase,
  onTableClick,
  onStructureOpen,
  onDatabaseSelect,
  onTableContextMenu,
  onDbContextMenu,
}: {
  connectionId: string
  selectedTable: string | null
  selectedDatabase: string | null
  onTableClick: (name: string) => void
  onStructureOpen: (name: string) => void
  onDatabaseSelect?: (database: string) => void
  onTableContextMenu?: (e: React.MouseEvent, tableName: string, databaseName?: string) => void
  onDbContextMenu?: (e: React.MouseEvent, databaseName: string) => void
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
        />
      ))}
    </TreeSection>
  )
}

// ─── DatabaseTreeItem: Expandable database node ───
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
}) {
  const { data: settings } = useSettings()
  const { t } = useTranslation((settings?.language as 'en' | 'vi') ?? 'en')
  const [expanded, setExpanded] = useState(false)
  const { data: tables = [], isLoading } = useTablesForDB(connectionId, expanded ? name : '')

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
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded) }}
          className="shrink-0 w-5 h-5 flex items-center justify-center rounded hover:bg-bg-hover/50 transition-colors"
        >
          <span className={`material-symbols-outlined text-[14px] text-text-muted/50 transition-transform ${expanded ? '' : '-rotate-90'}`}>
            expand_more
          </span>
        </button>

        <button
          onClick={() => { onSelect?.(); setExpanded(true) }}
          className="flex items-center gap-2 flex-1 min-w-0 text-left"
        >
          <span className={`material-symbols-outlined text-[15px] transition-colors ${active ? 'text-primary' : 'opacity-40 group-hover:opacity-70'}`}>
            database
          </span>
          <span className="truncate">{name}</span>
        </button>
      </div>

      {/* Expanded tables */}
      {expanded && (
        <ul className="ml-4 mt-0.5 mb-1 space-y-0.5 border-l border-border-subtle/30 pl-1">
          {isLoading ? (
            <li className="flex items-center gap-2 px-2 py-1.5 text-[11px] text-text-muted/50">
              <span className="material-symbols-outlined text-[12px] animate-spin">progress_activity</span>
              Loading...
            </li>
          ) : tables.length > 0 ? (
            tables.map((t: { name: string }) => (
              <TableTreeItem
                key={t.name}
                name={t.name}
                connectionId={connectionId}
                active={selectedTable === t.name}
                onClick={() => onTableClick(t.name)}
                onSettings={() => onStructureOpen(t.name)}
                onContextMenu={onTableContextMenu ? (e) => onTableContextMenu(e, t.name, name) : undefined}
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

// ─── TreeSection ───
function TreeSection({
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

// ─── TableTreeItem (with expandable columns) ───
function TableTreeItem({
  name,
  connectionId,
  active,
  onClick,
  onSettings,
  onContextMenu,
  keyType,
}: {
  name: string
  connectionId: string
  active?: boolean
  onClick?: () => void
  onSettings?: () => void
  onContextMenu?: (e: React.MouseEvent) => void
  keyType?: string
}) {
  const { data: settings } = useSettings()
  const { t } = useTranslation((settings?.language as 'en' | 'vi') ?? 'en')
  const [expanded, setExpanded] = useState(false)
  const { data: columns, isLoading } = useColumns(connectionId, expanded ? name : '')

  return (
    <li>
      <div
        onContextMenu={onContextMenu}
        className={`w-full flex items-center gap-0.5 px-1 py-1.5 text-[12px] rounded-md border-l-2 transition-all duration-150 group ${
          active
            ? 'text-text-main bg-bg-hover border-primary'
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

        {/* Settings icon */}
        {onSettings && (
          <span
            onClick={(e) => { e.stopPropagation(); onSettings() }}
            className="material-symbols-outlined text-[16px] text-text-muted/0 group-hover:text-text-muted hover:!text-primary transition-colors cursor-pointer shrink-0"
          >
            settings
          </span>
        )}
      </div>

      {/* Expanded columns */}
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

// ─── TreeItem (simple, for views/functions) ───
function TreeItem({
  icon,
  label,
  active,
  onClick,
}: {
  icon: string
  label: string
  active?: boolean
  onClick?: () => void
}) {
  return (
    <li>
      <button
        onClick={onClick}
        className={`w-full flex items-center gap-2 px-2 py-1.5 text-[12px] rounded-md border-l-2 transition-all duration-150 group ${
          active
            ? 'text-text-main bg-bg-hover border-primary'
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

// ─── DatabaseContextMenu ───
function DatabaseContextMenu({
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

// ─── Helpers ───
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
