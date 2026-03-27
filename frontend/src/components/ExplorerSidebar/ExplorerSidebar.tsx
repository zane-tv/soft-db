import { useState, useRef, useCallback, useMemo } from 'react'
import { useHasMultiDB, useDropTable } from '@/hooks/useSchema'
import { useSettings } from '@/hooks/useSettings'
import { useTranslation } from '@/lib/i18n'
import { TableContextMenu } from '../TableContextMenu'
import { ConfirmDialog } from '../ConfirmDialog'
import { ExportModal } from '../ExportModal'
import { ImportModal } from '../ImportModal'
import { MultiDBTree, TreeSection, TableTreeItem, TreeItem, DatabaseContextMenu } from './TreeComponents'

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
  const [searchFilter, setSearchFilter] = useState('')
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const treeContainerRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
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

  const filterLower = searchFilter.toLowerCase()
  const filteredTables = useMemo(
    () => filterLower ? tables.filter((t) => t.name.toLowerCase().includes(filterLower)) : tables,
    [tables, filterLower],
  )
  const filteredViews = useMemo(
    () => filterLower ? views.filter((v) => v.toLowerCase().includes(filterLower)) : views,
    [views, filterLower],
  )
  const filteredFunctions = useMemo(
    () => filterLower ? functions.filter((f) => f.name.toLowerCase().includes(filterLower)) : functions,
    [functions, filterLower],
  )

  const flatItems = useMemo(() => [
    ...filteredTables.map((t) => ({ name: t.name, kind: 'table' as const })),
    ...filteredViews.map((v) => ({ name: v, kind: 'view' as const })),
    ...filteredFunctions.map((f) => ({ name: f.name, kind: 'function' as const })),
  ], [filteredTables, filteredViews, filteredFunctions])

  const handleTreeKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setSearchFilter('')
      setFocusedIndex(-1)
      searchInputRef.current?.focus()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setFocusedIndex((prev) => Math.min(prev + 1, flatItems.length - 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setFocusedIndex((prev) => Math.max(prev - 1, 0))
      return
    }
    if (e.key === 'Enter' && focusedIndex >= 0 && focusedIndex < flatItems.length) {
      e.preventDefault()
      const item = flatItems[focusedIndex]
      if (item.kind === 'table' || item.kind === 'view') {
        onTableClick(item.name)
      }
    }
  }, [flatItems, focusedIndex, onTableClick])

  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setSearchFilter('')
      setFocusedIndex(-1)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setFocusedIndex(0)
      treeContainerRef.current?.focus()
    }
  }, [])

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

      {/* Search Filter */}
      <div className="px-2 pt-2 pb-1 shrink-0">
        <div className="relative">
          <span className="material-symbols-outlined text-[14px] text-text-muted/40 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none">search</span>
          <input
            ref={searchInputRef}
            type="text"
            value={searchFilter}
            onChange={(e) => { setSearchFilter(e.target.value); setFocusedIndex(-1) }}
            onKeyDown={handleSearchKeyDown}
            placeholder={t('sidebar.settings') === 'Cài đặt' ? 'Tìm kiếm...' : 'Filter...'}
            aria-label="Filter tree items"
            className="w-full bg-bg-app/50 border border-border-subtle/30 rounded-md pl-7 pr-7 py-1.5 text-[11px] text-text-main placeholder:text-text-muted/40 focus:border-primary/50 focus:ring-1 focus:ring-primary/20 outline-none transition-all"
          />
          {searchFilter && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => { setSearchFilter(''); setFocusedIndex(-1) }}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-text-muted/40 hover:text-text-main p-0.5 rounded transition-colors"
            >
              <span className="material-symbols-outlined text-[12px]">close</span>
            </button>
          )}
        </div>
      </div>

      {/* Object Tree */}
      <div
        ref={treeContainerRef}
        role="tree"
        tabIndex={0}
        onKeyDown={handleTreeKeyDown}
        className="flex-1 overflow-y-auto overflow-x-hidden py-2 px-2 space-y-3 outline-none"
      >
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
            searchFilter={filterLower}
          />
        ) : (
          <>
            <TreeSection label={isRedis ? t('explorer.keys') : 'Tables'} icon="table_chart" count={filteredTables.length} isLoading={tablesLoading} onAdd={isRedis ? undefined : onCreateTable}>
              {filteredTables.map((tbl, idx) => (
                <TableTreeItem
                  key={tbl.name}
                  name={tbl.name}
                  keyType={isRedis && tbl.type ? tbl.type : undefined}
                  connectionId={connectionId}
                  active={selectedTable === tbl.name}
                  focused={focusedIndex === idx}
                  onClick={() => onTableClick(tbl.name)}
                  onSettings={() => onStructureOpen(tbl.name)}
                  onContextMenu={(e) => handleTableContextMenu(e, tbl.name)}
                />
              ))}
            </TreeSection>

            <TreeSection label="Views" icon="visibility" count={filteredViews.length}>
              {filteredViews.map((v, idx) => (
                <TreeItem key={v} icon="visibility" label={v} focused={focusedIndex === filteredTables.length + idx} onClick={() => onTableClick(v)} />
              ))}
            </TreeSection>

            <TreeSection label="Functions" icon="functions" count={filteredFunctions.length}>
              {filteredFunctions.map((f, idx) => (
                <TreeItem key={f.name} icon="functions" label={f.name} focused={focusedIndex === filteredTables.length + filteredViews.length + idx} />
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


