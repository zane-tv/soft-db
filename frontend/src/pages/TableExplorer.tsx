import { useState, useCallback, useEffect, useRef } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useTables, useViews, useFunctions, useColumns, useExecuteQuery, useQueryHistory } from '@/hooks/useSchema'
import { useConnections } from '@/hooks/useConnections'
import { ExplorerSidebar } from '@/components/ExplorerSidebar'
import { EditorTabBar } from '@/components/EditorTabBar'
import { SqlEditor } from '@/components/SqlEditor'
import { ResultsGrid } from '@/components/ResultsGrid'
import { ResizeHandle } from '@/components/ResizeHandle'
import { StructureDesignerModal } from '@/components/StructureDesignerModal'
import { SettingsModal } from '@/components/SettingsModal'
import { QueryHistoryDrawer } from '@/components/QueryHistoryDrawer'
import { useSettingsContext } from '@/hooks/useSettings'
import { detectEditableTable } from '@/hooks/useEditableGrid'
import * as EditService from '../../bindings/soft-db/services/editservice'
import type { QueryResult, TableInfo, FunctionInfo, ColumnInfo } from '../../bindings/soft-db/internal/driver/models'

// ─── Types ───
interface QueryTab {
  id: string
  title: string
  query: string
  result: QueryResult | null
  lastExecutedQuery: string
  pkColumns: string[]
}

interface TableExplorerProps {
  connectionId: string
  onNavigateBack?: () => void
}

// ─── Module-level state cache (survives remounts) ───
interface ExplorerState {
  tabs: QueryTab[]
  activeTabId: string
  selectedTable: string | null
  sidebarCollapsed: boolean
}
const explorerStateCache = new Map<string, ExplorerState>()

const DEFAULT_TABS: QueryTab[] = [
  { id: '1', title: 'Query 1.sql', query: 'SELECT * FROM users\nWHERE status = \'active\'\nORDER BY created_at DESC\nLIMIT 50;', result: null, lastExecutedQuery: '', pkColumns: [] },
]

export function TableExplorer({ connectionId, onNavigateBack }: TableExplorerProps) {
  const navigate = useNavigate()

  // Data hooks
  const { data: connections = [] } = useConnections()
  const { data: tables = [], isLoading: tablesLoading } = useTables(connectionId)
  const { data: views = [] } = useViews(connectionId)
  const { data: functions = [] } = useFunctions(connectionId)
  const executeMutation = useExecuteQuery()
  const { refetch: refetchHistory } = useQueryHistory(connectionId)
  const { settings } = useSettingsContext()

  const conn = connections.find((c) => c.id === connectionId)

  // ─── State (initialized from cache if available) ───
  const cached = explorerStateCache.get(connectionId)
  const [selectedTable, setSelectedTable] = useState<string | null>(cached?.selectedTable ?? null)
  const [tabs, setTabs] = useState<QueryTab[]>(cached?.tabs ?? DEFAULT_TABS)
  const [activeTabId, setActiveTabId] = useState(cached?.activeTabId ?? '1')
  const [isExecuting, setIsExecuting] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(cached?.sidebarCollapsed ?? false)
  const [structureTable, setStructureTable] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  // ─── Sync state to cache on changes ───
  useEffect(() => {
    explorerStateCache.set(connectionId, { tabs, activeTabId, selectedTable, sidebarCollapsed })
  }, [connectionId, tabs, activeTabId, selectedTable, sidebarCollapsed])

  // ─── Resizable Pane ───
  const mainRef = useRef<HTMLElement>(null)
  const [editorHeightPx, setEditorHeightPx] = useState<number | null>(null) // null = use 40% default

  const handleResize = useCallback((deltaY: number) => {
    if (!mainRef.current) return
    const totalHeight = mainRef.current.clientHeight
    setEditorHeightPx((prev) => {
      const current = prev ?? totalHeight * 0.4
      const next = current + deltaY
      const min = totalHeight * 0.15
      const max = totalHeight * 0.85
      return Math.max(min, Math.min(max, next))
    })
  }, [])

  const resetResize = useCallback(() => setEditorHeightPx(null), [])

  // Fetch columns for the selected table (for AddRecordModal)
  const { data: columnInfos = [] } = useColumns(connectionId, selectedTable || '')

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0]

  // ─── Query Execution ───
  const handleExecute = useCallback(async () => {
    if (!activeTab?.query.trim() || isExecuting) return
    setIsExecuting(true)
    try {
      const result = await executeMutation.mutateAsync({
        connectionId,
        query: activeTab.query,
      })
      if (result) {
        // Detect editable table and fetch PK columns
        let pks: string[] = []
        const tableName = detectEditableTable(activeTab.query)
        if (tableName && !result.error) {
          try {
            pks = (await EditService.GetTablePrimaryKey(connectionId, tableName)) || []
          } catch {
            pks = []
          }
        }

        // Save result INTO the active tab
        setTabs((prev) =>
          prev.map((t) =>
            t.id === activeTabId
              ? { ...t, result, lastExecutedQuery: activeTab.query, pkColumns: pks }
              : t
          )
        )
      }
      refetchHistory()
    } catch (err) {
      const errorResult = {
        columns: [],
        rows: [],
        rowCount: 0,
        affectedRows: 0,
        executionTime: 0,
        error: err instanceof Error ? err.message : String(err),
      } as QueryResult

      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeTabId
            ? { ...t, result: errorResult, lastExecutedQuery: activeTab.query, pkColumns: [] }
            : t
        )
      )
    } finally {
      setIsExecuting(false)
      refetchHistory()
    }
  }, [activeTab, activeTabId, connectionId, executeMutation, isExecuting, refetchHistory])

  // Keyboard shortcut: Ctrl/Cmd+E to execute (global fallback)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'e') {
        e.preventDefault()
        handleExecute()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleExecute])

  // ─── Tab Management ───
  const updateQuery = useCallback((query: string) => {
    setTabs((prev) => prev.map((t) => (t.id === activeTabId ? { ...t, query } : t)))
  }, [activeTabId])

  const addTab = useCallback(() => {
    const id = String(Date.now())
    const num = tabs.length + 1
    setTabs((prev) => [...prev, { id, title: `Query ${num}.sql`, query: '', result: null, lastExecutedQuery: '', pkColumns: [] }])
    setActiveTabId(id)
  }, [tabs.length])

  const closeTab = useCallback((tabId: string) => {
    if (tabs.length <= 1) return
    setTabs((prev) => {
      const filtered = prev.filter((t) => t.id !== tabId)
      if (activeTabId === tabId) setActiveTabId(filtered[0].id)
      return filtered
    })
  }, [tabs.length, activeTabId])

  const handleTableClick = useCallback((tableName: string) => {
    setSelectedTable(tableName)
    if (conn?.type === 'mongodb') {
      updateQuery(`{ "collection": "${tableName}", "action": "find", "limit": ${settings.defaultLimit} }`)
    } else {
      updateQuery(`SELECT *\nFROM ${tableName}\nLIMIT ${settings.defaultLimit};`)
    }
  }, [updateQuery, settings.defaultLimit, conn?.type])

  // Editor height style
  const editorStyle = editorHeightPx != null
    ? { height: `${editorHeightPx}px` }
    : { height: '40%' }

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* Sidebar */}
      <ExplorerSidebar
        connName={conn?.name}
        connType={conn?.type as string}
        connectionId={connectionId}
        tables={tables as TableInfo[]}
        views={views as string[]}
        functions={functions as FunctionInfo[]}
        tablesLoading={tablesLoading}
        selectedTable={selectedTable}
        collapsed={sidebarCollapsed}
        onTableClick={handleTableClick}
        onStructureOpen={setStructureTable}
        onNavigateBack={onNavigateBack || (() => navigate({ to: '/' }))}
        onSettingsOpen={() => setSettingsOpen(true)}
        onCreateTable={() => setStructureTable('__new__')}
      />

      {/* Main Content */}
      <main ref={mainRef} className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Editor Pane (resizable) */}
        <div className="flex flex-col bg-bg-editor relative shrink-0" style={editorStyle}>
          <EditorTabBar
            tabs={tabs}
            activeTabId={activeTabId}
            sidebarCollapsed={sidebarCollapsed}
            onTabSelect={setActiveTabId}
            onTabClose={closeTab}
            onTabAdd={addTab}
            onHistoryOpen={() => setHistoryOpen(true)}
            onSidebarToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
          />

          {/* Code Editor */}
          <div className="flex-1 overflow-hidden relative">
            <SqlEditor
              value={activeTab?.query || ''}
              onChange={updateQuery}
              onExecute={handleExecute}
              tables={tables as TableInfo[]}
              views={views as string[]}
              functions={functions as FunctionInfo[]}
              connectionId={connectionId}
            />

            {/* Floating Run Button */}
            <div className="absolute bottom-4 right-4 z-10">
              <button
                onClick={handleExecute}
                disabled={isExecuting || !activeTab?.query.trim()}
                className="flex items-center gap-2 bg-gradient-to-r from-primary to-primary-hover hover:brightness-110 text-white px-5 py-2.5 rounded-full transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span className={`material-symbols-outlined text-[20px] ${isExecuting ? 'animate-spin' : ''}`}>
                  {isExecuting ? 'sync' : 'play_arrow'}
                </span>
                <span className="font-medium text-sm">{isExecuting ? 'Running...' : 'Run Query'}</span>
                <kbd className="bg-white/20 text-white/90 text-[10px] px-1.5 py-0.5 rounded ml-1 font-mono">⌘E</kbd>
              </button>
            </div>
          </div>
        </div>

        {/* Resize Handle */}
        <ResizeHandle onResize={handleResize} onDoubleClick={resetResize} />

        {/* Results Pane (fills remaining space) */}
        <ResultsGrid
          queryResult={activeTab.result}
          query={activeTab.lastExecutedQuery}
          connectionId={connectionId}
          pkColumns={activeTab.pkColumns}
          columnInfos={columnInfos as ColumnInfo[]}
          onDataChange={handleExecute}
        />
      </main>

      {/* Structure Designer Modal */}
      <StructureDesignerModal
        open={!!structureTable}
        onClose={() => setStructureTable(null)}
        connectionId={connectionId}
        tableName={structureTable || ''}
        dbType={(conn?.type as string) || undefined}
      />

      {/* Query History Drawer */}
      <QueryHistoryDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        connectionId={connectionId}
        connName={conn?.name}
        connType={conn?.type as string}
        onUseQuery={(query) => {
          updateQuery(query)
          setHistoryOpen(false)
        }}
      />

      {/* Settings Modal */}
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  )
}
