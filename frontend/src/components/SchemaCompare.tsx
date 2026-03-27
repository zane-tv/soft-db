import { useState, useCallback } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useConnections } from '@/hooks/useConnections'
import { useDatabases, useHasMultiDB } from '@/hooks/useSchema'
import * as CompareService from '../../bindings/soft-db/services/compareservice'

type SchemaDiff = Awaited<ReturnType<typeof CompareService.CompareSchemas>>
type TableDiff = SchemaDiff['addedTables'][number]
type ColumnChange = TableDiff['columns'][number]

interface SchemaCompareProps {
  open: boolean
  onClose: () => void
}

interface SideState {
  connId: string
  db: string
}

export function SchemaCompare({ open, onClose }: SchemaCompareProps) {
  const { data: connections = [] } = useConnections()

  const [source, setSource] = useState<SideState>({ connId: '', db: '' })
  const [target, setTarget] = useState<SideState>({ connId: '', db: '' })
  const [sqlModalOpen, setSqlModalOpen] = useState(false)

  const compareMutation = useMutation({
    mutationFn: () =>
      CompareService.CompareSchemas(source.connId, source.db, target.connId, target.db),
  })

  const handleCompare = useCallback(() => {
    if (!source.connId || !target.connId) return
    compareMutation.mutate()
  }, [source.connId, target.connId, compareMutation])

  if (!open) return null

  const diff = compareMutation.data

  return (
    <>
      <button
        type="button"
        aria-label="Close schema compare"
        className="fixed inset-0 bg-black/40 backdrop-blur-[1px] z-40"
        onClick={onClose}
      />

      <div className="fixed inset-4 top-[50px] bg-bg-card border border-border-subtle rounded-xl flex flex-col z-50 shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle shrink-0">
          <div>
            <h2 className="text-base font-bold text-text-main tracking-tight">Schema Compare</h2>
            <p className="text-xs text-text-muted mt-0.5">Compare table structures across databases</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 -mr-2 rounded-lg text-text-muted hover:text-text-main hover:bg-bg-hover transition-colors"
          >
            <span className="material-symbols-outlined text-xl">close</span>
          </button>
        </div>

        <div className="flex items-end gap-3 px-6 py-4 border-b border-border-subtle shrink-0">
          <SideSelector
            label="Source"
            value={source}
            connections={connections}
            onChange={setSource}
          />
          <div className="flex items-center justify-center pb-1 text-text-muted/40">
            <span className="material-symbols-outlined text-2xl">compare_arrows</span>
          </div>
          <SideSelector
            label="Target"
            value={target}
            connections={connections}
            onChange={setTarget}
          />
          <button
            type="button"
            onClick={handleCompare}
            disabled={!source.connId || !target.connId || compareMutation.isPending}
            className="px-5 py-2 rounded-lg bg-primary hover:bg-primary-hover text-white text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
          >
            {compareMutation.isPending ? (
              <span className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
                Comparing…
              </span>
            ) : 'Compare'}
          </button>
          {diff && diff.migrationSQL.length > 0 && (
            <button
              type="button"
              onClick={() => setSqlModalOpen(true)}
              className="px-4 py-2 rounded-lg border border-primary/40 text-primary text-sm font-medium hover:bg-primary/10 transition-colors shrink-0"
            >
              <span className="flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[14px]">code</span>
                Migration SQL ({diff.migrationSQL.length})
              </span>
            </button>
          )}
        </div>

        {compareMutation.isError && (
          <div className="mx-6 mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm shrink-0">
            {String(compareMutation.error)}
          </div>
        )}

        <div className="flex-1 overflow-hidden">
          {diff ? (
            <DiffView diff={diff} />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <span className="material-symbols-outlined text-[64px] text-text-muted/10 mb-4">compare</span>
              <p className="text-text-muted/40 text-sm">Select source and target databases then click Compare</p>
            </div>
          )}
        </div>
      </div>

      {sqlModalOpen && diff && (
        <MigrationSQLModal
          sql={diff.migrationSQL}
          onClose={() => setSqlModalOpen(false)}
        />
      )}
    </>
  )
}

function SideSelector({
  label,
  value,
  connections,
  onChange,
}: {
  label: string
  value: SideState
  connections: { id: string; name: string }[]
  onChange: (v: SideState) => void
}) {
  const { data: hasMultiDB } = useHasMultiDB(value.connId)
  const { data: databases = [] } = useDatabases(value.connId)
  const connSelectId = `compare-conn-${label.toLowerCase()}`

  return (
    <div className="flex-1 min-w-0">
      <label htmlFor={connSelectId} className="block text-[10px] font-bold text-text-muted uppercase tracking-wider mb-1.5">{label}</label>
      <div className="flex gap-2">
        <select
          id={connSelectId}
          value={value.connId}
          onChange={(e) => onChange({ connId: e.target.value, db: '' })}
          className="flex-1 min-w-0 bg-bg-editor text-text-main text-xs rounded-lg border border-border-subtle px-2.5 py-2 outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50"
        >
          <option value="">Select connection…</option>
          {connections.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        {hasMultiDB && databases.length > 0 && (
          <select
            value={value.db}
            onChange={(e) => onChange({ ...value, db: e.target.value })}
            aria-label={`${label} database`}
            className="flex-1 min-w-0 bg-bg-editor text-text-main text-xs rounded-lg border border-border-subtle px-2.5 py-2 outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50"
          >
            <option value="">Select database…</option>
            {databases.map((d) => (
              <option key={d.name} value={d.name}>{d.name}</option>
            ))}
          </select>
        )}
      </div>
    </div>
  )
}

function DiffView({ diff }: { diff: SchemaDiff }) {
  const total =
    diff.addedTables.length + diff.removedTables.length + diff.modifiedTables.length

  if (total === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center">
        <span className="material-symbols-outlined text-[48px] text-success mb-3">check_circle</span>
        <p className="text-text-main font-semibold">Schemas are identical</p>
        <p className="text-text-muted/60 text-sm mt-1">No differences found between the two databases</p>
      </div>
    )
  }

  return (
    <div className="flex gap-0 h-full overflow-hidden">
      <div className="w-1/2 flex flex-col border-r border-border-subtle overflow-hidden">
        <div className="px-4 py-2 bg-bg-app/50 border-b border-border-subtle shrink-0">
          <span className="text-[11px] font-bold text-text-muted uppercase tracking-wider">Source</span>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {diff.removedTables.map((t) => (
            <TableRow key={t.tableName} table={t} side="source" />
          ))}
          {diff.modifiedTables.map((t) => (
            <TableRow key={t.tableName} table={t} side="source" />
          ))}
          {diff.addedTables.map((t) => (
            <TableRow key={t.tableName} table={t} side="source" absent />
          ))}
        </div>
      </div>
      <div className="w-1/2 flex flex-col overflow-hidden">
        <div className="px-4 py-2 bg-bg-app/50 border-b border-border-subtle shrink-0">
          <span className="text-[11px] font-bold text-text-muted uppercase tracking-wider">Target</span>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {diff.removedTables.map((t) => (
            <TableRow key={t.tableName} table={t} side="target" absent />
          ))}
          {diff.modifiedTables.map((t) => (
            <TableRow key={t.tableName} table={t} side="target" />
          ))}
          {diff.addedTables.map((t) => (
            <TableRow key={t.tableName} table={t} side="target" />
          ))}
        </div>
      </div>
    </div>
  )
}

function TableRow({
  table,
  side,
  absent = false,
}: {
  table: TableDiff
  side: 'source' | 'target'
  absent?: boolean
}) {
  const [expanded, setExpanded] = useState(true)

  const borderColor =
    absent
      ? 'border-text-muted/20'
      : table.changeKind === 'added'
        ? 'border-emerald-500/40'
        : table.changeKind === 'removed'
          ? 'border-red-500/40'
          : 'border-amber-500/40'

  const headerBg =
    absent
      ? 'bg-bg-app/20'
      : table.changeKind === 'added'
        ? 'bg-success/10'
        : table.changeKind === 'removed'
          ? 'bg-error/10'
          : 'bg-warning/10'

  const badgeColor =
    absent
      ? 'text-text-muted/40 bg-text-muted/5 border-text-muted/10'
      : table.changeKind === 'added'
        ? 'text-success bg-success/10 border-emerald-500/20'
        : table.changeKind === 'removed'
          ? 'text-error bg-error/10 border-red-500/20'
          : 'text-warning bg-warning/10 border-amber-500/20'

  const badgeLabel = absent
    ? 'absent'
    : side === 'source' && table.changeKind === 'added'
      ? 'missing'
      : table.changeKind

  return (
    <div className={`rounded-lg border ${borderColor} overflow-hidden`}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className={`w-full flex items-center gap-2 px-3 py-2 text-left ${headerBg} hover:opacity-90 transition-opacity`}
      >
        <span className="material-symbols-outlined text-[14px] text-text-muted/60">
          {expanded ? 'expand_less' : 'expand_more'}
        </span>
        <span className="flex-1 text-sm font-semibold text-text-main font-mono">{table.tableName}</span>
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wide ${badgeColor}`}>
          {badgeLabel}
        </span>
      </button>

      {expanded && !absent && table.columns.length > 0 && (
        <div className="divide-y divide-border-subtle/30">
          {table.columns.map((col) => (
            <ColumnRow key={col.name} col={col} side={side} />
          ))}
        </div>
      )}
    </div>
  )
}

function ColumnRow({ col, side }: { col: ColumnChange; side: 'source' | 'target' }) {
  const isAdded = col.changeKind === 'added'
  const isRemoved = col.changeKind === 'removed'
  const isModified = col.changeKind === 'modified'

  const hidden = (side === 'source' && isAdded) || (side === 'target' && isRemoved)

  const rowBg = hidden
    ? 'opacity-0 pointer-events-none'
    : isAdded
      ? 'bg-success/10'
      : isRemoved
        ? 'bg-error/10'
        : isModified
          ? 'bg-warning/10'
          : ''

  const typeText = side === 'source' ? col.sourceType : col.targetType
  const typeColor =
    isModified && col.sourceType !== col.targetType
      ? side === 'source'
        ? 'text-error'
        : 'text-success'
      : 'text-text-muted/80'

  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 text-xs ${rowBg}`}>
      <span className="material-symbols-outlined text-[12px] text-text-muted/30">
        {isAdded ? 'add' : isRemoved ? 'remove' : 'edit'}
      </span>
      <span className="flex-1 font-mono text-text-main/90">{col.name}</span>
      <span className={`font-mono text-[11px] ${typeColor}`}>{typeText || '—'}</span>
    </div>
  )
}

function MigrationSQLModal({ sql, onClose }: { sql: string[]; onClose: () => void }) {
  const [copied, setCopied] = useState(false)

  const sqlText = sql.join('\n\n')

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(sqlText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [sqlText])

  return (
    <>
      <button
        type="button"
        aria-label="Close migration SQL modal"
        className="fixed inset-0 bg-black/60 z-[60]"
        onClick={onClose}
      />
      <div className="fixed inset-8 top-[80px] bg-bg-card border border-border-subtle rounded-xl flex flex-col z-[70] shadow-2xl max-w-3xl mx-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle shrink-0">
          <div>
            <h3 className="text-base font-bold text-text-main">Migration SQL</h3>
            <p className="text-xs text-text-muted mt-0.5">{sql.length} statement{sql.length !== 1 ? 's' : ''} — review before applying</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-subtle text-xs text-text-muted hover:text-text-main hover:bg-bg-hover transition-colors"
            >
              <span className="material-symbols-outlined text-[14px]">{copied ? 'check' : 'content_copy'}</span>
              {copied ? 'Copied!' : 'Copy'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-text-muted hover:text-text-main hover:bg-bg-hover transition-colors"
            >
              <span className="material-symbols-outlined text-xl">close</span>
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <pre className="font-mono text-xs text-text-main/90 leading-relaxed bg-bg-app rounded-lg border border-border-subtle p-4 whitespace-pre-wrap break-all">
            {sqlText}
          </pre>
        </div>
      </div>
    </>
  )
}
