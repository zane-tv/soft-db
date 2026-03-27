import { useRef, useEffect } from 'react'

interface ConfirmDialogProps {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  icon?: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  danger = true,
  icon = 'warning',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => cancelRef.current?.focus(), 0)
      return () => clearTimeout(timer)
    }
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      {/* Backdrop */}
      <button
        type="button"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
        style={{ animationDuration: '0.15s' }}
        aria-label="Close confirmation dialog"
        onClick={onCancel}
      />

      {/* Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        tabIndex={-1}
        className="relative w-full max-w-[400px] bg-bg-card rounded-2xl border border-border-subtle overflow-hidden animate-fade-in-up"
        style={{ animationDuration: '0.2s' }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          }
        }}
      >
        <div className="px-6 pt-6 pb-2 flex flex-col items-center text-center">
          {/* Icon */}
          <div className={`size-12 rounded-full flex items-center justify-center mb-4 ${
            danger ? 'bg-error/10' : 'bg-primary/10'
          }`}>
            <span className={`material-symbols-outlined text-[28px] ${
               danger ? 'text-error' : 'text-primary'
            }`}>
              {icon}
            </span>
          </div>

          {/* Title */}
          <h3 id="confirm-dialog-title" className="text-lg font-bold text-text-main mb-2">{title}</h3>

          {/* Message */}
          <p className="text-sm text-text-muted leading-relaxed">{message}</p>
        </div>

        {/* Actions */}
        <div className="px-6 py-5 flex items-center justify-center gap-3">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium text-text-main bg-bg-hover/50 hover:bg-white/10 border border-border-subtle transition-all duration-200 active:scale-[0.97]"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white transition-all duration-200 active:scale-[0.97] ${
              danger
                ? 'bg-error hover:bg-red-600'
                : 'bg-primary hover:bg-primary-hover'
            }`}
          >
            <span className="material-symbols-outlined text-[16px]">
              {danger ? 'delete' : 'check'}
            </span>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
