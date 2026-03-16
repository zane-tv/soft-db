import { useRef } from 'react'

interface ConfirmModalProps {
  open: boolean
  title: string
  message: string
  detail?: string
  confirmText?: string
  cancelText?: string
  variant?: 'danger' | 'warning' | 'info'
  onConfirm: () => void
  onCancel: () => void
}

const VARIANTS = {
  danger: {
    icon: 'warning',
    iconColor: 'text-red-400',
    iconBg: 'bg-red-500/10',
    btnBg: 'bg-red-500 hover:bg-red-600',
  },
  warning: {
    icon: 'error_outline',
    iconColor: 'text-amber-400',
    iconBg: 'bg-amber-500/10',
    btnBg: 'bg-amber-500 hover:bg-amber-600',
  },
  info: {
    icon: 'info',
    iconColor: 'text-blue-400',
    iconBg: 'bg-blue-500/10',
    btnBg: 'bg-blue-500 hover:bg-blue-600',
  },
}

export function ConfirmModal({
  open,
  title,
  message,
  detail,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'danger',
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  if (!open) return null

  const v = VARIANTS[variant]

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div
        ref={overlayRef}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
        style={{ animationDuration: '0.15s' }}
        onClick={onCancel}
      />

      {/* Modal */}
      <div
        className="relative w-full max-w-md bg-bg-card rounded-2xl border border-border-subtle shadow-2xl overflow-hidden animate-fade-in-up"
        style={{ animationDuration: '0.2s' }}
      >
        <div className="p-6">
          {/* Icon + Title */}
          <div className="flex items-start gap-4">
            <div className={`p-2.5 rounded-xl ${v.iconBg} shrink-0`}>
              <span className={`material-symbols-outlined text-[24px] ${v.iconColor}`}>
                {v.icon}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-bold text-text-main">{title}</h3>
              <p className="text-sm text-text-muted mt-1.5 leading-relaxed">{message}</p>
            </div>
          </div>

          {/* Detail (query preview) */}
          {detail && (
            <div className="mt-4 p-3 rounded-lg bg-bg-app border border-border-subtle/50 max-h-32 overflow-auto">
              <code className="text-xs font-mono text-text-muted whitespace-pre-wrap break-all">
                {detail}
              </code>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="px-6 py-4 border-t border-border-subtle/30 flex items-center justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm font-medium text-text-muted hover:text-text-main hover:bg-bg-hover/50 transition-all"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className={`px-5 py-2 rounded-lg text-sm font-semibold text-white ${v.btnBg} transition-all active:scale-[0.97]`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
