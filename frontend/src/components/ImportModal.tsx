import { useState, useEffect, useCallback, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Dialogs } from '@wailsio/runtime'
import * as ImportService from '../../bindings/soft-db/services/importservice'
import { useImportProgress } from '@/hooks/useExportImport'
import { connectionKeys } from '@/hooks/useConnections'
import { settingsKeys, useSettings } from '@/hooks/useSettings'
import { useTranslation } from '@/lib/i18n'
import { ConflictStrategy } from '@/lib/export-types'
import type { TranslationKey } from '@/lib/i18n'
import type { WorkspaceImportResult } from '@/lib/export-types'

interface ImportModalProps {
  open: boolean
  onClose: () => void
  mode: 'workspace' | 'database'
  connectionId?: string
  databaseName?: string
}

type Step = 'config' | 'progress' | 'complete' | 'error'

const WORKSPACE_STRATEGIES: { value: ConflictStrategy; labelKey: TranslationKey; icon: string; descKey: TranslationKey }[] = [
  { value: ConflictStrategy.ConflictSkip, labelKey: 'import.strategy.skip', icon: 'skip_next', descKey: 'import.strategy.skipDesc' },
  { value: ConflictStrategy.ConflictReplace, labelKey: 'import.strategy.replace', icon: 'swap_horiz', descKey: 'import.strategy.replaceDesc' },
  { value: ConflictStrategy.ConflictRename, labelKey: 'import.strategy.rename', icon: 'content_copy', descKey: 'import.strategy.renameDesc' },
]

const SCHEMA_STRATEGIES: { value: ConflictStrategy; labelKey: TranslationKey }[] = [
  { value: ConflictStrategy.ConflictSkip, labelKey: 'import.strategy.schemaSkip' },
  { value: ConflictStrategy.ConflictReplace, labelKey: 'import.strategy.schemaReplace' },
]

const DATA_STRATEGIES: { value: ConflictStrategy; labelKey: TranslationKey }[] = [
  { value: ConflictStrategy.ConflictSkip, labelKey: 'import.strategy.dataSkip' },
  { value: ConflictStrategy.ConflictReplace, labelKey: 'import.strategy.dataReplace' },
]

function detectFormat(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'sql': return 'SQL'
    case 'json': return 'JSON'
    case 'csv': return 'CSV'
    case 'softdb': return 'SOFTDB'
    default: return ext?.toUpperCase() || ''
  }
}

function getFileName(filePath: string): string {
  return filePath.split(/[/\\]/).pop() || filePath
}

export function ImportModal({ open, onClose, mode, connectionId, databaseName }: ImportModalProps) {
  const overlayRef = useRef<HTMLButtonElement>(null)
  const qc = useQueryClient()
  const { data: settings } = useSettings()
  const { t } = useTranslation((settings?.language as 'en' | 'vi') ?? 'en')
  const { progress: importProgress, isActive: isImportActive, error: importEventError } = useImportProgress()

  const [step, setStep] = useState<Step>('config')
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [passphrase, setPassphrase] = useState('')
  const [conflictStrategy, setConflictStrategy] = useState<ConflictStrategy>(ConflictStrategy.ConflictSkip)
  const [schemaStrategy, setSchemaStrategy] = useState<ConflictStrategy>(ConflictStrategy.ConflictSkip)
  const [dataStrategy, setDataStrategy] = useState<ConflictStrategy>(ConflictStrategy.ConflictSkip)
  const [importResult, setImportResult] = useState<WorkspaceImportResult | null>(null)
  const [errorMessage, setErrorMessage] = useState('')

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setStep('config')
      setSelectedFile(null)
      setPassphrase('')
      setConflictStrategy(ConflictStrategy.ConflictSkip)
      setSchemaStrategy(ConflictStrategy.ConflictSkip)
      setDataStrategy(ConflictStrategy.ConflictSkip)
      setImportResult(null)
      setErrorMessage('')
    }
  }, [open])

  // Transition to error if import event reports failure
  useEffect(() => {
    if (importEventError && step === 'progress') {
      setErrorMessage(importEventError)
      setStep('error')
    }
  }, [importEventError, step])

  const handleSelectFile = useCallback(async () => {
    try {
      const filters = mode === 'workspace'
        ? [
            { DisplayName: 'SOFTDB', Pattern: '*.softdb;*.json' },
            { DisplayName: '*', Pattern: '*.*' },
          ]
        : [
            { DisplayName: 'SQL', Pattern: '*.sql' },
            { DisplayName: 'JSON', Pattern: '*.json' },
            { DisplayName: 'CSV', Pattern: '*.csv' },
            { DisplayName: '*', Pattern: '*.*' },
          ]

      const path = await Dialogs.OpenFile({
        Title: mode === 'workspace' ? t('import.workspaceTitle') : t('import.databaseTitle'),
        Filters: filters,
      })
      if (path) {
        setSelectedFile(path as string)
      }
    } catch {
      // user cancelled
    }
  }, [mode, t])

  const workspaceMutation = useMutation({
    mutationFn: async () => {
      if (!selectedFile) throw new Error(t('import.noFileSelected'))
      const result = await ImportService.ImportWorkspaceFromFile(
        selectedFile,
        passphrase,
        conflictStrategy
      )
      return result as WorkspaceImportResult
    },
    onSuccess: (result) => {
      setImportResult(result)
      setStep('complete')
      qc.invalidateQueries({ queryKey: connectionKeys.all })
      qc.invalidateQueries({ queryKey: settingsKeys.all })
      qc.invalidateQueries({ queryKey: ['snippets'] })
    },
    onError: (err) => {
      setErrorMessage(err instanceof Error ? err.message : String(err))
      setStep('error')
    },
  })

  const databaseMutation = useMutation({
    mutationFn: async () => {
      if (!selectedFile) throw new Error(t('import.noFileSelected'))
      if (!connectionId) throw new Error(t('import.unexpectedError'))
      await ImportService.ImportDatabase({
        connectionId,
        databaseName,
        filePath: selectedFile,
        schemaStrategy,
        dataStrategy,
      })
    },
    onSuccess: () => {
      setStep('complete')
    },
    onError: (err) => {
      setErrorMessage(err instanceof Error ? err.message : String(err))
      setStep('error')
    },
  })

  const handleImport = useCallback(() => {
    setStep('progress')
    if (mode === 'workspace') {
      workspaceMutation.mutate()
    } else {
      databaseMutation.mutate()
    }
  }, [mode, workspaceMutation, databaseMutation])

  const handleReset = useCallback(() => {
    setStep('config')
    setErrorMessage('')
    setImportResult(null)
  }, [])

  const handleClose = useCallback(() => {
    onClose()
  }, [onClose])

  const isImporting = workspaceMutation.isPending || databaseMutation.isPending || isImportActive
  const canImport = !!selectedFile && (mode === 'database' ? !!connectionId : true)

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-modal-title"
      onKeyDown={(e: ReactKeyboardEvent) => { if (e.key === 'Escape' && !isImporting) handleClose() }}
    >
      {/* Backdrop */}
      <button
        type="button"
        ref={overlayRef}
        aria-label={t('import.close')}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
        style={{ animationDuration: '0.2s' }}
        onClick={() => { if (!isImporting) handleClose() }}
        onKeyDown={(e: ReactKeyboardEvent) => { if (e.key === 'Escape' && !isImporting) handleClose() }}
      />

      {/* Modal */}
      <div
        className="relative w-full max-w-[520px] max-h-[90vh] bg-bg-card rounded-2xl border border-border-subtle flex flex-col overflow-hidden animate-fade-in-up"
        style={{ animationDuration: '0.3s' }}
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-border-subtle flex items-center justify-between shrink-0">
          <div>
            <h2 id="import-modal-title" className="text-lg font-bold text-text-main">
              {mode === 'workspace' ? t('import.workspaceTitle') : t('import.databaseTitle')}
            </h2>
            <p className="text-sm text-text-muted mt-0.5">
              {mode === 'workspace'
                ? t('import.workspaceDesc')
                : t('import.databaseDesc')}
            </p>
          </div>
          {!isImporting && (
            <button
              type="button"
              onClick={handleClose}
              aria-label={t('import.close')}
              className="text-text-muted hover:text-text-main p-1.5 rounded-lg hover:bg-white/5 transition-colors duration-200"
            >
              <span className="material-symbols-outlined text-[22px]">close</span>
            </button>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* ── Config Step ── */}
          {step === 'config' && (
            <>
              {/* File Selection */}
              <div>
                <p className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
                  {t('import.selectFile')}
                </p>
                <div className="flex gap-2">
                  <div className="flex-1 bg-bg-app border border-border-subtle rounded-lg px-3 py-2.5 text-sm text-text-main min-h-[40px] flex items-center">
                    {selectedFile ? (
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="material-symbols-outlined text-[18px] text-primary shrink-0">description</span>
                        <span className="truncate font-mono text-xs">{getFileName(selectedFile)}</span>
                        {mode === 'database' && (
                          <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-primary/10 text-primary">
                            {detectFormat(selectedFile)}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-text-muted/50">{t('import.noFileSelected')}</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={handleSelectFile}
                    className="flex items-center gap-1.5 px-3 py-2.5 rounded-lg border border-border-subtle bg-bg-app text-sm font-medium text-text-muted hover:text-text-main hover:bg-bg-hover/50 transition-all duration-200 shrink-0"
                  >
                    <span className="material-symbols-outlined text-[18px]">folder_open</span>
                    {selectedFile ? t('import.changeFile') : t('import.selectFile')}
                  </button>
                </div>
              </div>

              {/* ── Workspace Options ── */}
              {mode === 'workspace' && (
                <>
                  {/* Passphrase */}
                  <div>
                    <label htmlFor="import-passphrase" className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
                      {t('import.passphrase')}
                    </label>
                    <input
                      id="import-passphrase"
                      type="password"
                      value={passphrase}
                      onChange={(e) => setPassphrase(e.target.value)}
                      className="w-full bg-bg-app border border-border-subtle rounded-lg px-3 py-2.5 text-sm text-text-main placeholder:text-text-muted/50 focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all duration-200"
                      placeholder={t('import.passphrasePlaceholder')}
                    />
                    <p className="text-xs text-text-muted mt-1.5">{t('import.passphraseHint')}</p>
                  </div>

                  {/* Conflict Strategy */}
                  <div>
                    <p className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
                      {t('import.conflictStrategy')}
                    </p>
                    <div className="space-y-1.5">
                      {WORKSPACE_STRATEGIES.map((s) => (
                        <button
                          key={s.value}
                          type="button"
                          onClick={() => setConflictStrategy(s.value)}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-sm transition-all duration-200 text-left ${
                            conflictStrategy === s.value
                              ? 'border-primary/50 bg-primary/10 text-text-main'
                              : 'border-border-subtle bg-bg-app text-text-muted hover:bg-bg-hover/50 hover:text-text-main'
                          }`}
                        >
                          <span className={`material-symbols-outlined text-[18px] ${
                            conflictStrategy === s.value ? 'text-primary' : ''
                          }`}>{s.icon}</span>
                          <div>
                            <span className="font-medium">{t(s.labelKey)}</span>
                            <p className="text-xs text-text-muted/60 mt-0.5">{t(s.descKey)}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* ── Database Options ── */}
              {mode === 'database' && (
                <>
                  {/* Schema Conflict */}
                  <div>
                    <p className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
                      {t('import.schemaConflict')}
                    </p>
                    <div className="flex gap-2">
                      {SCHEMA_STRATEGIES.map((s) => (
                        <button
                          key={s.value}
                          type="button"
                          onClick={() => setSchemaStrategy(s.value)}
                          className={`flex-1 px-3 py-2.5 rounded-lg border text-sm font-medium transition-all duration-200 ${
                            schemaStrategy === s.value
                              ? 'border-primary/50 bg-primary/10 text-text-main'
                              : 'border-border-subtle bg-bg-app text-text-muted hover:bg-bg-hover/50 hover:text-text-main'
                          }`}
                        >
                          {t(s.labelKey)}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Data Conflict */}
                  <div>
                    <p className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
                      {t('import.dataConflict')}
                    </p>
                    <div className="flex gap-2">
                      {DATA_STRATEGIES.map((s) => (
                        <button
                          key={s.value}
                          type="button"
                          onClick={() => setDataStrategy(s.value)}
                          className={`flex-1 px-3 py-2.5 rounded-lg border text-sm font-medium transition-all duration-200 ${
                            dataStrategy === s.value
                              ? 'border-primary/50 bg-primary/10 text-text-main'
                              : 'border-border-subtle bg-bg-app text-text-muted hover:bg-bg-hover/50 hover:text-text-main'
                          }`}
                        >
                          {t(s.labelKey)}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {/* ── Progress Step ── */}
          {step === 'progress' && (
            <div className="py-4 space-y-4">
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-[22px] text-primary animate-spin">progress_activity</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text-main">
                    {importProgress?.message || t('import.importing')}
                  </p>
                  {importProgress && (
                    <p className="text-xs text-text-muted mt-0.5">
                      {importProgress.phase} \u2014 {importProgress.current}/{importProgress.total}
                    </p>
                  )}
                </div>
              </div>

              {/* Progress Bar */}
              <div className="w-full bg-bg-app rounded-full h-2 overflow-hidden border border-border-subtle/50">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${importProgress?.percentage ?? 0}%` }}
                />
              </div>

              {importProgress && (
                <p className="text-xs text-text-muted text-right">{Math.round(importProgress.percentage)}%</p>
              )}
            </div>
          )}

          {/* ── Complete Step ── */}
          {step === 'complete' && (
            <div className="py-4 space-y-4">
              <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                <span className="material-symbols-outlined text-[22px] text-emerald-400">check_circle</span>
                <span className="text-sm font-medium text-emerald-400">{t('import.success')}</span>
              </div>

              {/* Workspace result summary */}
              {mode === 'workspace' && importResult && (
                <div className="space-y-2 px-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-text-muted">{t('import.connections')} {t('import.imported')}</span>
                    <span className="text-text-main font-medium">{importResult.connectionsImported}</span>
                  </div>
                  {importResult.connectionsSkipped > 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-text-muted">{t('import.connections')} {t('import.skipped')}</span>
                      <span className="text-text-muted">{importResult.connectionsSkipped}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-text-muted">{t('import.snippets')} {t('import.imported')}</span>
                    <span className="text-text-main font-medium">{importResult.snippetsImported}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-text-muted">{t('import.settings')}</span>
                    <span className="text-text-main font-medium">
                      {importResult.settingsImported ? t('import.restored') : t('import.settingsSkipped')}
                    </span>
                  </div>
                </div>
              )}

              {mode === 'database' && selectedFile && (
                <p className="text-sm text-text-muted px-1">
                  <span className="font-mono text-text-main">{getFileName(selectedFile)}</span>.
                </p>
              )}
            </div>
          )}

          {/* ── Error Step ── */}
          {step === 'error' && (
            <div className="py-4 space-y-4">
              <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20">
                <span className="material-symbols-outlined text-[22px] text-red-400 shrink-0 mt-0.5">error</span>
                <div>
                  <p className="text-sm font-medium text-red-400">{t('import.error')}</p>
                  <p className="text-xs text-red-400/70 mt-1 break-all">{errorMessage || importEventError || t('import.unexpectedError')}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border-subtle flex items-center justify-end gap-3 shrink-0 bg-bg-card">
          {step === 'config' && (
            <>
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 rounded-lg text-sm text-text-muted hover:text-text-main transition-colors duration-200"
              >
                {t('import.cancel')}
              </button>
              <button
                type="button"
                onClick={handleImport}
                disabled={!canImport || isImporting}
                className="flex items-center gap-2 px-5 py-2 rounded-lg bg-primary hover:bg-primary-hover text-white text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 active:scale-[0.97]"
              >
                <span className="material-symbols-outlined text-[18px]">upload</span>
                {t('import.startImport')}
              </button>
            </>
          )}

          {step === 'progress' && (
            <button
              type="button"
              onClick={handleClose}
              disabled={isImporting}
              className="px-4 py-2 rounded-lg text-sm text-text-muted hover:text-text-main disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-200"
            >
              {t('import.cancel')}
            </button>
          )}

          {step === 'complete' && (
            <button
              type="button"
              onClick={handleClose}
              className="flex items-center gap-2 px-5 py-2 rounded-lg bg-primary hover:bg-primary-hover text-white text-sm font-semibold transition-all duration-200 active:scale-[0.97]"
            >
              {t('import.close')}
            </button>
          )}

          {step === 'error' && (
            <>
              <button
                type="button"
                onClick={handleReset}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm text-text-muted hover:text-text-main hover:bg-white/5 transition-all duration-200"
              >
                <span className="material-symbols-outlined text-[18px]">refresh</span>
                {t('import.retry')}
              </button>
              <button
                type="button"
                onClick={handleClose}
                className="flex items-center gap-2 px-5 py-2 rounded-lg bg-primary hover:bg-primary-hover text-white text-sm font-semibold transition-all duration-200 active:scale-[0.97]"
              >
                {t('import.close')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
