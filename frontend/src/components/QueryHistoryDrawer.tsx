import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import {
  useQueryHistory,
  useSnippets,
  useSaveSnippet,
  useDeleteSnippet,
  type SnippetScope,
} from '@/hooks/useSchema'
import { useSettings } from '@/hooks/useSettings'
import { useTranslation } from '@/lib/i18n'
import { ConfirmModal } from '@/components/ConfirmModal'
import type { HistoryEntry, Snippet } from '../../bindings/soft-db/internal/store/models'

const SQL_KEYWORDS = /\b(SELECT|FROM|WHERE|AND|OR|INSERT|UPDATE|DELETE|SET|INTO|VALUES|JOIN|LEFT|RIGHT|INNER|OUTER|ON|AS|ORDER\s+BY|GROUP\s+BY|HAVING|LIMIT|OFFSET|WITH|RETURNING|NOT|NULL|IN|EXISTS|LIKE|BETWEEN|CASE|WHEN|THEN|ELSE|END|UNION|ALL|DISTINCT|CREATE|ALTER|DROP|TABLE|INDEX|VIEW|FUNCTION|IF|BEGIN|COMMIT|ROLLBACK|DESC|ASC|COUNT|SUM|AVG|MIN|MAX|NOW)\b/gi
const SQL_STRINGS = /('[^']*')/g

function highlightSQL(sql: string): JSX.Element[] {
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

function inferSnippetTitle(query: string): string {
  const cleaned = query
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/;$/, '')
  if (!cleaned) return 'Untitled snippet'
  return cleaned.slice(0, 56)
}

function parseTags(input: string): string[] {
  if (!input.trim()) return []
  return input
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag, idx, list) => tag.length > 0 && list.indexOf(tag) === idx)
}

function formatScope(scope: string): string {
  return scope === 'global' ? 'Global' : 'Connection'
}

interface QueryHistoryDrawerProps {
  open: boolean
  onClose: () => void
  connectionId: string
  connName?: string
  connType?: string
  onUseQuery?: (query: string) => void
  saveRequestToken?: number
  saveRequestQuery?: string
}

interface SnippetEditorState {
  mode: 'create' | 'edit'
  id: number
  createdAt: string
  scope: Extract<SnippetScope, 'connection' | 'global'>
  title: string
  queryText: string
  tagsInput: string
  folderPath: string
}

export function QueryHistoryDrawer({
  open,
  onClose,
  connectionId,
  connName,
  connType,
  onUseQuery,
  saveRequestToken,
  saveRequestQuery,
}: QueryHistoryDrawerProps) {
  const { data: settingsData } = useSettings()
  const { t } = useTranslation((settingsData?.language as 'en' | 'vi') ?? 'en')
  const { data: history = [] } = useQueryHistory(connectionId)

  const [tab, setTab] = useState<'history' | 'saved'>('history')
  const [search, setSearch] = useState('')
  const [scopeFilter, setScopeFilter] = useState<SnippetScope>('all')
  const [folderFilter, setFolderFilter] = useState('')
  const [editorState, setEditorState] = useState<SnippetEditorState | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Snippet | null>(null)

  const { data: allSnippets = [] } = useSnippets(connectionId, { scope: 'all' })
  const { data: snippets = [] } = useSnippets(connectionId, {
    scope: scopeFilter,
    folderPath: folderFilter,
  })

  const saveMutation = useSaveSnippet()
  const deleteMutation = useDeleteSnippet()
  const handledSaveRequestRef = useRef(0)

  const openCreateEditor = useCallback((query = '') => {
    const now = new Date().toISOString()
    const trimmedQuery = query.trim()
    setEditorState({
      mode: 'create',
      id: 0,
      createdAt: now,
      scope: 'connection',
      title: inferSnippetTitle(trimmedQuery),
      queryText: trimmedQuery,
      tagsInput: '',
      folderPath: '',
    })
    setTab('saved')
  }, [])

  const openEditEditor = useCallback((snippet: Snippet) => {
    setEditorState({
      mode: 'edit',
      id: snippet.id,
      createdAt: snippet.createdAt,
      scope: snippet.scope === 'global' ? 'global' : 'connection',
      title: snippet.title,
      queryText: snippet.queryText,
      tagsInput: (snippet.tags || []).join(', '),
      folderPath: snippet.folderPath || '',
    })
    setTab('saved')
  }, [])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  useEffect(() => {
    if (!open || !saveRequestToken) return
    if (handledSaveRequestRef.current === saveRequestToken) return

    handledSaveRequestRef.current = saveRequestToken
    const requestedQuery = (saveRequestQuery || '').trim()
    const existing = requestedQuery
      ? allSnippets.find((snippet) => snippet.queryText.trim() === requestedQuery)
      : null

    if (existing) {
      openEditEditor(existing)
      return
    }
    openCreateEditor(requestedQuery)
  }, [open, saveRequestToken, saveRequestQuery, allSnippets, openCreateEditor, openEditEditor])

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
    return (snippets as Snippet[]).filter((snippet) =>
      snippet.title.toLowerCase().includes(q)
      || snippet.queryText.toLowerCase().includes(q)
      || snippet.scope.toLowerCase().includes(q)
      || snippet.folderPath.toLowerCase().includes(q)
      || snippet.tags.some((tag) => tag.toLowerCase().includes(q))
    )
  }, [snippets, search])

  const grouped = useMemo(() => groupByDate(filteredHistory), [filteredHistory])

  const savedSnippetMap = useMemo(() => {
    const map = new Map<string, Snippet>()
    for (const snippet of allSnippets as Snippet[]) {
      if (!map.has(snippet.queryText)) {
        map.set(snippet.queryText, snippet)
      }
    }
    return map
  }, [allSnippets])

  const copyToClipboard = useCallback((text: string) => {
    void navigator.clipboard.writeText(text)
  }, [])

  const createQuickSnippet = useCallback((query: string) => {
    const trimmed = query.trim()
    if (!trimmed) return
    const now = new Date().toISOString()
    const snippet: Snippet = {
      id: 0,
      connectionId,
      scope: 'connection',
      title: inferSnippetTitle(trimmed),
      queryText: trimmed,
      tags: [],
      folderPath: '',
      createdAt: now,
      updatedAt: now,
    }
    saveMutation.mutate({ connectionId, snippet })
  }, [connectionId, saveMutation])

  const requestDelete = useCallback((snippet: Snippet) => {
    setDeleteTarget(snippet)
  }, [])

  const handleEditorSubmit = useCallback(() => {
    if (!editorState) return
    const title = editorState.title.trim()
    const queryText = editorState.queryText.trim()
    if (!title || !queryText) return

    const now = new Date().toISOString()
    const snippetConnectionId = editorState.scope === 'global' ? '' : connectionId
    const snippet: Snippet = {
      id: editorState.mode === 'edit' ? editorState.id : 0,
      connectionId: snippetConnectionId,
      scope: editorState.scope,
      title,
      queryText,
      tags: parseTags(editorState.tagsInput),
      folderPath: editorState.folderPath.trim(),
      createdAt: editorState.createdAt || now,
      updatedAt: now,
    }

    saveMutation.mutate(
      { connectionId, snippet },
      {
        onSuccess: () => setEditorState(null),
      },
    )
  }, [connectionId, editorState, saveMutation])

  const confirmDelete = useCallback(() => {
    if (!deleteTarget) return
    deleteMutation.mutate(
      { id: deleteTarget.id, connectionId },
      {
        onSuccess: () => {
          if (editorState?.id === deleteTarget.id) {
            setEditorState(null)
          }
          setDeleteTarget(null)
        },
      },
    )
  }, [connectionId, deleteMutation, deleteTarget, editorState?.id])

  if (!open) return null

  return (
    <>
      <button
        type="button"
        aria-label="Close query history drawer"
        className="fixed inset-0 bg-black/40 backdrop-blur-[1px] z-40"
        onClick={onClose}
      />

      <div className="fixed right-0 top-[40px] bottom-0 w-[400px] bg-bg-card border-l border-border-subtle flex flex-col z-50 animate-slide-in-right">
        <div className="flex flex-col border-b border-border-subtle bg-bg-card shrink-0">
          <div className="flex items-center justify-between px-6 py-5">
            <div>
              <h2 className="text-lg font-bold text-text-main tracking-tight">{t('history.title')}</h2>
              <p className="text-xs text-text-muted font-medium uppercase tracking-wider mt-0.5">
                {connName || connectionId} • {connType || 'database'}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-2 -mr-2 rounded-lg text-text-muted hover:text-text-main hover:bg-bg-hover transition-colors"
            >
              <span className="material-symbols-outlined text-xl">close</span>
            </button>
          </div>

          <div className="px-6 pb-4">
            <div className="flex p-1 bg-bg-app rounded-lg">
              <button
                type="button"
                onClick={() => setTab('history')}
                className={`flex-1 py-1.5 px-3 rounded text-sm font-medium transition-all text-center ${
                  tab === 'history'
                    ? 'text-text-main bg-primary'
                    : 'text-text-muted hover:text-text-main hover:bg-bg-hover/50'
                }`}
              >
                {t('history.tab.history')}
              </button>
              <button
                type="button"
                onClick={() => setTab('saved')}
                className={`flex-1 py-1.5 px-3 rounded text-sm font-medium transition-all text-center ${
                  tab === 'saved'
                    ? 'text-text-main bg-primary'
                    : 'text-text-muted hover:text-text-main hover:bg-bg-hover/50'
                }`}
              >
                {t('history.tab.saved')}
              </button>
            </div>
          </div>

          <div className="px-6 pb-4">
            <div className="relative group">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted group-focus-within:text-primary transition-colors">
                <span className="material-symbols-outlined text-[18px]">search</span>
              </span>
              <input
                className="w-full bg-bg-editor text-text-main text-sm rounded-lg border border-border-subtle pl-9 pr-4 py-2 focus:border-primary/50 focus:ring-1 focus:ring-primary/50 placeholder-text-muted/60 transition-all outline-none"
                placeholder={t('history.filterPlaceholder')}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          {tab === 'saved' && (
            <div className="px-6 pb-4 flex items-center gap-2">
              <select
                value={scopeFilter}
                onChange={(e) => setScopeFilter(e.target.value as SnippetScope)}
                className="bg-bg-editor text-text-main text-xs rounded-lg border border-border-subtle px-2.5 py-2 outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50"
              >
                <option value="all">All scopes</option>
                <option value="connection">Connection</option>
                <option value="global">Global</option>
              </select>
              <input
                type="text"
                value={folderFilter}
                onChange={(e) => setFolderFilter(e.target.value)}
                placeholder="Folder path"
                className="flex-1 bg-bg-editor text-text-main text-xs rounded-lg border border-border-subtle px-3 py-2 outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 placeholder-text-muted/60"
              />
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-2 space-y-3 pb-8">
          {tab === 'history' ? (
            grouped.length > 0 ? (
              grouped.map((group) => (
                <div key={group.label}>
                  <div className="px-2 pt-2 pb-1">
                    <span className="text-[11px] font-bold text-text-muted uppercase tracking-wider">{group.label}</span>
                  </div>
                  {group.entries.map((entry) => {
                    const savedSnippet = savedSnippetMap.get(entry.queryText)
                    return (
                      <HistoryItem
                        key={entry.id}
                        entry={entry}
                        onUse={() => onUseQuery?.(entry.queryText)}
                        onCopy={() => copyToClipboard(entry.queryText)}
                        onSave={() => createQuickSnippet(entry.queryText)}
                        onUnsave={savedSnippet ? () => requestDelete(savedSnippet) : undefined}
                        isSaved={!!savedSnippet}
                      />
                    )
                  })}
                </div>
              ))
            ) : (
              <EmptyState icon="history" text={t('history.noHistory')} />
            )
          ) : (
            <>
              {editorState && (
                <SnippetEditor
                  state={editorState}
                  onChange={(next) => setEditorState((prev) => (prev ? { ...prev, ...next } : prev))}
                  onCancel={() => setEditorState(null)}
                  onSubmit={handleEditorSubmit}
                  saving={saveMutation.isPending}
                />
              )}

              {filteredSnippets.length > 0 ? (
                filteredSnippets.map((snippet) => (
                  <SnippetCard
                    key={snippet.id}
                    snippet={snippet}
                    onUse={() => onUseQuery?.(snippet.queryText)}
                    onCopy={() => copyToClipboard(snippet.queryText)}
                    onEdit={() => openEditEditor(snippet)}
                    onDelete={() => requestDelete(snippet)}
                  />
                ))
              ) : (
                <EmptyState icon="bookmark" text={t('history.noSnippets')} />
              )}
            </>
          )}
        </div>

        {tab === 'saved' && (
          <div className="p-4 border-t border-border-subtle bg-bg-card shrink-0">
            <button
              type="button"
              onClick={() => openCreateEditor('')}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-dashed border-border-subtle text-text-muted text-xs font-medium hover:bg-bg-hover hover:text-text-main hover:border-text-muted transition-all"
            >
              <span className="material-symbols-outlined text-sm">add</span>
              {t('history.createSnippet')}
            </button>
          </div>
        )}
      </div>

      <ConfirmModal
        open={!!deleteTarget}
        title="Delete snippet"
        message={deleteTarget ? `Delete \"${deleteTarget.title}\"? This cannot be undone.` : 'Delete this snippet?'}
        detail={deleteTarget?.queryText}
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />
    </>
  )
}

function HistoryItem({
  entry,
  onUse,
  onCopy,
  onSave,
  onUnsave,
  isSaved = false,
}: {
  entry: HistoryEntry
  onUse: () => void
  onCopy: () => void
  onSave: () => void
  onUnsave?: () => void
  isSaved?: boolean
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
      className={`group relative bg-bg-app hover:bg-bg-hover border rounded-lg p-3 pb-4 transition-all cursor-pointer mb-2 ${
        isSaved ? 'border-primary/30' : 'border-border-subtle hover:border-bg-hover'
      }`}
    >
      <button
        type="button"
        onClick={onUse}
        className="absolute inset-0 rounded-lg"
        aria-label="Use history query"
      />

      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-mono text-text-muted group-hover:text-text-main transition-colors shrink-0">{time}</span>
          {isSaved && (
            <span className="material-symbols-outlined text-primary text-[12px] shrink-0" title="Saved">bookmark</span>
          )}
        </div>
        <div className="shrink-0 ml-2">{statusBadge}</div>
      </div>

      <div className="font-mono text-[13px] leading-relaxed text-text-main/90 break-all line-clamp-3 opacity-90 group-hover:opacity-100">
        {highlightSQL(entry.queryText)}
      </div>

      <div className="absolute right-2 bottom-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1.5 z-10">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            if (isSaved && onUnsave) {
              onUnsave()
            } else if (!isSaved) {
              onSave()
            }
          }}
          className={`p-1 rounded-md border transition-colors ${
            isSaved
              ? 'bg-primary/20 text-primary border-primary/30 hover:bg-red-500/20 hover:text-red-400 hover:border-red-500/30'
              : 'bg-bg-card hover:bg-primary text-text-muted hover:text-text-main border-border-subtle'
          }`}
          title={isSaved ? 'Delete saved snippet' : 'Save as Snippet'}
        >
          <span className="material-symbols-outlined text-[14px]">{isSaved ? 'bookmark_remove' : 'bookmark_add'}</span>
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onCopy()
          }}
          className="bg-bg-card hover:bg-primary text-text-muted hover:text-text-main p-1 rounded-md border border-border-subtle transition-colors"
          title="Copy to Clipboard"
        >
          <span className="material-symbols-outlined text-[14px]">content_copy</span>
        </button>
      </div>
    </div>
  )
}

function SnippetEditor({
  state,
  onChange,
  onCancel,
  onSubmit,
  saving,
}: {
  state: SnippetEditorState
  onChange: (next: Partial<SnippetEditorState>) => void
  onCancel: () => void
  onSubmit: () => void
  saving: boolean
}) {
  const disabled = !state.title.trim() || !state.queryText.trim() || saving

  return (
    <div className="bg-bg-app border border-border-subtle rounded-lg p-3 mb-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-text-main uppercase tracking-wide">
          {state.mode === 'edit' ? 'Edit Snippet' : 'Create Snippet'}
        </h3>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-text-muted hover:text-text-main transition-colors"
        >
          Cancel
        </button>
      </div>

      <div className="space-y-2">
        <input
          type="text"
          value={state.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="Snippet title"
          className="w-full bg-bg-editor text-text-main text-xs rounded-lg border border-border-subtle px-3 py-2 outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 placeholder-text-muted/60"
        />

        <div className="grid grid-cols-2 gap-2">
          <select
            value={state.scope}
            onChange={(e) => onChange({ scope: e.target.value as SnippetEditorState['scope'] })}
            className="bg-bg-editor text-text-main text-xs rounded-lg border border-border-subtle px-2.5 py-2 outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50"
          >
            <option value="connection">Connection scope</option>
            <option value="global">Global scope</option>
          </select>

          <input
            type="text"
            value={state.folderPath}
            onChange={(e) => onChange({ folderPath: e.target.value })}
            placeholder="Folder path"
            className="bg-bg-editor text-text-main text-xs rounded-lg border border-border-subtle px-3 py-2 outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 placeholder-text-muted/60"
          />
        </div>

        <input
          type="text"
          value={state.tagsInput}
          onChange={(e) => onChange({ tagsInput: e.target.value })}
          placeholder="Tags (comma separated)"
          className="w-full bg-bg-editor text-text-main text-xs rounded-lg border border-border-subtle px-3 py-2 outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 placeholder-text-muted/60"
        />

        <textarea
          value={state.queryText}
          onChange={(e) => onChange({ queryText: e.target.value })}
          placeholder="SQL or JSON query"
          rows={5}
          className="w-full resize-y bg-bg-editor text-text-main font-mono text-xs rounded-lg border border-border-subtle px-3 py-2 outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 placeholder-text-muted/60"
        />

        <button
          type="button"
          onClick={onSubmit}
          disabled={disabled}
          className="w-full py-2 rounded-lg bg-primary hover:bg-primary-hover text-white text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving...' : state.mode === 'edit' ? 'Update Snippet' : 'Save Snippet'}
        </button>
      </div>
    </div>
  )
}

function SnippetCard({
  snippet,
  onUse,
  onCopy,
  onEdit,
  onDelete,
}: {
  snippet: Snippet
  onUse: () => void
  onCopy: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const updated = new Date(snippet.updatedAt).toLocaleString([], {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <div className="group bg-bg-hover/20 hover:bg-bg-hover border border-primary/20 hover:border-primary/50 rounded-lg p-4 transition-all cursor-pointer relative overflow-hidden mb-2">
      <button
        type="button"
        onClick={onUse}
        className="absolute inset-0 rounded-lg"
        aria-label={`Use snippet ${snippet.title}`}
      />

      <div className="absolute top-0 right-0 p-2">
        <span className="material-symbols-outlined text-primary/40 group-hover:text-primary text-lg transition-colors">bookmark</span>
      </div>

      <h3 className="text-sm font-bold text-text-main mb-2 pr-6">{snippet.title}</h3>

      <div className="flex items-center flex-wrap gap-1.5 mb-2">
        <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-bg-app text-text-muted border border-border-subtle">
          {formatScope(snippet.scope)}
        </span>
        {snippet.folderPath && (
          <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-bg-app text-text-muted border border-border-subtle">
            {snippet.folderPath}
          </span>
        )}
        <span className="text-[10px] text-text-muted/70">Updated {updated}</span>
      </div>

      {snippet.tags.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {snippet.tags.map((tag) => (
            <span key={tag} className="px-2 py-0.5 rounded text-[10px] font-medium bg-bg-app text-text-muted border border-border-subtle">
              #{tag}
            </span>
          ))}
        </div>
      )}

      <div className="bg-bg-app rounded border border-border-subtle p-2 font-mono text-[11px] text-text-muted group-hover:text-text-main transition-colors line-clamp-2">
        {highlightSQL(snippet.queryText)}
      </div>

      <div className="absolute right-3 bottom-3 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 z-10">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onEdit()
          }}
          className="bg-bg-card hover:bg-primary text-text-muted hover:text-text-main p-1.5 rounded-md border border-border-subtle transition-colors"
          title="Edit"
        >
          <span className="material-symbols-outlined text-[16px]">edit</span>
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          className="bg-bg-card hover:bg-red-500/20 text-text-muted hover:text-red-400 p-1.5 rounded-md border border-border-subtle transition-colors"
          title="Delete"
        >
          <span className="material-symbols-outlined text-[16px]">delete</span>
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onCopy()
          }}
          className="bg-bg-card hover:bg-primary text-text-muted hover:text-text-main p-1.5 rounded-md border border-border-subtle transition-colors"
          title="Copy"
        >
          <span className="material-symbols-outlined text-[16px]">content_copy</span>
        </button>
      </div>
    </div>
  )
}

function EmptyState({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <span className="material-symbols-outlined text-[48px] text-text-muted/15 mb-3">{icon}</span>
      <p className="text-text-muted/40 text-sm">{text}</p>
    </div>
  )
}
