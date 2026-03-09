import { useState, useMemo, useEffect, useCallback } from 'react'
import { useQueryHistory, useSnippets, useSaveSnippet } from '@/hooks/useSchema'
import type { HistoryEntry, Snippet } from '../../bindings/soft-db/internal/store/models'

// ─── SQL keyword highlighting ───
const SQL_KEYWORDS = /\b(SELECT|FROM|WHERE|AND|OR|INSERT|UPDATE|DELETE|SET|INTO|VALUES|JOIN|LEFT|RIGHT|INNER|OUTER|ON|AS|ORDER\s+BY|GROUP\s+BY|HAVING|LIMIT|OFFSET|WITH|RETURNING|NOT|NULL|IN|EXISTS|LIKE|BETWEEN|CASE|WHEN|THEN|ELSE|END|UNION|ALL|DISTINCT|CREATE|ALTER|DROP|TABLE|INDEX|VIEW|FUNCTION|IF|BEGIN|COMMIT|ROLLBACK|DESC|ASC|COUNT|SUM|AVG|MIN|MAX|NOW)\b/gi
const SQL_STRINGS = /('[^']*')/g

function highlightSQL(sql: string): JSX.Element[] {
  // Simple tokenizer: split by strings first, then highlight keywords
  const parts: JSX.Element[] = []
  let key = 0
  const segments = sql.split(SQL_STRINGS)

  for (const seg of segments) {
    if (seg.startsWith("'") && seg.endsWith("'")) {
      parts.push(<span key={key++} className="text-emerald-400">{seg}</span>)
    } else {
      const inner = seg.split(SQL_KEYWORDS)
      for (const word of inner) {
        if (SQL_KEYWORDS.test(word)) {
          SQL_KEYWORDS.lastIndex = 0
          parts.push(<span key={key++} className="text-primary-muted">{word}</span>)
        } else {
          parts.push(<span key={key++}>{word}</span>)
        }
      }
    }
  }
  return parts
}

// ─── Date grouping helper ───
function groupByDate(items: HistoryEntry[]): { label: string; entries: HistoryEntry[] }[] {
  const groups = new Map<string, HistoryEntry[]>()
  const today = new Date().toDateString()
  const yesterday = new Date(Date.now() - 86400000).toDateString()

  for (const item of items) {
    const d = new Date(item.createdAt).toDateString()
    const label = d === today ? 'Today' : d === yesterday ? 'Yesterday' : d
    if (!groups.has(label)) groups.set(label, [])
    groups.get(label)!.push(item)
  }
  return Array.from(groups.entries()).map(([label, entries]) => ({ label, entries }))
}

// ─── Props ───
interface QueryHistoryDrawerProps {
  open: boolean
  onClose: () => void
  connectionId: string
  connName?: string
  connType?: string
  onUseQuery?: (query: string) => void
}

export function QueryHistoryDrawer({ open, onClose, connectionId, connName, connType, onUseQuery }: QueryHistoryDrawerProps) {
  const { data: history = [] } = useQueryHistory(connectionId)
  const { data: snippets = [] } = useSnippets(connectionId)
  const saveMutation = useSaveSnippet()

  const [tab, setTab] = useState<'history' | 'saved'>('history')
  const [search, setSearch] = useState('')

  // Escape to close
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  // ─── Filtered data ───
  const filteredHistory = useMemo(() => {
    if (!search) return history as HistoryEntry[]
    const q = search.toLowerCase()
    return (history as HistoryEntry[]).filter((h) =>
      h.queryText.toLowerCase().includes(q) || h.status.toLowerCase().includes(q)
    )
  }, [history, search])

  const filteredSnippets = useMemo(() => {
    if (!search) return snippets as Snippet[]
    const q = search.toLowerCase()
    return (snippets as Snippet[]).filter((s) =>
      s.title.toLowerCase().includes(q) || s.queryText.toLowerCase().includes(q) ||
      s.tags?.some((t) => t.toLowerCase().includes(q))
    )
  }, [snippets, search])

  const grouped = useMemo(() => groupByDate(filteredHistory), [filteredHistory])

  // ─── Actions ───
  const copyToClipboard = useCallback((text: string) => {
    navigator.clipboard.writeText(text)
  }, [])

  const saveAsSnippet = useCallback((query: string) => {
    saveMutation.mutate({
      id: 0,
      connectionId,
      title: query.slice(0, 40).replace(/\n/g, ' '),
      queryText: query,
      tags: [],
      createdAt: new Date().toISOString(),
    } as Snippet)
  }, [connectionId, saveMutation])

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40 backdrop-blur-[1px] z-40" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed right-0 top-0 bottom-0 w-[400px] bg-bg-card border-l border-border-subtle flex flex-col z-50 animate-slide-in-right">
        {/* ─── Header ─── */}
        <div className="flex flex-col border-b border-border-subtle bg-bg-card sticky top-0 z-30 shrink-0">
          {/* Title & Close */}
          <div className="flex items-center justify-between px-6 py-5">
            <div>
              <h2 className="text-lg font-bold text-text-main tracking-tight">Activity Log</h2>
              <p className="text-xs text-text-muted font-medium uppercase tracking-wider mt-0.5">
                {connName || connectionId} • {connType || 'database'}
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 -mr-2 rounded-lg text-text-muted hover:text-text-main hover:bg-bg-hover transition-colors"
            >
              <span className="material-symbols-outlined text-xl">close</span>
            </button>
          </div>

          {/* Segmented Control */}
          <div className="px-6 pb-4">
            <div className="flex p-1 bg-bg-app rounded-lg">
              <button
                onClick={() => setTab('history')}
                className={`flex-1 py-1.5 px-3 rounded text-sm font-medium transition-all text-center ${
                  tab === 'history'
                    ? 'text-text-main bg-primary'
                    : 'text-text-muted hover:text-text-main hover:bg-bg-hover/50'
                }`}
              >
                History
              </button>
              <button
                onClick={() => setTab('saved')}
                className={`flex-1 py-1.5 px-3 rounded text-sm font-medium transition-all text-center ${
                  tab === 'saved'
                    ? 'text-text-main bg-primary'
                    : 'text-text-muted hover:text-text-main hover:bg-bg-hover/50'
                }`}
              >
                Saved
              </button>
            </div>
          </div>

          {/* Search */}
          <div className="px-6 pb-4">
            <div className="relative group">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted group-focus-within:text-primary transition-colors">
                <span className="material-symbols-outlined text-[18px]">search</span>
              </span>
              <input
                className="w-full bg-bg-editor text-text-main text-sm rounded-lg border border-border-subtle pl-9 pr-4 py-2 focus:border-primary/50 focus:ring-1 focus:ring-primary/50 placeholder-text-muted/60 transition-all outline-none"
                placeholder="Filter by query or status..."
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* ─── Scrollable Content ─── */}
        <div className="flex-1 overflow-y-auto px-4 py-2 space-y-3 pb-8">
          {tab === 'history' ? (
            /* ─── History Tab ─── */
            grouped.length > 0 ? (
              grouped.map((group) => (
                <div key={group.label}>
                  {/* Section Label */}
                  <div className="px-2 pt-2 pb-1">
                    <span className="text-[11px] font-bold text-text-muted uppercase tracking-wider">{group.label}</span>
                  </div>
                  {/* History Items */}
                  {group.entries.map((entry) => (
                    <HistoryItem
                      key={entry.id}
                      entry={entry}
                      onUse={() => onUseQuery?.(entry.queryText)}
                      onCopy={() => copyToClipboard(entry.queryText)}
                      onSave={() => saveAsSnippet(entry.queryText)}
                    />
                  ))}
                </div>
              ))
            ) : (
              <EmptyState icon="history" text="No query history yet" />
            )
          ) : (
            /* ─── Saved Tab ─── */
            filteredSnippets.length > 0 ? (
              filteredSnippets.map((snippet) => (
                <SnippetCard
                  key={snippet.id}
                  snippet={snippet}
                  onUse={() => onUseQuery?.(snippet.queryText)}
                  onCopy={() => copyToClipboard(snippet.queryText)}
                />
              ))
            ) : (
              <EmptyState icon="bookmark" text="No saved snippets" />
            )
          )}
        </div>

        {/* ─── Footer ─── */}
        {tab === 'saved' && (
          <div className="p-4 border-t border-border-subtle bg-bg-card shrink-0">
            <button className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-dashed border-border-subtle text-text-muted text-xs font-medium hover:bg-bg-hover hover:text-text-main hover:border-text-muted transition-all">
              <span className="material-symbols-outlined text-sm">add</span>
              Create new snippet
            </button>
          </div>
        )}
      </div>
    </>
  )
}

// ─── History Item ───
function HistoryItem({ entry, onUse, onCopy, onSave }: {
  entry: HistoryEntry
  onUse: () => void
  onCopy: () => void
  onSave: () => void
}) {
  const time = new Date(entry.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  const statusBadge = entry.status === 'error' ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 text-[10px] font-bold uppercase tracking-wide border border-red-500/20">
      <span className="material-symbols-outlined text-[10px]">error</span>
      {entry.errorMessage ? 'Error' : 'Syntax Error'}
    </span>
  ) : entry.status === 'mutation' ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 text-[10px] font-bold uppercase tracking-wide border border-amber-500/20">
      <span className="material-symbols-outlined text-[10px]">warning</span>
      Mutation
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 text-[10px] font-bold uppercase tracking-wide border border-emerald-500/20">
      <span className="w-1 h-1 rounded-full bg-emerald-400" />
      {entry.rowsAffected} Rows
    </span>
  )

  return (
    <div
      onClick={onUse}
      className="group relative bg-bg-app hover:bg-bg-hover border border-border-subtle hover:border-bg-hover rounded-lg p-3 transition-all cursor-pointer mb-2"
    >
      {/* Header: Time & Status */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-mono text-text-muted group-hover:text-text-main transition-colors">{time}</span>
        {statusBadge}
      </div>
      {/* Code Block */}
      <div className="font-mono text-[13px] leading-relaxed text-text-main/90 break-all line-clamp-3 opacity-90 group-hover:opacity-100">
        {highlightSQL(entry.queryText)}
      </div>
      {/* Hover Actions */}
      <div className="absolute right-3 bottom-3 opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
        <button
          onClick={(e) => { e.stopPropagation(); onSave() }}
          className="bg-bg-card hover:bg-primary text-text-muted hover:text-text-main p-1.5 rounded-md border border-border-subtle transition-colors"
          title="Save as Snippet"
        >
          <span className="material-symbols-outlined text-[16px]">bookmark</span>
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onCopy() }}
          className="bg-bg-card hover:bg-primary text-text-muted hover:text-text-main p-1.5 rounded-md border border-border-subtle transition-colors"
          title="Copy to Clipboard"
        >
          <span className="material-symbols-outlined text-[16px]">content_copy</span>
        </button>
      </div>
    </div>
  )
}

// ─── Snippet Card ───
function SnippetCard({ snippet, onUse, onCopy }: {
  snippet: Snippet
  onUse: () => void
  onCopy: () => void
}) {
  return (
    <div
      onClick={onUse}
      className="group bg-bg-hover/20 hover:bg-bg-hover border border-primary/20 hover:border-primary/50 rounded-lg p-4 transition-all cursor-pointer relative overflow-hidden mb-2"
    >
      {/* Bookmark Icon */}
      <div className="absolute top-0 right-0 p-2">
        <span className="material-symbols-outlined text-primary/40 group-hover:text-primary text-lg transition-colors">bookmark</span>
      </div>
      {/* Title */}
      <h3 className="text-sm font-bold text-text-main mb-2 pr-6">{snippet.title}</h3>
      {/* Tags */}
      {snippet.tags?.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {snippet.tags.map((tag) => (
            <span key={tag} className="px-2 py-0.5 rounded text-[10px] font-medium bg-bg-app text-text-muted border border-border-subtle">
              #{tag}
            </span>
          ))}
        </div>
      )}
      {/* Code Preview */}
      <div className="bg-bg-app rounded border border-border-subtle p-2 font-mono text-[11px] text-text-muted group-hover:text-text-main transition-colors line-clamp-2">
        {highlightSQL(snippet.queryText)}
      </div>
      {/* Hover copy */}
      <div className="absolute right-3 bottom-3 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => { e.stopPropagation(); onCopy() }}
          className="bg-bg-card hover:bg-primary text-text-muted hover:text-text-main p-1.5 rounded-md border border-border-subtle transition-colors"
          title="Copy"
        >
          <span className="material-symbols-outlined text-[16px]">content_copy</span>
        </button>
      </div>
    </div>
  )
}

// ─── Empty State ───
function EmptyState({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <span className="material-symbols-outlined text-[48px] text-text-muted/15 mb-3">{icon}</span>
      <p className="text-text-muted/40 text-sm">{text}</p>
    </div>
  )
}
