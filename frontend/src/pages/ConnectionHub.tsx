import { useState, useCallback, useMemo } from 'react'
import { useSettings } from '@/hooks/useSettings'
import { useTranslation } from '@/lib/i18n'
import {
  useConnections,
  useDeleteConnection,
  useConnect,
  useDisconnect,
  usePingAll,
} from '@/hooks/useConnections'
import { ConnectionConfig, DatabaseType } from '../../bindings/soft-db/internal/driver/models'
import { ConnectionModal } from '@/components/ConnectionModal'
import { SettingsModal } from '@/components/SettingsModal'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ChangelogModal } from '@/components/ChangelogModal'
import { ExportModal } from '@/components/ExportModal'
import { ImportModal } from '@/components/ImportModal'
import { useUpdate } from '@/hooks/useUpdate'

// ─── Date Formatter ───
const LOCALE_MAP: Record<string, string> = { en: 'en-US', vi: 'vi-VN' }

function formatLastUsed(isoStr: string, lang = 'en'): string {
  const date = new Date(isoStr)
  if (isNaN(date.getTime())) return isoStr

  const locale = LOCALE_MAP[lang] ?? lang
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)

  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })

  if (diffMins < 1) return rtf.format(0, 'minute')
  if (diffMins < 60) return rtf.format(-diffMins, 'minute')
  if (diffHours < 24) return rtf.format(-diffHours, 'hour')

  const timeStr = date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false })

  const isToday = date.toDateString() === now.toDateString()
  if (isToday) return rtf.format(0, 'day').replace(/^./, c => c.toUpperCase()) + ` ${timeStr}`

  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return rtf.format(-1, 'day').replace(/^./, c => c.toUpperCase()) + ` ${timeStr}`

  const dateStr = date.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' })
  return `${dateStr} ${timeStr}`
}

// ─── Database Branding ───
const DB_CARD_COLORS: Record<string, { bg: string; accent: string; icon: string; label: string }> = {
  postgresql: { bg: 'bg-[#336791]/10', accent: '#336791', icon: 'database', label: 'PostgreSQL' },
  mysql: { bg: 'bg-[#F29111]/10', accent: '#F29111', icon: 'table_view', label: 'MySQL' },
  mariadb: { bg: 'bg-[#003545]/10', accent: '#4EA3A4', icon: 'table_view', label: 'MariaDB' },
  sqlite: { bg: 'bg-[#44A8E0]/10', accent: '#44A8E0', icon: 'storage', label: 'SQLite' },
  mongodb: { bg: 'bg-[#00684A]/10', accent: '#00ED64', icon: 'data_object', label: 'MongoDB' },
  redshift: { bg: 'bg-[#8C4FFF]/10', accent: '#8C4FFF', icon: 'cloud', label: 'Redshift' },
  redis: { bg: 'bg-[#DC382D]/10', accent: '#DC382D', icon: 'memory', label: 'Redis' },
}

const DB_CHIP_LIST = Object.entries(DB_CARD_COLORS).map(([value, meta]) => ({
  value,
  ...meta,
}))

interface ConnectionHubProps {
  onConnect: (connectionId: string) => void
}

export function ConnectionHub({ onConnect }: ConnectionHubProps) {
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingConn, setEditingConn] = useState<ConnectionConfig | null>(null)
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [changelogOpen, setChangelogOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [deletingConn, setDeletingConn] = useState<ConnectionConfig | null>(null)

  const { data: connections = [], isLoading } = useConnections()
  const { isLoading: isPinging } = usePingAll()
  const { data: settingsData } = useSettings()
  const { t } = useTranslation((settingsData?.language as 'en' | 'vi') ?? 'en')
  const { version, hasUpdate } = useUpdate()
  const connectMutation = useConnect()
  const disconnectMutation = useDisconnect()
  const deleteMutation = useDeleteConnection()

  // Filter connections by search + type + status
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
    if (statusFilter) {
      result = result.filter((c) => (c.status as string) === statusFilter)
    }
    return result
  }, [connections, search, typeFilter, statusFilter])

  const handleCardClick = useCallback(
    async (conn: ConnectionConfig) => {
      onConnect(conn.id)
    },
    [onConnect]
  )

  const handleContextAction = useCallback(
    async (action: string, conn: ConnectionConfig) => {
      setContextMenu(null)
      switch (action) {
        case 'connect':
          connectMutation.mutate(conn.id)
          break
        case 'disconnect':
          disconnectMutation.mutate(conn.id)
          break
        case 'edit':
          setEditingConn(conn)
          setModalOpen(true)
          break
        case 'delete':
          setDeletingConn(conn)
          break
      }
    },
    [connectMutation, disconnectMutation, deleteMutation]
  )

  const openNewModal = useCallback(() => {
    setEditingConn(null)
    setModalOpen(true)
  }, [])

  return (
    <>
      {/* Header */}
      <header className="w-full px-8 py-6 z-20 flex flex-col items-center relative shrink-0">
        {/* Top Row */}
        <div className="w-full max-w-[1200px] flex items-center justify-between relative mb-8">
          <div className="flex items-center gap-3 select-none">
            <img src="/softdb-logo.png" alt="SoftDB" className="size-8 rounded-lg" />
            <h1 className="font-bold text-lg tracking-tight text-text-main">SoftDB</h1>
          </div>
          <div className="flex items-center gap-1">
            {/* Export Workspace */}
            <button
              type="button"
              onClick={() => setExportOpen(true)}
              className="flex items-center justify-center size-9 rounded-lg text-text-muted hover:text-text-main hover:bg-white/5 transition-all duration-200"
              title={t('hub.exportWorkspace')}
            >
              <span className="material-symbols-outlined text-[20px]">download</span>
            </button>
            {/* Import Workspace */}
            <button
              type="button"
              onClick={() => setImportOpen(true)}
              className="flex items-center justify-center size-9 rounded-lg text-text-muted hover:text-text-main hover:bg-white/5 transition-all duration-200"
              title={t('hub.importWorkspace')}
            >
              <span className="material-symbols-outlined text-[20px]">upload</span>
            </button>
            {/* Changelog / Update Bell */}
            <button
              onClick={() => setChangelogOpen(true)}
              className="relative flex items-center justify-center size-9 rounded-lg text-text-muted hover:text-text-main hover:bg-white/5 transition-all duration-200"
              title={t('update.title')}
            >
              <span className="material-symbols-outlined text-[20px]">notifications</span>
              {hasUpdate && (
                <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-red-500 ring-2 ring-bg-card animate-pulse" />
              )}
            </button>
            <button
              onClick={() => setSettingsOpen(true)}
              className="flex items-center justify-center size-9 rounded-lg text-text-muted hover:text-text-main hover:bg-white/5 transition-all duration-200"
              title="Settings"
            >
              <span className="material-symbols-outlined text-[20px]">settings</span>
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="w-full max-w-[480px] relative group z-10 animate-fade-in">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none z-10 text-text-muted group-focus-within:text-primary transition-colors duration-300">
            <span className="material-symbols-outlined text-[20px]">search</span>
          </div>
          <input
            className="block w-full rounded-lg border-0 py-3 pl-10 pr-12 text-sm text-text-main placeholder:text-text-muted glass-panel focus:ring-2 focus:ring-primary focus:bg-bg-card transition-all duration-300 outline-none"
            placeholder={t('hub.searchPlaceholder')}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
            <kbd className="inline-flex items-center rounded border border-border-subtle px-2 font-mono text-[10px] font-medium text-text-muted">
              ⌘K
            </kbd>
          </div>
        </div>

        {/* DB Type Filter Chips */}
        <div className="w-full max-w-[1200px] flex items-center justify-center gap-2 mt-4 flex-wrap animate-fade-in" style={{ animationDelay: '0.1s' }}>
          <button
            onClick={() => setTypeFilter(null)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border whitespace-nowrap transition-all duration-200 ${
              typeFilter === null
                ? 'bg-primary/15 border-primary/40 text-text-main'
                : 'bg-bg-app border-border-subtle text-text-muted hover:bg-bg-hover/50 hover:text-text-main'
            }`}
          >
            <span className="material-symbols-outlined text-[14px]">apps</span>
            {t('hub.filter.all')}
          </button>
          {DB_CHIP_LIST.map((db) => (
            <button
              key={db.value}
              onClick={() => setTypeFilter(typeFilter === db.value ? null : db.value)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border whitespace-nowrap transition-all duration-200 ${
                typeFilter === db.value
                  ? 'text-text-main'
                  : 'bg-bg-app border-border-subtle text-text-muted hover:bg-bg-hover/50 hover:text-text-main'
              }`}
              style={typeFilter === db.value ? {
                backgroundColor: `${db.accent}18`,
                borderColor: `${db.accent}55`,
              } : undefined}
            >
              <span className="material-symbols-outlined text-[14px]" style={{ color: db.accent }}>
                {db.icon}
              </span>
              {db.label}
            </button>
          ))}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 w-full overflow-y-auto overflow-x-hidden px-6 pb-12">
        <div className="max-w-[1000px] mx-auto pt-4 pb-20">
          {/* Grid Actions */}
          <div className="flex items-end justify-between mb-6 animate-fade-in" style={{ animationDelay: '0.15s' }}>
            <div>
              <h2 className="text-2xl font-bold text-text-main tracking-tight">{t('hub.connections')}</h2>
              <p className="text-text-muted text-sm mt-1">
                {isLoading
                  ? t('hub.loading')
                  : isPinging
                    ? `${t('hub.checking')} ${connections.length} ${connections.length > 1 ? t('hub.connections.suffixPlural') : t('hub.connections.suffix')}...`
                    : connections.length === 0
                      ? t('hub.noSaved')
                      : `${connections.length} ${connections.length > 1 ? t('hub.databases') : t('hub.database')} ${t('hub.configured')}`}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {/* Status Filter Chips */}
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setStatusFilter(null)}
                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[11px] font-medium border transition-all duration-200 ${
                    statusFilter === null
                      ? 'bg-primary/15 border-primary/40 text-text-main'
                      : 'bg-bg-app border-border-subtle text-text-muted hover:bg-bg-hover/50 hover:text-text-main'
                  }`}
                >
                  {t('hub.filter.all')}
                </button>
                <button
                  onClick={() => setStatusFilter(statusFilter === 'connected' ? null : 'connected')}
                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[11px] font-medium border transition-all duration-200 ${
                    statusFilter === 'connected'
                      ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
                      : 'bg-bg-app border-border-subtle text-text-muted hover:bg-bg-hover/50 hover:text-text-main'
                  }`}
                >
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  {t('hub.filter.connected')}
                </button>
                <button
                  onClick={() => setStatusFilter(statusFilter === 'offline' ? null : 'offline')}
                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[11px] font-medium border transition-all duration-200 ${
                    statusFilter === 'offline'
                      ? 'bg-red-500/15 border-red-500/40 text-red-400'
                      : 'bg-bg-app border-border-subtle text-text-muted hover:bg-bg-hover/50 hover:text-text-main'
                  }`}
                >
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-500/70" />
                  {t('hub.filter.offline')}
                </button>
              </div>
              <button
                onClick={openNewModal}
                className="flex items-center gap-2 bg-primary hover:bg-primary-hover text-white px-4 py-2.5 rounded-lg font-medium text-sm transition-all duration-200 active:scale-[0.97]"
              >
                <span className="material-symbols-outlined text-[18px]">add</span>
                {t('hub.newConnection')}
              </button>
            </div>
          </div>

          {/* Connection Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 animate-fade-in" style={{ animationDelay: '0.25s' }}>
            {filtered.map((conn) => (
              <ConnectionCard
                key={conn.id}
                conn={conn}
                colors={DB_CARD_COLORS[conn.type as string] || DB_CARD_COLORS.postgresql}
                onClick={() => handleCardClick(conn)}
                onMenuClick={(e) => {
                  e.stopPropagation()
                  setContextMenu(
                    contextMenu?.id === conn.id ? null : { id: conn.id, x: e.clientX, y: e.clientY }
                  )
                }}
              />
            ))}

            {/* Add New Card */}
            <div
              onClick={openNewModal}
              className="group relative flex flex-col items-center justify-center h-[160px] p-5 rounded-xl border border-dashed border-border-subtle hover:border-primary/40 cursor-pointer hover:bg-bg-card/40 transition-all duration-300 ease-out"
            >
              <div className="size-12 rounded-full bg-bg-hover flex items-center justify-center group-hover:bg-primary/15 transition-all duration-300 ease-out mb-3">
                <span className="material-symbols-outlined text-text-muted group-hover:text-primary transition-colors duration-300 text-[24px]">
                  add
                </span>
              </div>
              <span className="text-sm font-medium text-text-muted group-hover:text-text-main transition-colors duration-300">
                {t('hub.connectNewDb')}
              </span>
            </div>
          </div>

          {/* Empty State */}
          {!isLoading && connections.length === 0 && (
            <div className="text-center py-20 animate-fade-in">
              <span className="material-symbols-outlined text-[64px] text-text-muted/15 mb-4 block">dns</span>
              <h3 className="text-lg font-semibold text-text-main mb-2">{t('hub.noConnections')}</h3>
              <p className="text-text-muted text-sm mb-6">
                {t('hub.addFirstConnection')}
              </p>
              <button
                onClick={openNewModal}
                className="inline-flex items-center gap-2 bg-primary hover:bg-primary-hover text-white px-5 py-2.5 rounded-lg font-medium text-sm transition-all duration-200"
              >
                <span className="material-symbols-outlined text-[18px]">add</span>
                {t('hub.addConnection')}
              </button>
            </div>
          )}
        </div>
      </main>

      {/* Version */}
      <div className="fixed bottom-4 right-6 text-xs text-text-muted/30 font-mono pointer-events-none select-none z-0">
        {version}
      </div>

      {/* Click-away to close context menu */}
      {contextMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} />
          {(() => {
            const conn = connections.find((c) => c.id === contextMenu.id)
            if (!conn) return null
            const status = conn.status as 'connected' | 'idle' | 'offline'
            return (
              <div
                className="fixed w-40 bg-bg-card border border-border-subtle rounded-lg z-50 py-1 animate-fade-in"
                style={{ left: contextMenu.x, top: contextMenu.y }}
              >
                {status === 'connected' ? (
                  <MenuItem icon="link_off" label={t('hub.disconnect')} onClick={() => handleContextAction('disconnect', conn)} />
                ) : (
                  <MenuItem icon="link" label={t('hub.connect')} onClick={() => handleContextAction('connect', conn)} />
                )}
                <MenuItem icon="edit" label={t('hub.edit')} onClick={() => handleContextAction('edit', conn)} />
                <div className="h-px bg-border-subtle mx-2 my-1" />
                <MenuItem icon="delete" label={t('hub.delete')} onClick={() => handleContextAction('delete', conn)} danger />
              </div>
            )
          })()}
        </>
      )}

      {/* Connection Modal */}
      <ConnectionModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false)
          setEditingConn(null)
        }}
        editConnection={editingConn}
      />

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deletingConn}
        title={t('hub.deleteConnection')}
        message={`${t('hub.deleteMessage')} "${deletingConn?.name}"? ${t('hub.deleteWarning')}`}
        confirmLabel={t('hub.delete')}
        cancelLabel={t('hub.cancel')}
        danger
        icon="delete"
        onConfirm={() => {
          if (deletingConn) deleteMutation.mutate(deletingConn.id)
          setDeletingConn(null)
        }}
        onCancel={() => setDeletingConn(null)}
      />

      {/* Settings Modal */}
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />

      {/* Changelog Modal */}
      <ChangelogModal
        open={changelogOpen}
        onClose={() => setChangelogOpen(false)}
        lang={(settingsData?.language as 'en' | 'vi') ?? 'en'}
      />

      <ExportModal open={exportOpen} onClose={() => setExportOpen(false)} mode="workspace" />
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} mode="workspace" />
    </>
  )
}

// ─── Connection Card ───
interface ConnectionCardProps {
  conn: ConnectionConfig
  colors: { bg: string; accent: string; icon: string; label: string }
  onClick: () => void
  onMenuClick: (e: React.MouseEvent) => void
}

function ConnectionCard({ conn, colors, onClick, onMenuClick }: ConnectionCardProps) {
  const { data: settingsData } = useSettings()
  const { t } = useTranslation((settingsData?.language as 'en' | 'vi') ?? 'en')
  const status = conn.status as 'connected' | 'idle' | 'offline'
  const hostDisplay = conn.type === DatabaseType.SQLite
    ? conn.filePath || conn.database
    : conn.uri
      ? (() => { try { const u = new URL(conn.uri); return u.hostname || conn.uri; } catch { return conn.uri; } })()
      : `${conn.host}:${conn.port}`

  return (
    <div
      onClick={onClick}
      className="connection-card group relative flex flex-col justify-between h-[160px] p-5 rounded-xl bg-bg-card border border-border-subtle cursor-pointer hover:translate-y-[-3px] hover:border-primary/30 hover:bg-bg-hover"
    >
      {/* Top Row */}
      <div className="flex justify-between items-start">
        <div
          className={`size-10 rounded-lg ${colors.bg} flex items-center justify-center border`}
          style={{ borderColor: `${colors.accent}33` }}
        >
          <span className="material-symbols-outlined text-[24px]" style={{ color: colors.accent }}>
            {colors.icon}
          </span>
        </div>
        <button
          onClick={onMenuClick}
          className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-text-main p-1.5 rounded-md hover:bg-white/10 transition-all duration-200"
        >
          <span className="material-symbols-outlined text-[20px]">more_horiz</span>
        </button>
      </div>

      {/* Bottom Info */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <h3 className="font-bold text-text-main text-base group-hover:text-primary-muted transition-colors duration-300 truncate">
            {conn.name}
          </h3>
          <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-white/5 text-text-muted">
            {conn.type}
          </span>
        </div>

        <div className="flex items-center gap-2 mb-2.5">
          {status === 'connected' ? (
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
          ) : status === 'offline' ? (
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-500/70" />
          ) : (
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-text-muted/40" />
          )}
          <span className={`text-xs font-medium ${status === 'connected' ? 'text-emerald-500' : 'text-text-muted'}`}>
            {status === 'connected'
              ? t('connection.status.connected')
              : status === 'offline'
                ? t('connection.status.offline')
                : conn.lastUsed
                  ? `${t('hub.idle')} — ${t('hub.lastUsed')} ${formatLastUsed(conn.lastUsed, (settingsData?.language as string) ?? 'en')}`
                  : t('connection.status.idle')}
          </span>
        </div>

        <p className="font-mono text-xs text-text-muted truncate opacity-50 group-hover:opacity-70 transition-opacity duration-300">
          {hostDisplay}
        </p>
      </div>
    </div>
  )
}

// ─── Menu Item ───
function MenuItem({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: string
  label: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors duration-150 ${danger
          ? 'text-red-400 hover:bg-red-500/10'
          : 'text-text-main hover:bg-white/5'
        }`}
    >
      <span className={`material-symbols-outlined text-[16px] ${danger ? 'text-red-400' : 'text-text-muted'}`}>
        {icon}
      </span>
      {label}
    </button>
  )
}
