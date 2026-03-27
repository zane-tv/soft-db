import type { SnippetScope } from '@/hooks/useSchema'

export interface SnippetEditorState {
  mode: 'create' | 'edit'
  id: number
  createdAt: string
  scope: Extract<SnippetScope, 'connection' | 'global'>
  title: string
  queryText: string
  tagsInput: string
  folderPath: string
}

export function SnippetEditor({
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
