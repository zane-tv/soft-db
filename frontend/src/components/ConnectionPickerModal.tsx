import { useState, useMemo } from 'react'
import { useConnections, useConnect, usePingAll } from '@/hooks/useConnections'
import { useSettings } from '@/hooks/useSettings'
import { useTranslation } from '@/lib/i18n'
import { ConnectionModal } from '@/components/ConnectionModal'
import { DatabaseType } from '../../bindings/soft-db/internal/driver/models'

// ─── Database Colors ───
const DB_COLORS: Record<string, { accent: string; icon: string; label: string }> = {
  postgresql: { accent: '#336791', icon: 'database', label: 'PostgreSQL' },
  mysql: { accent: '#F29111', icon: 'table_view', label: 'MySQL' },
  mariadb: { accent: '#4EA3A4', icon: 'table_view', label: 'MariaDB' },
  sqlite: { accent: '#44A8E0', icon: 'storage', label: 'SQLite' },
  mongodb: { accent: '#00ED64', icon: 'data_object', label: 'MongoDB' },
  redshift: { accent: '#8C4FFF', icon: 'cloud', label: 'Redshift' },
}

const DB_CHIP_LIST = Object.entries(DB_COLORS).map(([value, meta]) => ({
  value,
  ...meta,
}))

interface ConnectionPickerModalProps {
  open: boolean
  onClose: () => void
  onSelect: (connectionId: string) => void
  /** IDs of connections already open as tabs */
  openTabIds: string[]
}

export function ConnectionPickerModal({ open, onClose, onSelect, openTabIds }: ConnectionPickerModalProps) {
  const { data: connections = [] } = useConnections()
  const { data: settingsData } = useSettings()
  const { t } = useTranslation((settingsData?.language as 'en' | 'vi') ?? 'en')
  const connectMutation = useConnect()
  usePingAll() // auto-check connectivity
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<string | null>(null)
  const [connecting, setConnecting] = useState<string | null>(null)
  const [showNewModal, setShowNewModal] = useState(false)

  const filtered = useMemo(() => {
    let result = connections
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.host.toLowerCase().includes(q) ||
          (c.type as string).toLowerCase().includes(q) ||
          c.database.toLowerCase().includes(q)
      )
    }
    if (typeFilter) {
      result = result.filter((c) => (c.type as string) === typeFilter)
    }
    return result
  }, [connections, search, typeFilter])

  if (!open) return null

  const handlePick = async (connId: string) => {
    const conn = connections.find((c) => c.id === connId)
    if (conn && conn.status !== 'connected') {
      setConnecting(connId)
      try {
        await connectMutation.mutateAsync(connId)
      } catch {
        setConnecting(null)
        return
      }
      setConnecting(null)
    }
    onSelect(connId)
    onClose()
    setSearch('')
    setTypeFilter(null)
  }

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        {/* Backdrop */}
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

        {/* Modal */}
        <div className="relative w-full max-w-[900px] max-h-[85vh] bg-bg-card rounded-xl border border-border-subtle flex flex-col overflow-hidden animate-fade-in-up mx-4">
          {/* Header */}
          <div className="px-5 pt-5 pb-3 shrink-0">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-text-main">{t('connection.open')}</h2>
              <button
                onClick={onClose}
                className="p-1 rounded-md text-text-muted hover:text-text-main hover:bg-white/5 transition-colors"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            {/* Search */}
            <div className="relative">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[16px] text-text-muted pointer-events-none">
                search
              </span>
              <input
                className="w-full rounded-lg border border-border-subtle bg-bg-main py-2.5 pl-9 pr-3 text-sm text-text-main placeholder:text-text-muted focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
                placeholder={t('connection.searchPlaceholder')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
              />
            </div>

            {/* DB Type Filter Chips */}
            <div className="flex items-center gap-1.5 mt-3 flex-wrap">
              <button
                onClick={() => setTypeFilter(null)}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium border whitespace-nowrap transition-all duration-200 ${
                  typeFilter === null
                    ? 'bg-primary/15 border-primary/40 text-text-main'
                    : 'bg-bg-app border-border-subtle text-text-muted hover:bg-bg-hover/50 hover:text-text-main'
                }`}
              >
                <span className="material-symbols-outlined text-[12px]">apps</span>
                {t('hub.filter.all')}
              </button>
              {DB_CHIP_LIST.map((db) => (
                <button
                  key={db.value}
                  onClick={() => setTypeFilter(typeFilter === db.value ? null : db.value)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium border whitespace-nowrap transition-all duration-200 ${
                    typeFilter === db.value
                      ? 'text-text-main'
                      : 'bg-bg-app border-border-subtle text-text-muted hover:bg-bg-hover/50 hover:text-text-main'
                  }`}
                  style={typeFilter === db.value ? {
                    backgroundColor: `${db.accent}18`,
                    borderColor: `${db.accent}55`,
                  } : undefined}
                >
                  <span className="material-symbols-outlined text-[12px]" style={{ color: db.accent }}>
                    {db.icon}
                  </span>
                  {db.label}
                </button>
              ))}
            </div>
          </div>

          {/* Connection Cards Grid */}
          <div className="flex-1 overflow-y-auto px-5 pb-5">
            {filtered.length === 0 && (
              <div className="text-center py-12 text-text-muted text-sm">
                {t('connection.noResults')}
              </div>
            )}
            <div className="grid grid-cols-3 gap-3">
              {filtered.map((conn) => {
                const colors = DB_COLORS[conn.type as string] || DB_COLORS.postgresql
                const isOpen = openTabIds.includes(conn.id)
                const isConnecting = connecting === conn.id
                const status = conn.status as string
                const hostDisplay = conn.type === DatabaseType.SQLite
                  ? conn.filePath || conn.database
                  : conn.uri
                    ? (() => { try { const u = new URL(conn.uri); return u.hostname || conn.uri; } catch { return conn.uri; } })()
                    : `${conn.host}:${conn.port}`

                return (
                  <button
                    key={conn.id}
                    onClick={() => handlePick(conn.id)}
                    disabled={isConnecting}
                    className={`group relative flex flex-col justify-between h-[130px] p-4 rounded-xl bg-bg-main border text-left transition-all duration-200
                      ${isOpen
                        ? 'border-primary/30 ring-1 ring-primary/20'
                        : 'border-border-subtle hover:border-primary/20 hover:bg-bg-hover'
                      }
                      ${isConnecting ? 'opacity-60 pointer-events-none' : 'cursor-pointer'}
                    `}
                  >
                    {/* Open badge */}
                    {isOpen && (
                      <span className="absolute top-2.5 right-2.5 text-[8px] font-bold text-primary bg-primary/15 px-1.5 py-0.5 rounded uppercase tracking-wider">
                        {t('connection.open.badge')}
                      </span>
                    )}

                    {/* Top — Icon */}
                    <div
                      className="size-9 rounded-lg flex items-center justify-center border"
                      style={{ backgroundColor: `${colors.accent}12`, borderColor: `${colors.accent}25` }}
                    >
                      <span
                        className="material-symbols-outlined text-[20px]"
                        style={{ color: colors.accent }}
                      >
                        {colors.icon}
                      </span>
                    </div>

                    {/* Bottom — Info */}
                    <div>
                      <div className="flex items-center gap-2 mb-0.5">
                        <h3 className="font-bold text-sm text-text-main group-hover:text-primary-muted transition-colors truncate">
                          {conn.name}
                        </h3>
                        <span className="shrink-0 px-1.5 py-0.5 rounded text-[9px] font-medium bg-white/5 text-text-muted">
                          {conn.type}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 mb-1.5">
                        {status === 'connected' ? (
                          <span className="flex h-1.5 w-1.5 relative">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                          </span>
                        ) : status === 'offline' ? (
                          <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-500/70" />
                        ) : (
                          <span className="inline-block h-1.5 w-1.5 rounded-full bg-text-muted/30" />
                        )}
                        <span className={`text-[10px] font-medium ${
                          status === 'connected' ? 'text-emerald-500'
                            : status === 'offline' ? 'text-red-400/80'
                            : 'text-text-muted/60'
                        }`}>
                          {status === 'connected' ? t('connection.status.connected') : status === 'offline' ? t('connection.status.offline') : t('connection.status.idle')}
                        </span>
                      </div>

                      <p className="font-mono text-[10px] text-text-muted/40 truncate group-hover:text-text-muted/60 transition-opacity">
                        {hostDisplay}
                      </p>
                    </div>
                  </button>
                )
              })}

              {/* Add New Connection Card */}
              <button
                onClick={() => setShowNewModal(true)}
                className="group flex flex-col items-center justify-center h-[130px] p-4 rounded-xl border border-dashed border-border-subtle hover:border-primary/40 cursor-pointer hover:bg-bg-hover/40 transition-all duration-200"
              >
                <div className="size-9 rounded-full bg-bg-hover flex items-center justify-center group-hover:bg-primary/15 transition-all duration-200 mb-2">
                  <span className="material-symbols-outlined text-text-muted group-hover:text-primary transition-colors text-[20px]">
                    add
                  </span>
                </div>
                <span className="text-xs font-medium text-text-muted group-hover:text-text-main transition-colors">
                  {t('connection.new')}
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* New Connection Modal */}
      <ConnectionModal
        open={showNewModal}
        onClose={() => setShowNewModal(false)}
        editConnection={null}
      />
    </>
  )
}
