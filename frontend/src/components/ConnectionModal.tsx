import { useState, useEffect, useCallback, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { ConnectionConfig, DatabaseType } from '../../bindings/soft-db/internal/driver/models'
import { useSaveConnection, useTestConnection } from '@/hooks/useConnections'
import { Dialogs } from '@wailsio/runtime'

interface ConnectionModalProps {
  open: boolean
  onClose: () => void
  editConnection?: ConnectionConfig | null
}

const DB_TYPES = [
  { value: DatabaseType.MySQL, label: 'MySQL', icon: 'table_view', color: '#F29111' },
  { value: DatabaseType.MariaDB, label: 'MariaDB', icon: 'table_view', color: '#4EA3A4' },
  { value: DatabaseType.PostgreSQL, label: 'PostgreSQL', icon: 'database', color: '#336791' },
  { value: DatabaseType.SQLite, label: 'SQLite', icon: 'storage', color: '#44A8E0' },
  { value: DatabaseType.MongoDB, label: 'MongoDB', icon: 'data_object', color: '#00ED64' },
  { value: DatabaseType.Redshift, label: 'Redshift', icon: 'cloud', color: '#8C4FFF' },
]

const DEFAULT_PORTS: Record<string, number> = {
  mysql: 3306,
  mariadb: 3306,
  postgresql: 5432,
  sqlite: 0,
  mongodb: 27017,
  redshift: 5439,
}

export function ConnectionModal({ open, onClose, editConnection }: ConnectionModalProps) {
  const saveMutation = useSaveConnection()
  const testMutation = useTestConnection()
  const overlayRef = useRef<HTMLDivElement>(null)

  const [form, setForm] = useState({
    name: '',
    type: DatabaseType.PostgreSQL as DatabaseType,
    host: 'localhost',
    port: '5432',
    database: '',
    username: '',
    password: '',
    filePath: '',
    sslMode: '',
    uri: '',
  })
  const [useURI, setUseURI] = useState(false)

  const [testResult, setTestResult] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
  const [testError, setTestError] = useState('')

  // Populate form when editing
  useEffect(() => {
    if (editConnection) {
      setForm({
        name: editConnection.name,
        type: editConnection.type,
        host: editConnection.host,
        port: String(editConnection.port),
        database: editConnection.database,
        username: editConnection.username,
        password: editConnection.password,
        filePath: editConnection.filePath || '',
        sslMode: editConnection.sslMode || '',
        uri: editConnection.uri || '',
      })
      setUseURI(!!editConnection.uri)
    } else {
      setForm({
        name: '',
        type: DatabaseType.PostgreSQL,
        host: 'localhost',
        port: '5432',
        database: '',
        username: '',
        password: '',
        filePath: '',
        sslMode: '',
        uri: '',
      })
      setUseURI(false)
    }
    setTestResult('idle')
    setTestError('')
  }, [editConnection, open])

  const updateField = useCallback(<K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    setTestResult('idle')
  }, [])

  const handleTypeChange = useCallback((type: DatabaseType) => {
    setForm((prev) => ({
      ...prev,
      type,
      port: String(DEFAULT_PORTS[type] || 0),
      host: type === DatabaseType.SQLite ? '' : prev.host || 'localhost',
    }))
    setTestResult('idle')
  }, [])

  const handleBrowseFile = useCallback(async () => {
    try {
      const path = await Dialogs.OpenFile({
        Title: 'Select SQLite Database',
        Filters: [
          { DisplayName: 'SQLite Files', Pattern: '*.db;*.sqlite;*.sqlite3;*.db3' },
          { DisplayName: 'All Files', Pattern: '*.*' },
        ],
      })
      if (path) {
        updateField('filePath', path as string)
      }
    } catch {
      // user cancelled
    }
  }, [updateField])

  const buildConfig = useCallback((): ConnectionConfig => {
    const isURIMode = useURI && form.type === DatabaseType.MongoDB
    return new ConnectionConfig({
      id: editConnection?.id || '',
      name: form.name,
      type: form.type,
      host: isURIMode ? '' : form.host,
      port: isURIMode ? 0 : (parseInt(form.port, 10) || 0),
      database: isURIMode ? '' : form.database,
      username: isURIMode ? '' : form.username,
      password: isURIMode ? '' : form.password,
      filePath: form.filePath || undefined,
      uri: isURIMode ? form.uri : undefined,
      sslMode: form.sslMode || undefined,
      status: 'offline',
    })
  }, [form, editConnection, useURI])

  const handleTest = useCallback(async () => {
    setTestResult('testing')
    setTestError('')
    try {
      await testMutation.mutateAsync(buildConfig())
      setTestResult('success')
    } catch (err: unknown) {
      setTestResult('error')
      setTestError(err instanceof Error ? err.message : String(err))
    }
  }, [testMutation, buildConfig])

  const handleSave = useCallback(async () => {
    try {
      await saveMutation.mutateAsync(buildConfig())
      onClose()
    } catch {
      // error handled by mutation
    }
  }, [saveMutation, buildConfig, onClose])

  const isSQLite = form.type === DatabaseType.SQLite
  const isMongo = form.type === DatabaseType.MongoDB
  const canSave = form.name.trim() && (
    isSQLite ? form.filePath.trim() || form.database.trim()
    : (useURI && isMongo) ? form.uri.trim()
    : form.host.trim()
  )

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="connection-modal-title"
      onKeyDown={(e: ReactKeyboardEvent) => { if (e.key === 'Escape') onClose() }}
    >
      {/* Backdrop */}
      <div
        ref={overlayRef}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
        style={{ animationDuration: '0.2s' }}
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-[560px] max-h-[90vh] bg-bg-card rounded-2xl border border-border-subtle flex flex-col overflow-hidden animate-fade-in-up"
        style={{ animationDuration: '0.3s' }}
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-border-subtle flex items-center justify-between shrink-0">
          <div>
            <h2 id="connection-modal-title" className="text-lg font-bold text-text-main">
              {editConnection ? 'Edit Connection' : 'New Connection'}
            </h2>
            <p className="text-sm text-text-muted mt-0.5">Configure your database connection details.</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="text-text-muted hover:text-text-main p-1.5 rounded-lg hover:bg-white/5 transition-colors duration-200"
          >
            <span className="material-symbols-outlined text-[22px]">close</span>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Connection Name */}
          <div>
            <label htmlFor="conn-name" className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
              Connection Name
            </label>
            <input
              id="conn-name"
              value={form.name}
              onChange={(e) => updateField('name', e.target.value)}
              className="w-full bg-bg-app border border-border-subtle rounded-lg px-3 py-2.5 text-sm text-text-main placeholder:text-text-muted/50 focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all duration-200"
              placeholder="e.g. Production Database"
            />
          </div>

          {/* Database Type */}
          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
              Database Type
            </label>
            <div className="grid grid-cols-3 gap-2">
              {DB_TYPES.map((db) => (
                <button
                  key={db.value}
                  onClick={() => handleTypeChange(db.value)}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-all duration-200 ${
                    form.type === db.value
                      ? 'border-primary/50 bg-primary/10 text-text-main'
                      : 'border-border-subtle bg-bg-app text-text-muted hover:bg-bg-hover/50 hover:text-text-main'
                  }`}
                >
                  <span className="material-symbols-outlined text-[18px]" style={{ color: db.color }}>
                    {db.icon}
                  </span>
                  {db.label}
                </button>
              ))}
            </div>
          </div>

          {/* Connection Fields */}
          {isSQLite ? (
            <div>
              <label htmlFor="conn-filepath" className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
                Database File Path
              </label>
              <div className="flex gap-2">
                <input
                  id="conn-filepath"
                  value={form.filePath}
                  onChange={(e) => updateField('filePath', e.target.value)}
                  className="flex-1 bg-bg-app border border-border-subtle rounded-lg px-3 py-2.5 text-sm font-mono text-text-main placeholder:text-text-muted/50 focus:ring-2 focus:ring-primary outline-none transition-all duration-200"
                  placeholder="/path/to/database.db"
                />
                <button
                  type="button"
                  onClick={handleBrowseFile}
                  className="flex items-center gap-1.5 px-3 py-2.5 rounded-lg border border-border-subtle bg-bg-app text-sm font-medium text-text-muted hover:text-text-main hover:bg-bg-hover/50 transition-all duration-200 shrink-0"
                >
                  <span className="material-symbols-outlined text-[18px]">folder_open</span>
                  Browse
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* MongoDB URI Toggle */}
              {isMongo && (
                <div className="flex items-center gap-3 p-2.5 rounded-lg bg-bg-hover/20 border border-border-subtle/30">
                  <button
                    type="button"
                    onClick={() => setUseURI(false)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200 ${
                      !useURI
                        ? 'bg-primary text-white shadow-sm'
                        : 'text-text-muted hover:text-text-main hover:bg-bg-hover/50'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[14px]">tune</span>
                    Form Fields
                  </button>
                  <button
                    type="button"
                    onClick={() => setUseURI(true)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200 ${
                      useURI
                        ? 'bg-primary text-white shadow-sm'
                        : 'text-text-muted hover:text-text-main hover:bg-bg-hover/50'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[14px]">link</span>
                    Connection URL
                  </button>
                </div>
              )}

              {/* MongoDB URI Input */}
              {isMongo && useURI ? (
                <div>
                  <label htmlFor="conn-uri" className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
                    Connection URL
                  </label>
                  <textarea
                    id="conn-uri"
                    value={form.uri}
                    onChange={(e) => updateField('uri', e.target.value)}
                    rows={3}
                    className="w-full bg-bg-app border border-border-subtle rounded-lg px-3 py-2.5 text-sm font-mono text-text-main placeholder:text-text-muted/50 focus:ring-2 focus:ring-primary outline-none transition-all duration-200 resize-none"
                    placeholder="mongodb+srv://user:password@cluster.mongodb.net/mydb?retryWrites=true&w=majority"
                    spellCheck={false}
                  />
                  <p className="text-[10px] text-text-muted/40 mt-1">Paste your MongoDB connection string from Atlas or your server</p>
                </div>
              ) : (
              <>
              {/* Host + Port */}
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label htmlFor="conn-host" className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
                    Host
                  </label>
                  <input
                    id="conn-host"
                    value={form.host}
                    onChange={(e) => updateField('host', e.target.value)}
                    className="w-full bg-bg-app border border-border-subtle rounded-lg px-3 py-2.5 text-sm text-text-main placeholder:text-text-muted/50 focus:ring-2 focus:ring-primary outline-none transition-all duration-200"
                    placeholder="localhost"
                  />
                </div>
                <div>
                  <label htmlFor="conn-port" className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
                    Port
                  </label>
                  <input
                    id="conn-port"
                    value={form.port}
                    onChange={(e) => updateField('port', e.target.value)}
                    type="number"
                    className="w-full bg-bg-app border border-border-subtle rounded-lg px-3 py-2.5 text-sm font-mono text-text-main focus:ring-2 focus:ring-primary outline-none transition-all duration-200 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </div>
              </div>

              {/* Database */}
              <div>
                <label htmlFor="conn-database" className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
                  Database <span className="text-text-muted/40 normal-case font-normal">(optional)</span>
                </label>
                <input
                  id="conn-database"
                  value={form.database}
                  onChange={(e) => updateField('database', e.target.value)}
                  className="w-full bg-bg-app border border-border-subtle rounded-lg px-3 py-2.5 text-sm text-text-main placeholder:text-text-muted/50 focus:ring-2 focus:ring-primary outline-none transition-all duration-200"
                  placeholder="my_database"
                />
                <p className="text-[10px] text-text-muted/40 mt-1">Leave empty to browse all databases</p>
              </div>

              {/* Username + Password */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="conn-username" className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
                    Username
                  </label>
                  <input
                    id="conn-username"
                    value={form.username}
                    onChange={(e) => updateField('username', e.target.value)}
                    className="w-full bg-bg-app border border-border-subtle rounded-lg px-3 py-2.5 text-sm text-text-main placeholder:text-text-muted/50 focus:ring-2 focus:ring-primary outline-none transition-all duration-200"
                    placeholder="root"
                  />
                </div>
                <div>
                  <label htmlFor="conn-password" className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
                    Password
                  </label>
                  <input
                    id="conn-password"
                    value={form.password}
                    onChange={(e) => updateField('password', e.target.value)}
                    type="password"
                    className="w-full bg-bg-app border border-border-subtle rounded-lg px-3 py-2.5 text-sm text-text-main placeholder:text-text-muted/50 focus:ring-2 focus:ring-primary outline-none transition-all duration-200"
                    placeholder="••••••••"
                  />
                </div>
              </div>
              </>
              )}
            </>
          )}

          {/* Test Result */}
          {testResult !== 'idle' && (
            <div
              className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm animate-fade-in ${
                testResult === 'testing'
                  ? 'bg-blue-500/10 border border-blue-500/20 text-blue-400'
                  : testResult === 'success'
                    ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
                    : 'bg-red-500/10 border border-red-500/20 text-red-400'
              }`}
            >
              <span className="material-symbols-outlined text-[18px]">
                {testResult === 'testing' ? 'sync' : testResult === 'success' ? 'check_circle' : 'error'}
              </span>
              <span>
                {testResult === 'testing'
                  ? 'Testing connection...'
                  : testResult === 'success'
                    ? 'Connection successful!'
                    : `Connection failed: ${testError}`}
              </span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border-subtle flex items-center justify-between shrink-0 bg-bg-card">
          <button
            onClick={handleTest}
            disabled={!canSave || testResult === 'testing'}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-text-muted hover:text-text-main hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200"
          >
            <span className={`material-symbols-outlined text-[18px] ${testResult === 'testing' ? 'animate-spin' : ''}`}>
              {testResult === 'success' ? 'check' : 'bolt'}
            </span>
            Test Connection
          </button>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm text-text-muted hover:text-text-main transition-colors duration-200"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!canSave || saveMutation.isPending}
              className="flex items-center gap-2 px-5 py-2 rounded-lg bg-primary hover:bg-primary-hover text-white text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 active:scale-[0.97]"
            >
              <span className="material-symbols-outlined text-[18px]">save</span>
              {editConnection ? 'Update' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
