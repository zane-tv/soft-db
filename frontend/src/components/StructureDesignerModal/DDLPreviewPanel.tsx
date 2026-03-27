import type { StructureChangePreviewResult } from '@/hooks/useSchema'

interface DDLPreviewPanelProps {
  isPending: boolean
  requestIssues: string[]
  previewError: string
  previewResult: StructureChangePreviewResult | null
  onClose: () => void
}

export function DDLPreviewPanel({
  isPending,
  requestIssues,
  previewError,
  previewResult,
  onClose,
}: DDLPreviewPanelProps) {
  const previewWarnings = previewResult?.warnings || []
  const previewStatements = previewResult?.statements || []
  const previewNotes = previewResult?.capabilityNotes || []

  return (
    <div className="mx-6 mt-4 bg-bg-editor rounded-lg border border-border-subtle overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border-subtle/50 flex items-center justify-between">
        <span className="text-xs font-semibold text-text-main">Backend Preview</span>
        <button type="button" onClick={onClose} className="text-text-muted hover:text-text-main">
          <span className="material-symbols-outlined text-[16px]">close</span>
        </button>
      </div>

      {isPending ? (
        <div className="p-4 text-sm text-text-muted font-mono">Preparing backend preview...</div>
      ) : (
        <>
          {requestIssues.length > 0 && (
            <div className="px-4 py-3 border-b border-red-500/30 bg-red-500/10 text-red-300 text-xs space-y-1">
              {requestIssues.map((issue) => (
                <p key={issue}>- {issue}</p>
              ))}
            </div>
          )}

          {previewError && (
            <div className="px-4 py-3 border-b border-red-500/30 bg-red-500/10 text-red-300 text-xs">
              {previewError}
            </div>
          )}

          <pre className="p-4 text-[13px] font-mono text-emerald-400 overflow-x-auto whitespace-pre-wrap">
            {previewStatements.length > 0 ? previewStatements.join('\n') : '-- No backend preview available'}
          </pre>

          {previewWarnings.length > 0 && (
            <div className="px-4 pb-4 space-y-2">
              <p className="text-xs font-semibold text-text-main">Warnings</p>
              {previewWarnings.map((warning) => (
                <div
                  key={`${warning.code}-${warning.operationKind || 'general'}-${warning.column || 'none'}`}
                  className={`rounded-md px-3 py-2 text-xs border ${
                    warning.blocking
                      ? 'bg-red-500/10 border-red-500/30 text-red-300'
                      : 'bg-amber-500/10 border-amber-500/30 text-amber-200'
                  }`}
                >
                  {warning.message}
                </div>
              ))}
            </div>
          )}

          {previewNotes.length > 0 && (
            <div className="px-4 pb-4 space-y-2">
              <p className="text-xs font-semibold text-text-main">Capability Notes</p>
              {previewNotes.map((note) => (
                <div
                  key={`${note.code}-${note.severity}`}
                  className="rounded-md px-3 py-2 text-xs border bg-bg-hover/60 border-border-subtle text-text-muted"
                >
                  {note.message}
                </div>
              ))}
            </div>
          )}

          {previewResult?.requiresConfirmation && (
            <div className="mx-4 mb-4 rounded-md px-3 py-2 text-xs border bg-amber-500/10 border-amber-500/30 text-amber-200">
              Confirmation is required before applying this structure change.
            </div>
          )}
        </>
      )}
    </div>
  )
}
