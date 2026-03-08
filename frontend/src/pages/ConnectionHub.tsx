import { useState, useCallback, useMemo } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  useConnections,
  useDeleteConnection,
  useConnect,
  useDisconnect,
} from '@/hooks/useConnections'
import { ConnectionConfig, DatabaseType } from '../../bindings/soft-db/internal/driver/models'
import { ConnectionModal } from '@/components/ConnectionModal'

// ─── Database Branding ───
const DB_CARD_COLORS: Record<string, { bg: string; accent: string; icon: string; label: string }> = {
  postgresql: { bg: 'bg-[#336791]/10', accent: '#336791', icon: 'database', label: 'PostgreSQL' },
  mysql: { bg: 'bg-[#F29111]/10', accent: '#F29111', icon: 'table_view', label: 'MySQL' },
  mariadb: { bg: 'bg-[#003545]/10', accent: '#4EA3A4', icon: 'table_view', label: 'MariaDB' },
  sqlite: { bg: 'bg-[#44A8E0]/10', accent: '#44A8E0', icon: 'storage', label: 'SQLite' },
  mongodb: { bg: 'bg-[#00684A]/10', accent: '#00ED64', icon: 'data_object', label: 'MongoDB' },
  redshift: { bg: 'bg-[#8C4FFF]/10', accent: '#8C4FFF', icon: 'cloud', label: 'Redshift' },
}

export function ConnectionHub() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingConn, setEditingConn] = useState<ConnectionConfig | null>(null)
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null)

  const { data: connections = [], isLoading } = useConnections()
  const connectMutation = useConnect()
  const disconnectMutation = useDisconnect()
  const deleteMutation = useDeleteConnection()

  // Filter connections by search
  const filtered = useMemo(() => {
    if (!search.trim()) return connections
    const q = search.toLowerCase()
    return connections.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.host.toLowerCase().includes(q) ||
        (c.type as string).toLowerCase().includes(q) ||
        c.database.toLowerCase().includes(q)
    )
  }, [connections, search])

  const handleCardClick = useCallback(
    async (conn: ConnectionConfig) => {
      if (conn.status !== 'connected') {
        try {
          await connectMutation.mutateAsync(conn.id)
        } catch {
          // Connection failed — user can see status
          return
        }
      }
      navigate({ to: '/explorer/$connectionId', params: { connectionId: conn.id } })
    },
    [connectMutation, navigate]
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
          deleteMutation.mutate(conn.id)
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
            <img src="/softdb-logo.png" alt="SoftDB" className="size-8 rounded-lg shadow-glow" />
            <h1 className="font-bold text-lg tracking-tight text-white/90">SoftDB</h1>
          </div>
        </div>

        {/* Search */}
        <div className="w-full max-w-[480px] relative group z-10 animate-fade-in">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-text-muted group-focus-within:text-primary transition-colors duration-300">
            <span className="material-symbols-outlined text-[20px]">search</span>
          </div>
          <input
            className="block w-full rounded-lg border-0 py-3 pl-10 pr-12 text-sm text-text-main placeholder:text-text-muted glass-panel focus:ring-2 focus:ring-primary focus:bg-bg-card transition-all duration-300 shadow-lg outline-none"
            placeholder="Search connections..."
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
      </header>

      {/* Main Content */}
      <main className="flex-1 w-full overflow-y-auto overflow-x-hidden px-6 pb-12">
        <div className="max-w-[1000px] mx-auto pt-4 pb-20">
          {/* Grid Actions */}
          <div className="flex items-end justify-between mb-8 animate-fade-in" style={{ animationDelay: '0.15s' }}>
            <div>
              <h2 className="text-2xl font-bold text-white tracking-tight">Connections</h2>
              <p className="text-text-muted text-sm mt-1">
                {isLoading
                  ? 'Loading...'
                  : connections.length === 0
                    ? 'No saved connections yet.'
                    : `${connections.length} database${connections.length > 1 ? 's' : ''} configured.`}
              </p>
            </div>
            <button
              onClick={openNewModal}
              className="flex items-center gap-2 bg-primary hover:bg-primary-hover text-white px-4 py-2.5 rounded-lg font-medium text-sm transition-all duration-200 shadow-glow hover:shadow-lg active:scale-[0.97]"
            >
              <span className="material-symbols-outlined text-[18px]">add</span>
              New Connection
            </button>
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
                onAction={(action) => handleContextAction(action, conn)}
                menuOpen={contextMenu?.id === conn.id}
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
              <span className="text-sm font-medium text-text-muted group-hover:text-white/80 transition-colors duration-300">
                Connect New Database
              </span>
            </div>
          </div>

          {/* Empty State */}
          {!isLoading && connections.length === 0 && (
            <div className="text-center py-20 animate-fade-in">
              <span className="material-symbols-outlined text-[64px] text-text-muted/15 mb-4 block">dns</span>
              <h3 className="text-lg font-semibold text-text-main mb-2">No connections yet</h3>
              <p className="text-text-muted text-sm mb-6">
                Add your first database connection to get started.
              </p>
              <button
                onClick={openNewModal}
                className="inline-flex items-center gap-2 bg-primary hover:bg-primary-hover text-white px-5 py-2.5 rounded-lg font-medium text-sm transition-all duration-200"
              >
                <span className="material-symbols-outlined text-[18px]">add</span>
                Add Connection
              </button>
            </div>
          )}
        </div>
      </main>

      {/* Version */}
      <div className="fixed bottom-4 right-6 text-xs text-text-muted/30 font-mono pointer-events-none select-none z-0">
        v0.1.0-alpha
      </div>

      {/* Click-away to close context menu */}
      {contextMenu && <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} />}

      {/* Connection Modal */}
      <ConnectionModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false)
          setEditingConn(null)
        }}
        editConnection={editingConn}
      />
    </>
  )
}

// ─── Connection Card ───
interface ConnectionCardProps {
  conn: ConnectionConfig
  colors: { bg: string; accent: string; icon: string; label: string }
  onClick: () => void
  onMenuClick: (e: React.MouseEvent) => void
  onAction: (action: string) => void
  menuOpen: boolean
}

function ConnectionCard({ conn, colors, onClick, onMenuClick, onAction, menuOpen }: ConnectionCardProps) {
  const status = conn.status as 'connected' | 'idle' | 'offline'
  const hostDisplay = conn.type === DatabaseType.SQLite
    ? conn.filePath || conn.database
    : `${conn.host}:${conn.port}`

  return (
    <div
      onClick={onClick}
      className="connection-card group relative flex flex-col justify-between h-[160px] p-5 rounded-xl bg-bg-card border border-border-subtle cursor-pointer shadow-soft hover:translate-y-[-3px] hover:shadow-[0_12px_32px_-4px_rgba(0,0,0,0.45)] hover:border-primary/30 hover:bg-[#2a2a2f]"
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
        <div className="relative">
          <button
            onClick={onMenuClick}
            className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-white p-1.5 rounded-md hover:bg-white/10 transition-all duration-200"
          >
            <span className="material-symbols-outlined text-[20px]">more_horiz</span>
          </button>

          {/* Dropdown Menu */}
          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 w-40 bg-bg-card border border-border-subtle rounded-lg shadow-xl z-50 py-1 animate-fade-in">
              {status === 'connected' ? (
                <MenuItem icon="link_off" label="Disconnect" onClick={() => onAction('disconnect')} />
              ) : (
                <MenuItem icon="link" label="Connect" onClick={() => onAction('connect')} />
              )}
              <MenuItem icon="edit" label="Edit" onClick={() => onAction('edit')} />
              <div className="h-px bg-border-subtle mx-2 my-1" />
              <MenuItem icon="delete" label="Delete" onClick={() => onAction('delete')} danger />
            </div>
          )}
        </div>
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
              ? 'Connected'
              : status === 'offline'
                ? 'Offline'
                : conn.lastUsed
                  ? `Idle — last used ${conn.lastUsed}`
                  : 'Idle'}
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
