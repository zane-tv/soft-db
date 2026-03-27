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
import type { HistoryEntry, Snippet } from '../../../bindings/soft-db/internal/store/models'
import { groupByDate, inferSnippetTitle, parseTags } from './history-helpers'
import { HistoryItem } from './HistoryItem'
import { SnippetEditor, type SnippetEditorState } from './SnippetEditor'
import { SnippetCard } from './SnippetCard'

type FavoritesFilter = 'all' | 'favorites'

function EmptyState({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <span className="material-symbols-outlined text-[48px] text-text-muted/15 mb-3">{icon}</span>
      <p className="text-text-muted/40 text-sm">{text}</p>
    </div>
  )
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
  const [favoritesFilter, setFavoritesFilter] = useState<FavoritesFilter>('all')
  const [editorState, setEditorState] = useState<SnippetEditorState | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Snippet | null>(null)

  const { data: allSnippets = [] } = useSnippets(connectionId, { scope: 'all' })
  const { data: snippets = [] } = useSnippets(connectionId, { scope: scopeFilter, folderPath: folderFilter })

  const saveMutation = useSaveSnippet()
  const deleteMutation = useDeleteSnippet()
  const handledSaveRequestRef = useRef(0)

  const openCreateEditor = useCallback((query = '') => {
    const now = new Date().toISOString()
    const trimmedQuery = query.trim()
    setEditorState({
      mode: 'create', id: 0, createdAt: now, scope: 'connection',
      title: inferSnippetTitle(trimmedQuery), queryText: trimmedQuery, tagsInput: '', folderPath: '',
    })
    setTab('saved')
  }, [])

  const openEditEditor = useCallback((snippet: Snippet) => {
    setEditorState({
      mode: 'edit', id: snippet.id, createdAt: snippet.createdAt,
      scope: snippet.scope === 'global' ? 'global' : 'connection',
      title: snippet.title, queryText: snippet.queryText,
      tagsInput: (snippet.tags || []).join(', '), folderPath: snippet.folderPath || '',
    })
    setTab('saved')
  }, [])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  useEffect(() => {
    if (!open || !saveRequestToken) return
    if (handledSaveRequestRef.current === saveRequestToken) return
    handledSaveRequestRef.current = saveRequestToken
    const requestedQuery = (saveRequestQuery || '').trim()
    const existing = requestedQuery ? (allSnippets as Snippet[]).find((snippet) => snippet.queryText.trim() === requestedQuery) : null
    if (existing) { openEditEditor(existing); return }
    openCreateEditor(requestedQuery)
  }, [open, saveRequestToken, saveRequestQuery, allSnippets, openCreateEditor, openEditEditor])

  const filteredHistory = useMemo(() => {
    if (!search) return history as HistoryEntry[]
    const q = search.toLowerCase()
    return (history as HistoryEntry[]).filter((h) => h.queryText.toLowerCase().includes(q) || h.status.toLowerCase().includes(q))
  }, [history, search])

  const filteredSnippets = useMemo(() => {
    let list = snippets as Snippet[]
    if (favoritesFilter === 'favorites') list = list.filter((s) => s.isFavorite)
    if (!search) return list
    const q = search.toLowerCase()
    return list.filter((snippet) =>
      snippet.title.toLowerCase().includes(q) || snippet.queryText.toLowerCase().includes(q) ||
      snippet.scope.toLowerCase().includes(q) || snippet.folderPath.toLowerCase().includes(q) ||
      snippet.tags.some((tag) => tag.toLowerCase().includes(q))
    )
  }, [snippets, search, favoritesFilter])

  const grouped = useMemo(() => groupByDate(filteredHistory), [filteredHistory])

  const savedSnippetMap = useMemo(() => {
    const map = new Map<string, Snippet>()
    for (const snippet of allSnippets as Snippet[]) {
      if (!map.has(snippet.queryText)) map.set(snippet.queryText, snippet)
    }
    return map
  }, [allSnippets])

  const copyToClipboard = useCallback((text: string) => { void navigator.clipboard.writeText(text) }, [])

  const createQuickSnippet = useCallback((query: string) => {
    const trimmed = query.trim()
    if (!trimmed) return
    const now = new Date().toISOString()
    const snippet: Snippet = {
      id: 0, connectionId, scope: 'connection', title: inferSnippetTitle(trimmed),
      queryText: trimmed, tags: [], folderPath: '', isFavorite: false, createdAt: now, updatedAt: now,
    }
    saveMutation.mutate({ connectionId, snippet })
  }, [connectionId, saveMutation])

  const requestDelete = useCallback((snippet: Snippet) => { setDeleteTarget(snippet) }, [])

  const toggleFavorite = useCallback((snippet: Snippet) => {
    const now = new Date().toISOString()
    saveMutation.mutate({ connectionId, snippet: { ...snippet, isFavorite: !snippet.isFavorite, updatedAt: now } })
  }, [connectionId, saveMutation])

  const handleEditorSubmit = useCallback(() => {
    if (!editorState) return
    const title = editorState.title.trim()
    const queryText = editorState.queryText.trim()
    if (!title || !queryText) return
    const now = new Date().toISOString()
    const snippetConnectionId = editorState.scope === 'global' ? '' : connectionId
    const snippet: Snippet = {
      id: editorState.mode === 'edit' ? editorState.id : 0, connectionId: snippetConnectionId,
      scope: editorState.scope, title, queryText, tags: parseTags(editorState.tagsInput),
      folderPath: editorState.folderPath.trim(), isFavorite: false,
      createdAt: editorState.createdAt || now, updatedAt: now,
    }
    saveMutation.mutate({ connectionId, snippet }, { onSuccess: () => setEditorState(null) })
  }, [connectionId, editorState, saveMutation])

  const confirmDelete = useCallback(() => {
    if (!deleteTarget) return
    deleteMutation.mutate({ id: deleteTarget.id, connectionId }, {
      onSuccess: () => {
        if (editorState?.id === deleteTarget.id) setEditorState(null)
        setDeleteTarget(null)
      },
    })
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
                {connName || connectionId} &bull; {connType || 'database'}
              </p>
            </div>
            <button type="button" onClick={onClose} className="p-2 -mr-2 rounded-lg text-text-muted hover:text-text-main hover:bg-bg-hover transition-colors">
              <span className="material-symbols-outlined text-xl">close</span>
            </button>
          </div>

          <div className="px-6 pb-4">
            <div className="flex p-1 bg-bg-app rounded-lg">
              <button type="button" onClick={() => setTab('history')} className={`flex-1 py-1.5 px-3 rounded text-sm font-medium transition-all text-center ${tab === 'history' ? 'text-text-main bg-primary' : 'text-text-muted hover:text-text-main hover:bg-bg-hover/50'}`}>
                {t('history.tab.history')}
              </button>
              <button type="button" onClick={() => setTab('saved')} className={`flex-1 py-1.5 px-3 rounded text-sm font-medium transition-all text-center ${tab === 'saved' ? 'text-text-main bg-primary' : 'text-text-muted hover:text-text-main hover:bg-bg-hover/50'}`}>
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
            <div className="px-6 pb-4 space-y-2">
              <div className="flex items-center gap-2">
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
                <button
                  type="button"
                  onClick={() => setFavoritesFilter((f) => f === 'favorites' ? 'all' : 'favorites')}
                  title={favoritesFilter === 'favorites' ? 'Show all' : 'Show favorites only'}
                  className={`p-2 rounded-lg border transition-colors ${
                    favoritesFilter === 'favorites'
                      ? 'border-amber-500/40 bg-amber-500/10 text-amber-400'
                      : 'border-border-subtle text-text-muted hover:text-text-main hover:bg-bg-hover'
                  }`}
                >
                  <span className="material-symbols-outlined text-[16px]">
                    {favoritesFilter === 'favorites' ? 'star' : 'star_border'}
                  </span>
                </button>
              </div>
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
                    onToggleFavorite={() => toggleFavorite(snippet)}
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
        message={deleteTarget ? `Delete "${deleteTarget.title}"? This cannot be undone.` : 'Delete this snippet?'}
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
