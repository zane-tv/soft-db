import type { Snippet } from '../../../bindings/soft-db/internal/store/models'
import { highlightSQL, formatScope } from './history-helpers'

export function SnippetCard({
  snippet,
  onUse,
  onCopy,
  onEdit,
  onDelete,
  onToggleFavorite,
}: {
  snippet: Snippet
  onUse: () => void
  onCopy: () => void
  onEdit: () => void
  onDelete: () => void
  onToggleFavorite: () => void
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

      <div className="absolute top-0 right-0 p-2 flex items-center gap-1">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleFavorite() }}
          title={snippet.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
          className="relative z-10 text-text-muted/30 hover:text-amber-400 transition-colors"
        >
          <span className={`material-symbols-outlined text-lg ${snippet.isFavorite ? 'text-amber-400' : ''}`}>
            {snippet.isFavorite ? 'star' : 'star_border'}
          </span>
        </button>
        <span className="material-symbols-outlined text-primary/40 group-hover:text-primary text-lg transition-colors">bookmark</span>
      </div>

      <h3 className="text-sm font-bold text-text-main mb-2 pr-14">{snippet.title}</h3>

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
          onClick={(e) => { e.stopPropagation(); onEdit() }}
          className="bg-bg-card hover:bg-primary text-text-muted hover:text-text-main p-1.5 rounded-md border border-border-subtle transition-colors"
          title="Edit"
        >
          <span className="material-symbols-outlined text-[16px]">edit</span>
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          className="bg-bg-card hover:bg-red-500/20 text-text-muted hover:text-red-400 p-1.5 rounded-md border border-border-subtle transition-colors"
          title="Delete"
        >
          <span className="material-symbols-outlined text-[16px]">delete</span>
        </button>
        <button
          type="button"
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
