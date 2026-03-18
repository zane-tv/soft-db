import { useState, useCallback, useEffect, useRef } from 'react'
import { SidebarResizeHandle } from '@/components/SidebarResizeHandle'
import { useTables, useViews, useFunctions, useColumns, useExecuteQuery, useQueryHistory, useSwitchDatabase } from '@/hooks/useSchema'
import { useConnections } from '@/hooks/useConnections'
import { ExplorerSidebar } from '@/components/ExplorerSidebar'
import { EditorTabBar } from '@/components/EditorTabBar'
import { SqlEditor } from '@/components/SqlEditor'
import { ResultsGrid } from '@/components/ResultsGrid'
import { ResizeHandle } from '@/components/ResizeHandle'
import { StructureDesignerModal } from '@/components/StructureDesignerModal'
import { SettingsModal } from '@/components/SettingsModal'
import { QueryHistoryDrawer } from '@/components/QueryHistoryDrawer'
import { AIChatPanel } from '@/components/AIChatPanel'
import { ConfirmModal } from '@/components/ConfirmModal'
import { useSettingsContext } from '@/hooks/useSettings'
import { detectEditableTable } from '@/hooks/useEditableGrid'
import * as EditService from '../../bindings/soft-db/services/editservice'
import * as QueryService from '../../bindings/soft-db/services/queryservice'
import type { QueryResult, TableInfo, FunctionInfo, ColumnInfo } from '../../bindings/soft-db/internal/driver/models'

// ─── Types ───
interface QueryTab {
  id: string
  title: string
  query: string
  result: QueryResult | null
  lastExecutedQuery: string
  pkColumns: string[]
  isFullView?: boolean
  fullViewTable?: string
  fullViewPage?: number
  fullViewPageSize?: number
  fullViewTotalRows?: number
  fullViewTotalPages?: number
}

interface TableExplorerProps {
  connectionId: string
}

// ─── Module-level state cache (survives remounts) ───
interface ExplorerState {
  tabs: QueryTab[]
  activeTabId: string
  selectedTable: string | null
  selectedDatabase: string | null
  sidebarCollapsed: boolean
  sidebarWidth: number
}
const explorerStateCache = new Map<string, ExplorerState>()


export function TableExplorer({ connectionId }: TableExplorerProps) {

  // Data hooks
  const { data: connections = [] } = useConnections()
  const { data: tables = [], isLoading: tablesLoading } = useTables(connectionId)
  const { data: views = [] } = useViews(connectionId)
  const { data: functions = [] } = useFunctions(connectionId)
  const executeMutation = useExecuteQuery()
  // Mount useQueryHistory here (not just in the drawer) so there is always an
  // active observer — this lets onSettled's refetchQueries trigger immediately
  // even when the Activity Log drawer is closed.
  useQueryHistory(connectionId)
  const switchDbMutation = useSwitchDatabase()
  const { settings } = useSettingsContext()

  const conn = connections.find((c) => c.id === connectionId)
  const fileExt = conn?.type === 'mongodb' ? 'json' : 'sql'

  // ─── State (initialized from cache if available) ───
  const cached = explorerStateCache.get(connectionId)
  const [selectedTable, setSelectedTable] = useState<string | null>(cached?.selectedTable ?? null)
  const [selectedDatabase, setSelectedDatabase] = useState<string | null>(cached?.selectedDatabase ?? null)
  const [tabs, setTabs] = useState<QueryTab[]>(cached?.tabs ?? [
    { id: '1', title: `Query 1.${fileExt}`, query: '', result: null, lastExecutedQuery: '', pkColumns: [] },
  ])
  const [activeTabId, setActiveTabId] = useState(cached?.activeTabId ?? '1')
  const [isExecuting, setIsExecuting] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(cached?.sidebarCollapsed ?? false)
  const [sidebarWidthPx, setSidebarWidthPx] = useState(cached?.sidebarWidth ?? 220)
  const [structureTable, setStructureTable] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [aiPanelOpen, setAiPanelOpen] = useState(false)
  const [aiPrefill, setAiPrefill] = useState('')
  const [confirmQuery, setConfirmQuery] = useState<{ query: string; message: string } | null>(null)

  // ─── Sync state to cache on changes ───
  useEffect(() => {
    explorerStateCache.set(connectionId, { tabs, activeTabId, selectedTable, selectedDatabase, sidebarCollapsed, sidebarWidth: sidebarWidthPx })
  }, [connectionId, tabs, activeTabId, selectedTable, selectedDatabase, sidebarCollapsed, sidebarWidthPx])

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

  // ─── Sidebar Horizontal Resize ───
  const handleSidebarResize = useCallback((deltaX: number) => {
    setSidebarWidthPx((prev) => {
      const next = prev + deltaX
      return Math.max(160, Math.min(400, next))
    })
  }, [])

  const resetSidebarWidth = useCallback(() => setSidebarWidthPx(220), [])

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0]

  // Fetch columns — use fullView table name if in full view mode
  const columnsTable = activeTab?.isFullView ? (activeTab.fullViewTable || '') : (selectedTable || '')
  const { data: columnInfos = [] } = useColumns(connectionId, columnsTable)

  // ─── Query Execution ───
  // Core execute function (no confirm check)
  const doExecuteQuery = useCallback(async (queryToRun: string) => {
    setIsExecuting(true)
    // ── Auto-add LIMIT to SELECT queries ──
    let finalQuery = queryToRun
    if (settings.autoLimit && conn?.type !== 'mongodb') {
      const isSelect = /^\s*select\b/i.test(finalQuery)
      const hasLimit = /\blimit\b/i.test(finalQuery)
      if (isSelect && !hasLimit) {
        finalQuery = finalQuery.replace(/;?\s*$/, ` LIMIT ${settings.defaultLimit};`)
      }
    }
    try {
      const result = await executeMutation.mutateAsync({
        connectionId,
        query: finalQuery,
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
    }
  }, [activeTabId, connectionId, executeMutation, settings, conn])

  // Entry point with confirm check
  const handleExecute = useCallback(async () => {
    if (!activeTab?.query.trim() || isExecuting) return
    const queryText = activeTab.query.trim()

    // ── Confirm dangerous queries (DROP, TRUNCATE, ALTER) ──
    if (settings.confirmDangerous) {
      const dangerousPattern = /^\s*(drop|truncate|alter)\b/i
      if (dangerousPattern.test(queryText)) {
        setConfirmQuery({
          query: queryText,
          message: queryText.substring(0, 300) + (queryText.length > 300 ? '...' : ''),
        })
        return
      }
    }
    doExecuteQuery(queryText)
  }, [activeTab, isExecuting, settings.confirmDangerous, doExecuteQuery])

  const handleConfirmExecute = useCallback(() => {
    if (confirmQuery) {
      doExecuteQuery(confirmQuery.query)
      setConfirmQuery(null)
    }
  }, [confirmQuery, doExecuteQuery])

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
    setTabs((prev) => [...prev, { id, title: `Query ${num}.${fileExt}`, query: '', result: null, lastExecutedQuery: '', pkColumns: [] }])
    setActiveTabId(id)
  }, [tabs.length, fileExt])

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
      const q = conn?.type === 'mysql' || conn?.type === 'mariadb' ? '`' : '"'
      updateQuery(`SELECT *\nFROM ${q}${tableName}${q}\nLIMIT ${settings.defaultLimit};`)
    }
  }, [updateQuery, settings.defaultLimit, conn?.type])

  // ── Full View ──
  const handleViewFullData = useCallback(async (tableName: string) => {
    // Check if a full view tab for this table already exists
    const existingTab = tabs.find(t => t.isFullView && t.fullViewTable === tableName)
    if (existingTab) {
      setActiveTabId(existingTab.id)
      return
    }

    const tabId = String(Date.now())
    const pageSize = 25
    const page = 1

    // Create the tab immediately with loading state
    const newTab: QueryTab = {
      id: tabId,
      title: tableName,
      query: '',
      result: null,
      lastExecutedQuery: '',
      pkColumns: [],
      isFullView: true,
      fullViewTable: tableName,
      fullViewPage: page,
      fullViewPageSize: pageSize,
      fullViewTotalRows: 0,
      fullViewTotalPages: 1,
    }
    setTabs(prev => [...prev, newTab])
    setActiveTabId(tabId)
    setSelectedTable(tableName)

    try {
      // Fetch paginated data + PK columns in parallel
      const [paginatedResult, pks] = await Promise.all([
        QueryService.ExecutePaginatedQuery(connectionId, tableName, page, pageSize),
        EditService.GetTablePrimaryKey(connectionId, tableName).catch(() => [] as string[]),
      ])

      if (paginatedResult) {
        setTabs(prev => prev.map(t => t.id === tabId ? {
          ...t,
          result: {
            columns: paginatedResult.columns,
            rows: paginatedResult.rows,
            rowCount: paginatedResult.rowCount,
            affectedRows: paginatedResult.affectedRows,
            executionTime: paginatedResult.executionTime,
            error: paginatedResult.error || '',
          } as QueryResult,
          pkColumns: pks || [],
          fullViewTotalRows: paginatedResult.totalRows,
          fullViewTotalPages: paginatedResult.totalPages,
        } : t))
      }
    } catch (err) {
      setTabs(prev => prev.map(t => t.id === tabId ? {
        ...t,
        result: {
          columns: [], rows: [], rowCount: 0, affectedRows: 0, executionTime: 0,
          error: err instanceof Error ? err.message : String(err),
        } as QueryResult,
      } : t))
    }
  }, [connectionId, tabs])

  // ── Full View Page Change ──
  const handlePageChange = useCallback(async (newPage: number) => {
    if (!activeTab?.isFullView || !activeTab.fullViewTable) return
    const tableName = activeTab.fullViewTable
    const pageSize = activeTab.fullViewPageSize || 25

    setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, fullViewPage: newPage } : t))

    try {
      const result = await QueryService.ExecutePaginatedQuery(connectionId, tableName, newPage, pageSize)
      if (result) {
        setTabs(prev => prev.map(t => t.id === activeTabId ? {
          ...t,
          result: {
            columns: result.columns, rows: result.rows,
            rowCount: result.rowCount, affectedRows: result.affectedRows,
            executionTime: result.executionTime, error: result.error || '',
          } as QueryResult,
          fullViewPage: result.page,
          fullViewTotalRows: result.totalRows,
          fullViewTotalPages: result.totalPages,
        } : t))
      }
    } catch { /* keep current data */ }
  }, [activeTab, activeTabId, connectionId])

  // ── Full View Page Size Change ──
  const handlePageSizeChange = useCallback(async (newSize: number) => {
    if (!activeTab?.isFullView || !activeTab.fullViewTable) return
    const tableName = activeTab.fullViewTable

    setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, fullViewPageSize: newSize, fullViewPage: 1 } : t))

    try {
      const result = await QueryService.ExecutePaginatedQuery(connectionId, tableName, 1, newSize)
      if (result) {
        setTabs(prev => prev.map(t => t.id === activeTabId ? {
          ...t,
          result: {
            columns: result.columns, rows: result.rows,
            rowCount: result.rowCount, affectedRows: result.affectedRows,
            executionTime: result.executionTime, error: result.error || '',
          } as QueryResult,
          fullViewPage: 1,
          fullViewPageSize: newSize,
          fullViewTotalRows: result.totalRows,
          fullViewTotalPages: result.totalPages,
        } : t))
      }
    } catch { /* keep current data */ }
  }, [activeTab, activeTabId, connectionId])

  // ── Attach to AI Chat ──
  const handleAttachToAI = useCallback((tableName: string) => {
    setAiPanelOpen(true)
    setAiPrefill(`@${tableName} `)
  }, [])

  // ── Full View Refresh (for edit mode onDataChange) ──
  const handleFullViewRefresh = useCallback(async () => {
    if (!activeTab?.isFullView || !activeTab.fullViewTable) return
    await handlePageChange(activeTab.fullViewPage || 1)
  }, [activeTab, handlePageChange])

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
        selectedDatabase={selectedDatabase}
        collapsed={sidebarCollapsed}
        sidebarWidth={sidebarWidthPx}
        onTableClick={handleTableClick}
        onStructureOpen={setStructureTable}
        onSettingsOpen={() => setSettingsOpen(true)}
        onCreateTable={() => setStructureTable('__new__')}
        onDatabaseSelect={(db) => {
          setSelectedDatabase(db)
          switchDbMutation.mutate({ connectionId, database: db })
        }}
        onViewFullData={handleViewFullData}
        onAttachToAI={handleAttachToAI}
      />

      {/* Sidebar Resize Handle */}
      {!sidebarCollapsed && (
        <SidebarResizeHandle onResize={handleSidebarResize} onDoubleClick={resetSidebarWidth} />
      )}

      {/* Main Content */}
      <main ref={mainRef} className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Editor Pane — hidden for Full View tabs */}
        {!activeTab.isFullView && (
          <>
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
                onAIToggle={() => setAiPanelOpen(!aiPanelOpen)}
                aiPanelOpen={aiPanelOpen}
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
                  connType={conn?.type as string}
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
                    <kbd className="bg-white/20 text-white/90 text-[10px] px-1.5 py-0.5 rounded ml-1 font-mono">{navigator.platform?.includes('Mac') ? '⌘E' : 'Ctrl+E'}</kbd>
                  </button>
                </div>
              </div>
            </div>

            {/* Resize Handle */}
            <ResizeHandle onResize={handleResize} onDoubleClick={resetResize} />
          </>
        )}

        {/* Full View Tab Bar (when in full view mode) */}
        {activeTab.isFullView && (
          <EditorTabBar
            tabs={tabs}
            activeTabId={activeTabId}
            sidebarCollapsed={sidebarCollapsed}
            onTabSelect={setActiveTabId}
            onTabClose={closeTab}
            onTabAdd={addTab}
            onHistoryOpen={() => setHistoryOpen(true)}
            onSidebarToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
            onAIToggle={() => setAiPanelOpen(!aiPanelOpen)}
            aiPanelOpen={aiPanelOpen}
          />
        )}

        {/* Results Pane */}
        <ResultsGrid
          queryResult={activeTab.result}
          query={activeTab.lastExecutedQuery}
          connectionId={connectionId}
          pkColumns={activeTab.pkColumns}
          columnInfos={columnInfos as ColumnInfo[]}
          onDataChange={activeTab.isFullView ? handleFullViewRefresh : handleExecute}
          pagination={activeTab.isFullView ? {
            page: activeTab.fullViewPage || 1,
            pageSize: activeTab.fullViewPageSize || 25,
            totalRows: activeTab.fullViewTotalRows || 0,
            totalPages: activeTab.fullViewTotalPages || 1,
          } : undefined}
          onPageChange={activeTab.isFullView ? handlePageChange : undefined}
          onPageSizeChange={activeTab.isFullView ? handlePageSizeChange : undefined}
        />
      </main>

      {/* AI Chat Panel (right sidebar) */}
      <AIChatPanel
        connectionId={connectionId}
        visible={aiPanelOpen}
        onClose={() => setAiPanelOpen(false)}
        onInsertToEditor={(code) => {
          const current = activeTab.query
          updateQuery(current ? current + '\n\n' + code : code)
        }}
        prefillText={aiPrefill}
        onPrefillConsumed={() => setAiPrefill('')}
      />

      {/* Structure Designer Modal */}
      <StructureDesignerModal
        open={!!structureTable}
        onClose={() => setStructureTable(null)}
        connectionId={connectionId}
        tableName={structureTable || ''}
        dbType={(conn?.type as string) || undefined}
        database={selectedDatabase || undefined}
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

      {/* Dangerous Query Confirm Modal */}
      <ConfirmModal
        open={!!confirmQuery}
        title="Dangerous Operation"
        message="This query contains a destructive operation that could permanently modify or remove data."
        detail={confirmQuery?.message}
        confirmText="Execute"
        cancelText="Cancel"
        variant="danger"
        onConfirm={handleConfirmExecute}
        onCancel={() => setConfirmQuery(null)}
      />
    </div>
  )
}
