import { useSettings } from '@/hooks/useSettings'
import { useTranslation } from '@/lib/i18n'

interface PendingChangesBarProps {
  count: number
  onReviewSQL: () => void
  onDiscard: () => void
  onApply: () => void
  isApplying: boolean
}

export function PendingChangesBar({ count, onReviewSQL, onDiscard, onApply, isApplying }: PendingChangesBarProps) {
  const { data: settingsData } = useSettings()
  const { t } = useTranslation((settingsData?.language as 'en' | 'vi') ?? 'en')
  if (count === 0) return null

  return (
    <div className="h-10 flex items-center justify-between px-4 border-t border-amber-500/30 bg-amber-500/5 text-xs shrink-0 animate-in slide-in-from-bottom-2">
      <div className="flex items-center gap-2 text-amber-400">
        <span className="material-symbols-outlined text-[16px]">edit_note</span>
        <span className="font-medium">{count} {count === 1 ? t('pending.change') : t('pending.changes')}</span>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={onReviewSQL}
          className="flex items-center gap-1 px-2.5 py-1 text-text-muted hover:text-text-main hover:bg-bg-hover/50 rounded transition-colors"
        >
          <span className="material-symbols-outlined text-[14px]">code</span>
          {t('pending.reviewSQL')}
        </button>
        <button
          onClick={onDiscard}
          className="flex items-center gap-1 px-2.5 py-1 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded transition-colors"
        >
          <span className="material-symbols-outlined text-[14px]">close</span>
          {t('pending.discard')}
        </button>
        <button
          onClick={onApply}
          disabled={isApplying}
          className="flex items-center gap-1 px-3 py-1 bg-primary hover:bg-primary-hover text-white rounded font-medium transition-colors disabled:opacity-50"
        >
          {isApplying ? (
            <>
              <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>
              {t('pending.saving')}
            </>
          ) : (
            <>
              <span className="material-symbols-outlined text-[14px]">check</span>
              {t('pending.apply')}
            </>
          )}
        </button>
      </div>
    </div>
  )
}

// ─── SQL Review Modal ───
interface SQLReviewModalProps {
  sqlStatements: string[]
  onClose: () => void
  onConfirm: () => void
}

export function SQLReviewModal({ sqlStatements, onClose, onConfirm }: SQLReviewModalProps) {
  const { data: settingsData } = useSettings()
  const { t } = useTranslation((settingsData?.language as 'en' | 'vi') ?? 'en')
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-bg-card border border-border-subtle rounded-2xl w-[600px] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle/50">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[20px] text-amber-400">code</span>
            <h3 className="text-base font-semibold text-text-main">{t('editor.sqlPreview')}</h3>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-main transition-colors">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* SQL List */}
        <div className="flex-1 overflow-auto p-4 space-y-2">
          {sqlStatements.map((sql, i) => (
            <div key={i} className="bg-bg-app border border-border-subtle/30 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[10px] font-bold text-text-muted/50 uppercase">#{i + 1}</span>
              </div>
              <pre className="text-[12px] font-mono text-amber-300 whitespace-pre-wrap break-all">{sql}</pre>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border-subtle/50">
          <span className="text-xs text-text-muted mr-auto">
            {sqlStatements.length} UPDATE {sqlStatements.length === 1 ? t('pending.statement') : t('pending.statements')}
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-text-muted hover:text-text-main hover:bg-bg-hover/50 rounded-lg transition-colors"
          >
            {t('pending.close')}
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-sm bg-primary hover:bg-primary-hover text-white rounded-lg font-medium transition-colors"
          >
            {t('pending.confirmExecute')}
          </button>
        </div>
      </div>
    </div>
  )
}
