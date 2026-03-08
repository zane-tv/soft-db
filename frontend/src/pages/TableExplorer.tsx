import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { useParams, useNavigate } from '@tanstack/react-router'
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useTables, useViews, useFunctions, useExecuteQuery } from '@/hooks/useSchema'
import { useConnections } from '@/hooks/useConnections'
import { StructureDesignerModal } from '@/components/StructureDesignerModal'
import { QueryHistoryDrawer } from '@/components/QueryHistoryDrawer'
import type { QueryResult, ColumnMeta, TableInfo, FunctionInfo } from '../../bindings/soft-db/internal/driver/models'

// ─── Types ───
interface QueryTab {
  id: string
  title: string
  query: string
}

type Row = Record<string, unknown>

export function TableExplorer() {
  const { connectionId } = useParams({ from: '/explorer/$connectionId' })
  const navigate = useNavigate()

  // Data hooks
  const { data: connections = [] } = useConnections()
  const { data: tables = [], isLoading: tablesLoading } = useTables(connectionId)
  const { data: views = [] } = useViews(connectionId)
  const { data: functions = [] } = useFunctions(connectionId)
  const executeMutation = useExecuteQuery()

  // Find current connection info
  const conn = useMemo(() => connections.find((c) => c.id === connectionId), [connections, connectionId])

  // ─── State ───
  const [selectedTable, setSelectedTable] = useState<string | null>(null)
  const [tabs, setTabs] = useState<QueryTab[]>([
    { id: '1', title: 'Query 1.sql', query: 'SELECT * FROM users\nWHERE status = \'active\'\nORDER BY created_at DESC\nLIMIT 50;' },
  ])
  const [activeTabId, setActiveTabId] = useState('1')
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null)
  const [isExecuting, setIsExecuting] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [structureTable, setStructureTable] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const resultContainerRef = useRef<HTMLDivElement>(null)

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
      if (result) setQueryResult(result)
    } catch (err) {
      setQueryResult({
        columns: [],
        rows: [],
        rowCount: 0,
        affectedRows: 0,
        executionTime: 0,
        error: err instanceof Error ? err.message : String(err),
      } as QueryResult)
    } finally {
      setIsExecuting(false)
    }
  }, [activeTab, connectionId, executeMutation, isExecuting])

  // Keyboard shortcut: Ctrl/Cmd+E to execute
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
    setTabs((prev) => [...prev, { id, title: `Query ${num}.sql`, query: '' }])
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

  // Click on table → select + auto-fill query
  const handleTableClick = useCallback((tableName: string) => {
    setSelectedTable(tableName)
    const query = `SELECT *\nFROM ${tableName}\nLIMIT 100;`
    updateQuery(query)
  }, [updateQuery])

  // ─── TanStack Table for Results ───
  const columns = useMemo<ColumnDef<Row, unknown>[]>(() => {
    if (!queryResult?.columns?.length) return []
    return queryResult.columns.map((col: ColumnMeta) => ({
      accessorKey: col.name,
      header: col.name,
      meta: { type: col.type },
      cell: ({ getValue }: { getValue: () => unknown }) => {
        const val = getValue()
        if (val === null || val === undefined) {
          return (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-bg-hover/50 text-text-muted border border-border-subtle italic">
              NULL
            </span>
          )
        }
        if (typeof val === 'object') return JSON.stringify(val)
        return String(val)
      },
    }))
  }, [queryResult?.columns])

  const tableData = useMemo(() => (queryResult?.rows as Row[]) || [], [queryResult?.rows])

  const table = useReactTable({
    data: tableData,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  const { rows: tableRows } = table.getRowModel()

  // Virtual scrolling for large result sets
  const rowVirtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => resultContainerRef.current,
    estimateSize: () => 36,
    overscan: 20,
  })

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* ─── Sidebar ─── */}
      <aside
        className={`${sidebarCollapsed ? 'w-0' : 'w-[260px]'} flex-shrink-0 flex flex-col border-r border-border-subtle/50 bg-bg-app transition-all duration-300 overflow-hidden`}
      >
        {/* DB Header */}
        <div className="h-14 flex items-center px-4 border-b border-border-subtle/30 shrink-0">
          <button
            onClick={() => navigate({ to: '/' })}
            className="flex items-center gap-3 w-full p-2 hover:bg-bg-hover/50 rounded-lg transition-colors group"
          >
            <div className="size-8 rounded-full bg-gradient-to-br from-primary/20 to-primary/10 flex items-center justify-center border border-primary/20">
              <span className="material-symbols-outlined text-primary text-[18px]">database</span>
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-sm font-bold text-text-main truncate block">{conn?.name || 'Database'}</span>
              <span className="text-[11px] text-success font-mono flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-success" />
                {(conn?.type as string) || 'Unknown'}
              </span>
            </div>
            <span className="material-symbols-outlined text-text-muted group-hover:text-text-main transition-colors text-[18px]">chevron_left</span>
          </button>
        </div>

        {/* Object Tree */}
        <div className="flex-1 overflow-y-auto py-4 px-3 space-y-5">
          {/* Tables */}
          <TreeSection
            label="Tables"
            icon="table_chart"
            count={tables.length}
            isLoading={tablesLoading}
          >
            {(tables as TableInfo[]).map((t) => (
              <TreeItem
                key={t.name}
                icon="table_chart"
                label={t.name}
                active={selectedTable === t.name}
                onClick={() => handleTableClick(t.name)}
                onSettings={() => setStructureTable(t.name)}
              />
            ))}
          </TreeSection>

          {/* Views */}
          <TreeSection label="Views" icon="visibility" count={(views as string[]).length}>
            {(views as string[]).map((v) => (
              <TreeItem key={v} icon="visibility" label={v} onClick={() => handleTableClick(v)} />
            ))}
          </TreeSection>

          {/* Functions */}
          <TreeSection label="Functions" icon="functions" count={(functions as FunctionInfo[]).length}>
            {(functions as FunctionInfo[]).map((f) => (
              <TreeItem key={f.name} icon="functions" label={f.name} />
            ))}
          </TreeSection>
        </div>
      </aside>

      {/* ─── Main Content ─── */}
      <main className="flex-1 flex flex-col h-full overflow-hidden">
        {/* ─── Editor Pane (40%) ─── */}
        <div className="h-[40%] flex flex-col border-b border-border-subtle/50 bg-bg-editor relative">
          {/* Tab Bar */}
          <div className="h-10 flex items-center px-4 border-b border-border-subtle/30 bg-bg-app shrink-0">
            <div className="flex items-center gap-1 overflow-x-auto">
              {tabs.map((tab) => (
                <div
                  key={tab.id}
                  onClick={() => setActiveTabId(tab.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-t flex items-center gap-2 cursor-pointer transition-colors shrink-0 ${
                    tab.id === activeTabId
                      ? 'bg-bg-editor border-t-2 border-primary text-text-main'
                      : 'text-text-muted hover:text-text-main hover:bg-bg-hover/30'
                  }`}
                >
                  <span className={`material-symbols-outlined text-[14px] ${tab.id === activeTabId ? 'text-primary' : ''}`}>code</span>
                  {tab.title}
                  {tabs.length > 1 && (
                    <button
                      onClick={(e) => { e.stopPropagation(); closeTab(tab.id) }}
                      className="hover:text-text-main text-text-muted ml-1"
                    >
                      <span className="material-symbols-outlined text-[14px]">close</span>
                    </button>
                  )}
                </div>
              ))}
              <button
                onClick={addTab}
                className="px-3 py-1.5 text-text-muted hover:text-text-main text-xs font-medium rounded-t flex items-center gap-2 hover:bg-bg-hover/30 transition-colors"
              >
                <span className="material-symbols-outlined text-[14px]">add</span>
                New Query
              </button>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => setHistoryOpen(true)}
                className="text-text-muted hover:text-text-main transition-colors p-1 rounded hover:bg-white/5"
                title="Query History"
              >
                <span className="material-symbols-outlined text-[18px]">history</span>
              </button>
              <button
                onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                className="text-text-muted hover:text-text-main transition-colors p-1 rounded hover:bg-white/5"
                title="Toggle Sidebar"
              >
                <span className="material-symbols-outlined text-[18px]">
                  {sidebarCollapsed ? 'left_panel_open' : 'left_panel_close'}
                </span>
              </button>
            </div>
          </div>

          {/* Code Area */}
          <div className="flex-1 flex overflow-hidden relative">
            <textarea
              ref={editorRef}
              value={activeTab?.query || ''}
              onChange={(e) => updateQuery(e.target.value)}
              spellCheck={false}
              className="flex-1 bg-transparent text-text-main font-mono text-[13px] leading-7 p-4 resize-none outline-none border-0 focus:ring-0"
              placeholder="-- Write your SQL query here..."
            />

            {/* Floating Run Button */}
            <div className="absolute bottom-4 right-4 z-10">
              <button
                onClick={handleExecute}
                disabled={isExecuting || !activeTab?.query.trim()}
                className="flex items-center gap-2 bg-gradient-to-r from-primary to-primary-hover hover:brightness-110 text-white px-5 py-2.5 rounded-full shadow-lg transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
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

        {/* ─── Results Pane (60%) ─── */}
        <div className="flex-1 flex flex-col min-h-0 bg-bg-app">
          {/* Meta Bar */}
          <div className="h-10 flex items-center justify-between px-4 border-b border-border-subtle/30 bg-bg-app text-xs shrink-0">
            <div className="flex items-center gap-4 text-text-muted">
              {queryResult ? (
                queryResult.error ? (
                  <span className="flex items-center gap-1.5 text-red-400 font-medium">
                    <span className="material-symbols-outlined text-[16px]">error</span>
                    Query error
                  </span>
                ) : (
                  <>
                    <span className="flex items-center gap-1.5 text-success font-medium">
                      <span className="material-symbols-outlined text-[16px]">check_circle</span>
                      Query successful
                    </span>
                    <span>{queryResult.executionTime}ms</span>
                    <span>{queryResult.rowCount} rows</span>
                  </>
                )
              ) : (
                <span className="text-text-muted/50">Execute a query to see results</span>
              )}
            </div>
            {queryResult && !queryResult.error && (
              <div className="flex items-center gap-2">
                <button className="flex items-center gap-1.5 px-2 py-1 hover:bg-bg-hover/50 rounded text-text-muted hover:text-text-main transition-colors">
                  <span className="material-symbols-outlined text-[16px]">download</span>
                  Export
                </button>
              </div>
            )}
          </div>

          {/* Results Grid */}
          {queryResult?.error ? (
            <div className="flex-1 flex items-center justify-center p-8">
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-6 max-w-lg text-center">
                <span className="material-symbols-outlined text-[48px] text-red-400/50 mb-4 block">error_outline</span>
                <p className="text-red-400 text-sm font-mono whitespace-pre-wrap break-all">{queryResult.error}</p>
              </div>
            </div>
          ) : queryResult?.columns?.length ? (
            <div ref={resultContainerRef} className="flex-1 overflow-auto">
              <table className="w-full border-collapse text-left whitespace-nowrap">
                <thead className="sticky top-0 z-10 bg-bg-card shadow-sm">
                  {table.getHeaderGroups().map((headerGroup) => (
                    <tr key={headerGroup.id}>
                      {headerGroup.headers.map((header) => (
                        <th
                          key={header.id}
                          className="px-4 py-2.5 text-xs font-bold text-text-muted uppercase tracking-wider border-b border-border-subtle/50"
                        >
                          <div className="flex items-center gap-1.5">
                            <span className="material-symbols-outlined text-[14px] text-text-muted/40">
                              {getColumnIcon((header.column.columnDef.meta as Record<string, string>)?.type)}
                            </span>
                            {flexRender(header.column.columnDef.header, header.getContext())}
                          </div>
                        </th>
                      ))}
                    </tr>
                  ))}
                </thead>
                <tbody className="font-mono text-[13px] text-text-muted">
                  {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const row = tableRows[virtualRow.index]
                    const isEven = virtualRow.index % 2 === 0
                    return (
                      <tr
                        key={row.id}
                        className={`${isEven ? 'bg-bg-app' : 'bg-[#1C1C1F]'} border-b border-border-subtle/10 hover:bg-bg-hover/30 transition-colors group`}
                        style={{ height: `${virtualRow.size}px` }}
                      >
                        {row.getVisibleCells().map((cell) => (
                          <td key={cell.id} className="px-4 py-2 group-hover:text-text-main transition-colors max-w-[300px] truncate">
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        ))}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <span className="material-symbols-outlined text-[56px] text-text-muted/10 mb-3 block">database</span>
                <p className="text-text-muted/40 text-sm">Run a query to see results here</p>
              </div>
            </div>
          )}

          {/* Pagination Footer */}
          {queryResult && !queryResult.error && queryResult.rowCount > 0 && (
            <div className="h-10 flex items-center justify-between px-4 border-t border-border-subtle/30 bg-bg-app text-xs text-text-muted shrink-0">
              <span>Showing {queryResult.rowCount} rows ({queryResult.executionTime}ms)</span>
              <span className="text-text-muted/40 font-mono">
                {queryResult.affectedRows > 0 && `${queryResult.affectedRows} affected`}
              </span>
            </div>
          )}
        </div>
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
    </div>
  )
}

// ─── TreeSection Component ───
function TreeSection({
  label,
  icon: _icon,
  count,
  isLoading,
  children,
}: {
  label: string
  icon: string
  count: number
  isLoading?: boolean
  children: React.ReactNode
}) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div>
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full px-3 mb-2 flex items-center justify-between text-xs font-bold text-text-muted uppercase tracking-wider hover:text-text-main transition-colors"
      >
        <span className="flex items-center gap-2">
          <span className={`material-symbols-outlined text-[14px] transition-transform ${collapsed ? '-rotate-90' : ''}`}>
            expand_more
          </span>
          {label}
        </span>
        <span className="bg-bg-card px-1.5 py-0.5 rounded text-[10px] text-text-muted">
          {isLoading ? '...' : count}
        </span>
      </button>
      {!collapsed && <ul className="space-y-0.5">{children}</ul>}
    </div>
  )
}

// ─── TreeItem Component ───
function TreeItem({
  icon,
  label,
  active,
  onClick,
  onSettings,
}: {
  icon: string
  label: string
  active?: boolean
  onClick?: () => void
  onSettings?: () => void
}) {
  return (
    <li>
      <button
        onClick={onClick}
        className={`w-full flex items-center gap-3 px-3 py-2 text-sm rounded-lg border-l-[3px] transition-all duration-200 group ${
          active
            ? 'text-text-main bg-bg-hover border-primary'
            : 'text-text-muted hover:text-text-main hover:bg-bg-hover/30 border-transparent'
        }`}
      >
        <span className={`material-symbols-outlined text-[18px] transition-colors ${active ? 'text-primary' : 'group-hover:text-text-main'}`}>
          {icon}
        </span>
        <span className="truncate flex-1 text-left">{label}</span>
        {onSettings && (
          <span
            onClick={(e) => { e.stopPropagation(); onSettings() }}
            className="material-symbols-outlined text-[16px] text-text-muted/0 group-hover:text-text-muted hover:!text-primary transition-colors cursor-pointer"
          >
            settings
          </span>
        )}
      </button>
    </li>
  )
}

// ─── Helpers ───
function getColumnIcon(type?: string): string {
  if (!type) return 'data_object'
  const t = type.toLowerCase()
  if (t.includes('int') || t.includes('float') || t.includes('numeric') || t.includes('decimal')) return 'pin'
  if (t.includes('char') || t.includes('text') || t.includes('varchar')) return 'text_fields'
  if (t.includes('date') || t.includes('time') || t.includes('timestamp')) return 'calendar_today'
  if (t.includes('bool')) return 'toggle_on'
  if (t.includes('json') || t.includes('jsonb')) return 'data_object'
  if (t.includes('uuid')) return 'fingerprint'
  return 'data_object'
}
