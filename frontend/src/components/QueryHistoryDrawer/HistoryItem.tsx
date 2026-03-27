import type { HistoryEntry } from '../../../bindings/soft-db/internal/store/models'
import { highlightSQL } from './history-helpers'

export function HistoryItem({
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
            if (isSaved && onUnsave) onUnsave()
            else if (!isSaved) onSave()
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
          onClick={(e) => { e.stopPropagation(); onCopy() }}
          className="bg-bg-card hover:bg-primary text-text-muted hover:text-text-main p-1 rounded-md border border-border-subtle transition-colors"
          title="Copy to Clipboard"
        >
          <span className="material-symbols-outlined text-[14px]">content_copy</span>
        </button>
      </div>
    </div>
  )
}
