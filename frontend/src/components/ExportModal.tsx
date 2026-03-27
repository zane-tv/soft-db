import { useState, useCallback, useRef } from 'react'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import {
  useWorkspaceExport,
  useDatabaseExport,
  useExportProgress,
} from '@/hooks/useExportImport'
import { useSettings } from '@/hooks/useSettings'
import { useTranslation } from '@/lib/i18n'
import { DataExportFormat } from '@/lib/export-types'
import type { DatabaseExportRequest } from '@/lib/export-types'

interface ExportModalProps {
  open: boolean
  onClose: () => void
  mode: 'workspace' | 'database'
  connectionId?: string
  databaseName?: string
  tables?: string[]
  dbType?: string
  defaultDataFormat?: DataExportFormat
  defaultIncludeSchema?: boolean
  defaultIncludeData?: boolean
}

type ModalState = 'form' | 'exporting' | 'success' | 'error'

const SQL_FORMATS: { value: DataExportFormat; label: string }[] = [
  { value: DataExportFormat.FormatCSV, label: 'CSV' },
  { value: DataExportFormat.FormatJSON, label: 'JSON' },
  { value: DataExportFormat.FormatSQLInsert, label: 'SQL INSERT' },
]

const MONGO_FORMATS: { value: DataExportFormat; label: string }[] = [
  { value: DataExportFormat.FormatExtendedJSON, label: 'Extended JSON' },
  { value: DataExportFormat.FormatJSON, label: 'JSON' },
  { value: DataExportFormat.FormatCSV, label: 'CSV' },
]

export function ExportModal({
  open,
  onClose,
  mode,
  connectionId,
  databaseName,
  tables = [],
  dbType,
  defaultDataFormat,
  defaultIncludeSchema,
  defaultIncludeData,
}: ExportModalProps) {
  const overlayRef = useRef<HTMLButtonElement>(null)
  const modalRef = useRef<HTMLDivElement>(null)
  const { data: settings } = useSettings()
  const { t } = useTranslation((settings?.language as 'en' | 'vi') ?? 'en')
  const { exportWorkspace, isExporting: isWorkspaceExporting } = useWorkspaceExport()
  const { exportDatabase, isExporting: isDatabaseExporting, cancel: cancelExport } = useDatabaseExport()
  const { progress, isActive, error: progressError } = useExportProgress()

  // Shared state
  const [modalState, setModalState] = useState<ModalState>('form')
  const [errorMessage, setErrorMessage] = useState('')

  // Workspace form state
  const [passphrase, setPassphrase] = useState('')
  const [showPassphrase, setShowPassphrase] = useState(false)

  // Database form state
  const [includeSchema, setIncludeSchema] = useState(defaultIncludeSchema ?? true)
  const [includeData, setIncludeData] = useState(defaultIncludeData ?? true)
  const [dataFormat, setDataFormat] = useState<DataExportFormat>(
    defaultDataFormat ?? (dbType === 'mongodb' ? DataExportFormat.FormatExtendedJSON : DataExportFormat.FormatSQLInsert)
  )
  const [selectedTables, setSelectedTables] = useState<string[]>(tables)

  const isMongo = dbType === 'mongodb'
  const formatOptions = isMongo ? MONGO_FORMATS : SQL_FORMATS
  const isExporting = isWorkspaceExporting || isDatabaseExporting || isActive

  const resetState = useCallback(() => {
    setModalState('form')
    setErrorMessage('')
    setPassphrase('')
    setShowPassphrase(false)
    setIncludeSchema(defaultIncludeSchema ?? true)
    setIncludeData(defaultIncludeData ?? true)
    setDataFormat(defaultDataFormat ?? (dbType === 'mongodb' ? DataExportFormat.FormatExtendedJSON : DataExportFormat.FormatSQLInsert))
    setSelectedTables(tables)
  }, [dbType, tables, defaultDataFormat, defaultIncludeSchema, defaultIncludeData])

  const handleClose = useCallback(() => {
    resetState()
    onClose()
  }, [resetState, onClose])

  const toggleTable = useCallback((table: string) => {
    setSelectedTables((prev) =>
      prev.includes(table) ? prev.filter((t) => t !== table) : [...prev, table]
    )
  }, [])

  const toggleAllTables = useCallback(() => {
    setSelectedTables((prev) => (prev.length === tables.length ? [] : [...tables]))
  }, [tables])

  const handleWorkspaceExport = useCallback(async () => {
    setModalState('exporting')
    setErrorMessage('')
    try {
      await exportWorkspace(passphrase)
      setModalState('success')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg === 'Export cancelled') {
        setModalState('form')
        return
      }
      setErrorMessage(msg)
      setModalState('error')
    }
  }, [exportWorkspace, passphrase])

  const handleDatabaseExport = useCallback(async () => {
    if (!connectionId) return
    setModalState('exporting')
    setErrorMessage('')
    try {
      const req: Omit<DatabaseExportRequest, 'filePath'> = {
        connectionId,
        databaseName,
        tables: selectedTables.length > 0 ? selectedTables : undefined,
        includeSchema,
        includeData,
        dataFormat,
      }
      await exportDatabase(req)
      setModalState('success')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg === 'Export cancelled') {
        setModalState('form')
        return
      }
      setErrorMessage(msg)
      setModalState('error')
    }
  }, [connectionId, databaseName, selectedTables, includeSchema, includeData, dataFormat, exportDatabase])

  const handleExport = useCallback(() => {
    if (mode === 'workspace') handleWorkspaceExport()
    else handleDatabaseExport()
  }, [mode, handleWorkspaceExport, handleDatabaseExport])

  const handleCancel = useCallback(() => {
    cancelExport()
    setModalState('form')
  }, [cancelExport])

  const handleRetry = useCallback(() => {
    setModalState('form')
    setErrorMessage('')
  }, [])

  useFocusTrap(modalRef, open, handleClose)

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-modal-title"
    >
      {/* Backdrop */}
      <button
        type="button"
        ref={overlayRef}
          aria-label={t('export.close')}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
        style={{ animationDuration: '0.2s' }}
        onClick={handleClose}
      />

      {/* Modal */}
      <div
        ref={modalRef}
        className="relative w-full max-w-[520px] max-h-[90vh] bg-bg-card rounded-2xl border border-border-subtle flex flex-col overflow-hidden animate-fade-in-up"
        style={{ animationDuration: '0.3s' }}
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-border-subtle flex items-center justify-between shrink-0">
          <div>
            <h2 id="export-modal-title" className="text-lg font-bold text-text-main">
              {mode === 'workspace' ? t('export.workspaceTitle') : t('export.databaseTitle')}
            </h2>
            <p className="text-sm text-text-muted mt-0.5">
              {mode === 'workspace'
                ? t('export.workspaceDesc')
                : databaseName || t('export.databaseTitle')}
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label={t('export.close')}
            className="text-text-muted hover:text-text-main p-1.5 rounded-lg hover:bg-white/5 transition-colors duration-200"
          >
            <span className="material-symbols-outlined text-[22px]">close</span>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* ─── Exporting State ─── */}
          {modalState === 'exporting' && (
            <div className="space-y-4 py-4">
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-[20px] text-primary animate-spin">
                  progress_activity
                </span>
                <span className="text-sm font-medium text-text-main">
                  {progress?.message || t('export.preparing')}
                </span>
              </div>

              {/* Progress bar */}
              <div className="w-full h-2 bg-bg-app rounded-full overflow-hidden border border-border-subtle/50">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${progress?.percentage ?? 0}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-xs text-text-muted">
                <span>{progress?.phase || t('export.initializing')}</span>
                <span>{Math.round(progress?.percentage ?? 0)}%</span>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={handleCancel}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-error hover:bg-error/10 border border-error/20 transition-all duration-200"
                >
                  <span className="material-symbols-outlined text-[16px]">cancel</span>
                  {t('export.cancel')}
                </button>
              </div>
            </div>
          )}

          {/* ─── Success State ─── */}
          {modalState === 'success' && (
            <div className="flex flex-col items-center gap-4 py-8">
              <div className="w-14 h-14 rounded-full bg-success/10 border border-success/20 flex items-center justify-center">
                <span className="material-symbols-outlined text-[28px] text-success">
                  check_circle
                </span>
              </div>
              <div className="text-center">
                <p className="text-base font-semibold text-text-main">{t('export.success')}</p>
                <p className="text-sm text-text-muted mt-1">{t('export.successMessage')}</p>
              </div>
            </div>
          )}

          {/* ─── Error State ─── */}
          {modalState === 'error' && (
            <div className="space-y-4 py-4">
              <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-error/10 border border-error/20">
                <span className="material-symbols-outlined text-[18px] text-error mt-0.5">error</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-error">{t('export.error')}</p>
                  <p className="text-xs text-text-muted mt-1 break-words">
                    {errorMessage || progressError || t('export.unexpectedError')}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ─── Form: Workspace Mode ─── */}
          {modalState === 'form' && mode === 'workspace' && (
            <>
              {/* Passphrase */}
              <div>
                <label
                  htmlFor="export-passphrase"
                  className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-2"
                >
                  {t('export.passphrase')}
                </label>
                <div className="relative">
                  <input
                    id="export-passphrase"
                    type={showPassphrase ? 'text' : 'password'}
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                    className="w-full bg-bg-app border border-border-subtle rounded-lg px-3 py-2.5 pr-10 text-sm text-text-main placeholder:text-text-muted/50 focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all duration-200"
                     placeholder={t('export.passphrasePlaceholder')}
                   />
                  <p className="text-xs text-text-muted mt-1.5">{t('export.passphraseHint')}</p>
                  <button
                    type="button"
                    onClick={() => setShowPassphrase(!showPassphrase)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-main p-1 rounded transition-colors"
                     aria-label={t('export.passphrase')}
                  >
                    <span className="material-symbols-outlined text-[18px]">
                      {showPassphrase ? 'visibility_off' : 'visibility'}
                    </span>
                  </button>
                </div>
              </div>

              {/* Warning when passphrase is empty */}
              {!passphrase && (
                <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-warning/10 border border-warning/20 animate-fade-in">
                  <span className="material-symbols-outlined text-[18px] text-warning mt-0.5">
                    warning
                  </span>
                  <p className="text-xs text-text-muted leading-relaxed">
                     {t('export.noPassphraseWarning')}
                  </p>
                </div>
              )}
            </>
          )}

          {/* ─── Form: Database Mode ─── */}
          {modalState === 'form' && mode === 'database' && (
            <>
              {/* Schema & Data toggles */}
              <div className="space-y-3">
                <span className="block text-xs font-semibold text-text-muted uppercase tracking-wider">
                  {`${t('export.includeSchema')} / ${t('export.includeData')}`}
                </span>
                <div className="flex gap-3">
                  <label className="flex items-center gap-2.5 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={includeSchema}
                      onChange={(e) => setIncludeSchema(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-5 h-5 rounded-md border border-border-subtle bg-bg-app flex items-center justify-center transition-all duration-200 peer-checked:bg-primary peer-checked:border-primary">
                      {includeSchema && (
                        <span className="material-symbols-outlined text-[14px] text-white">check</span>
                      )}
                    </div>
                    <span className="text-sm text-text-main group-hover:text-text-main/90">
                      {t('export.includeSchema')}
                    </span>
                  </label>

                  <label className="flex items-center gap-2.5 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={includeData}
                      onChange={(e) => setIncludeData(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-5 h-5 rounded-md border border-border-subtle bg-bg-app flex items-center justify-center transition-all duration-200 peer-checked:bg-primary peer-checked:border-primary">
                      {includeData && (
                        <span className="material-symbols-outlined text-[14px] text-white">check</span>
                      )}
                    </div>
                    <span className="text-sm text-text-main group-hover:text-text-main/90">
                      {t('export.includeData')}
                    </span>
                  </label>
                </div>
              </div>

              {/* Format selector */}
              <div>
                <label
                  htmlFor="export-format"
                  className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-2"
                >
                  {t('export.format')}
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {formatOptions.map((fmt) => (
                    <button
                      key={fmt.value}
                      type="button"
                      onClick={() => setDataFormat(fmt.value)}
                      className={`px-3 py-2.5 rounded-lg border text-sm font-medium transition-all duration-200 ${
                        dataFormat === fmt.value
                          ? 'border-primary/50 bg-primary/10 text-text-main'
                          : 'border-border-subtle bg-bg-app text-text-muted hover:bg-bg-hover/50 hover:text-text-main'
                      }`}
                    >
                      {fmt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Table selector */}
              {tables.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="block text-xs font-semibold text-text-muted uppercase tracking-wider">
                      {t('export.tables')}
                    </span>
                    <button
                      type="button"
                      onClick={toggleAllTables}
                      className="text-xs text-primary hover:text-primary-hover transition-colors"
                    >
                      {selectedTables.length === tables.length ? t('export.deselectAll') : t('export.selectAll')}
                    </button>
                  </div>
                  <div className="max-h-[200px] overflow-y-auto bg-bg-app rounded-lg border border-border-subtle divide-y divide-border-subtle/30">
                    {tables.map((table) => (
                      <label
                        key={table}
                        className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-bg-hover/30 transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={selectedTables.includes(table)}
                          onChange={() => toggleTable(table)}
                          className="sr-only peer"
                        />
                        <div className="w-4 h-4 rounded border border-border-subtle bg-bg-card flex items-center justify-center shrink-0 transition-all duration-200 peer-checked:bg-primary peer-checked:border-primary">
                          {selectedTables.includes(table) && (
                            <span className="material-symbols-outlined text-[12px] text-white">check</span>
                          )}
                        </div>
                        <span className="text-sm text-text-main font-mono truncate">{table}</span>
                      </label>
                    ))}
                  </div>
                  <p className="text-[10px] text-text-muted/40 mt-1.5">
                    {selectedTables.length === 0
                      ? t('export.allTablesHint')
                      : `${selectedTables.length}/${tables.length} ${t('export.tables')}`}
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border-subtle flex items-center justify-end gap-3 shrink-0 bg-bg-card">
          {modalState === 'form' && (
            <>
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 rounded-lg text-sm text-text-muted hover:text-text-main transition-colors duration-200"
              >
                {t('export.cancel')}
              </button>
              <button
                type="button"
                onClick={handleExport}
                disabled={isExporting || (mode === 'database' && !includeSchema && !includeData)}
                className="flex items-center gap-2 px-5 py-2 rounded-lg bg-primary hover:bg-primary-hover text-white text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 active:scale-[0.97]"
              >
                <span className="material-symbols-outlined text-[18px]">download</span>
                {isExporting ? t('export.exporting') : t('export.startExport')}
              </button>
            </>
          )}

          {modalState === 'success' && (
            <button
              type="button"
              onClick={handleClose}
              className="flex items-center gap-2 px-5 py-2 rounded-lg bg-primary hover:bg-primary-hover text-white text-sm font-semibold transition-all duration-200 active:scale-[0.97]"
            >
              {t('export.close')}
            </button>
          )}

          {modalState === 'error' && (
            <>
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 rounded-lg text-sm text-text-muted hover:text-text-main transition-colors duration-200"
              >
                {t('export.close')}
              </button>
              <button
                type="button"
                onClick={handleRetry}
                className="flex items-center gap-2 px-5 py-2 rounded-lg bg-primary hover:bg-primary-hover text-white text-sm font-semibold transition-all duration-200 active:scale-[0.97]"
              >
                <span className="material-symbols-outlined text-[18px]">refresh</span>
                {t('export.retry')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
