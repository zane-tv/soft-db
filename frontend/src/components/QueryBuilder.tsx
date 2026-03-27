import { useState, useCallback, useRef, useEffect } from 'react'
import { useColumns } from '@/hooks/useSchema'

// ─── Custom Select ───

interface SelectOption {
  value: string
  label: string
}

interface CustomSelectProps {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}

function CustomSelect({ value, options, onChange, placeholder, className = '' }: CustomSelectProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const selected = options.find(o => o.value === value)

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(prev => !prev)}
        className="w-full flex items-center justify-between bg-bg-card text-[12px] rounded-md px-2.5 py-1.5 border border-border-subtle/30 focus:outline-none focus:ring-1 focus:ring-primary/50 transition-colors text-left"
      >
        <span className={selected ? 'text-text-main truncate' : 'text-text-muted/50 truncate'}>
          {selected?.label ?? placeholder ?? '— select —'}
        </span>
        <span className="material-symbols-outlined text-[14px] text-text-muted/50 shrink-0 ml-1">
          {open ? 'expand_less' : 'expand_more'}
        </span>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full max-h-52 overflow-y-auto rounded-md border border-border-subtle/40 bg-bg-card shadow-lg">
          {options.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { onChange(opt.value); setOpen(false) }}
              className={[
                'w-full text-left px-2.5 py-1.5 text-[12px] transition-colors',
                opt.value === value
                  ? 'bg-primary/15 text-primary'
                  : 'text-text-main hover:bg-bg-hover/60',
              ].join(' ')}
            >
              {opt.label}
            </button>
          ))}
          {options.length === 0 && (
            <div className="px-2.5 py-2 text-[11px] text-text-muted/50">No options</div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Types ───

type SQLOperator = '=' | '!=' | '>' | '<' | '>=' | '<=' | 'LIKE' | 'IN' | 'IS NULL' | 'IS NOT NULL'

interface WhereCondition {
  id: string
  column: string
  operator: SQLOperator
  value: string
}

interface OrderByClause {
  id: string
  column: string
  direction: 'ASC' | 'DESC'
}

export interface QueryBuilderProps {
  connectionId: string
  tables: { name: string }[]
  connType?: string
  onSendToEditor: (sql: string) => void
  onClose: () => void
}

// ─── Constants ───

const SQL_OPERATORS: SQLOperator[] = ['=', '!=', '>', '<', '>=', '<=', 'LIKE', 'IN', 'IS NULL', 'IS NOT NULL']
const VALUE_LESS_OPS = new Set<SQLOperator>(['IS NULL', 'IS NOT NULL'])
const OPERATOR_PLACEHOLDERS: Partial<Record<SQLOperator, string>> = {
  LIKE: '%value%',
  IN: '1, 2, 3',
}

// ─── Helpers ───

function newId(): string {
  return Math.random().toString(36).slice(2, 9)
}

function quoteIdent(name: string, connType?: string): string {
  const q = connType === 'mysql' || connType === 'mariadb' ? '`' : '"'
  return `${q}${name}${q}`
}

function buildSQL(
  table: string,
  selectedCols: string[],
  allCols: string[],
  conditions: WhereCondition[],
  logicalOp: 'AND' | 'OR',
  orderBy: OrderByClause[],
  limit: string,
  connType?: string,
): string {
  if (!table) return '-- Select a table to begin'

  const qi = (n: string) => quoteIdent(n, connType)

  // SELECT
  const useAll = selectedCols.length === 0 || selectedCols.length === allCols.length
  const colList = useAll ? '*' : selectedCols.map(qi).join(',\n       ')
  let sql = `SELECT ${colList}\nFROM   ${qi(table)}`

  // WHERE
  const valid = conditions.filter(c => c.column)
  if (valid.length > 0) {
    const parts = valid.map(c => {
      if (c.operator === 'IS NULL') return `${qi(c.column)} IS NULL`
      if (c.operator === 'IS NOT NULL') return `${qi(c.column)} IS NOT NULL`
      if (c.operator === 'IN') {
        const items = c.value.split(',').map(item => {
          const t = item.trim()
          return /^\d+(\.\d+)?$/.test(t) ? t : `'${t.replace(/'/g, "''")}'`
        })
        return `${qi(c.column)} IN (${items.join(', ')})`
      }
      const v = c.value
      const qv = /^\d+(\.\d+)?$/.test(v) ? v : `'${v.replace(/'/g, "''")}'`
      return `${qi(c.column)} ${c.operator} ${qv}`
    })
    sql += `\nWHERE  ${parts[0]}`
    for (let i = 1; i < parts.length; i++) {
      sql += `\n   ${logicalOp} ${parts[i]}`
    }
  }

  // ORDER BY
  const validOrd = orderBy.filter(o => o.column)
  if (validOrd.length > 0) {
    sql += `\nORDER  BY ${validOrd.map(o => `${qi(o.column)} ${o.direction}`).join(', ')}`
  }

  // LIMIT
  const lim = parseInt(limit, 10)
  if (!isNaN(lim) && lim > 0) {
    sql += `\nLIMIT  ${lim}`
  }

  return sql + ';'
}

// ─── Sub-components ───

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold text-text-muted uppercase tracking-widest mb-2">
      {children}
    </p>
  )
}

function AddButton({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1 text-[11px] text-primary hover:text-primary/80 disabled:opacity-30 disabled:cursor-not-allowed transition-colors mt-1"
    >
      <span className="material-symbols-outlined text-[13px]">add</span>
      {children}
    </button>
  )
}

// ─── Main Component ───

export function QueryBuilder({ connectionId, tables, connType, onSendToEditor, onClose }: QueryBuilderProps) {
  const [selectedTable, setSelectedTable] = useState<string>('')
  const [selectedCols, setSelectedCols] = useState<string[]>([])
  const [conditions, setConditions] = useState<WhereCondition[]>([])
  const [logicalOp, setLogicalOp] = useState<'AND' | 'OR'>('AND')
  const [orderBy, setOrderBy] = useState<OrderByClause[]>([])
  const [limit, setLimit] = useState<string>('')
  const [copied, setCopied] = useState(false)

  const { data: columns = [], isLoading: colsLoading } = useColumns(connectionId, selectedTable)
  const colNames = columns.map(c => c.name)

  const generatedSQL = buildSQL(
    selectedTable, selectedCols, colNames,
    conditions, logicalOp, orderBy, limit, connType,
  )

  const handleTableChange = useCallback((tableName: string) => {
    setSelectedTable(tableName)
    setSelectedCols([])
    setConditions([])
    setOrderBy([])
    setLimit('')
  }, [])

  const toggleCol = useCallback((name: string) => {
    setSelectedCols(prev => {
      if (prev.length === 0) return colNames.filter(c => c !== name)
      return prev.includes(name) ? prev.filter(c => c !== name) : [...prev, name]
    })
  }, [colNames])

  const resetToStar = useCallback(() => setSelectedCols([]), [])

  const addCondition = useCallback(() => {
    setConditions(prev => [
      ...prev,
      { id: newId(), column: colNames[0] ?? '', operator: '=', value: '' },
    ])
  }, [colNames])

  const updateCondition = useCallback(<K extends keyof WhereCondition>(id: string, field: K, value: WhereCondition[K]) => {
    setConditions(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c))
  }, [])

  const removeCondition = useCallback((id: string) => {
    setConditions(prev => prev.filter(c => c.id !== id))
  }, [])

  // ── ORDER BY ──
  const addOrderBy = useCallback(() => {
    setOrderBy(prev => [
      ...prev,
      { id: newId(), column: colNames[0] ?? '', direction: 'ASC' },
    ])
  }, [colNames])

  const updateOrderBy = useCallback(<K extends keyof OrderByClause>(id: string, field: K, value: OrderByClause[K]) => {
    setOrderBy(prev => prev.map(o => o.id === id ? { ...o, [field]: value } : o))
  }, [])

  const removeOrderBy = useCallback((id: string) => {
    setOrderBy(prev => prev.filter(o => o.id !== id))
  }, [])

  const handleCopy = useCallback(async () => {
    if (!selectedTable) return
    await navigator.clipboard.writeText(generatedSQL)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [generatedSQL, selectedTable])

  const inputStyle = "bg-bg-card text-text-main text-[12px] rounded-md px-2.5 py-1.5 border border-border-subtle/30 focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-text-muted/30 transition-colors"

  return (
    <div className="flex h-full overflow-hidden bg-bg-editor">
      <div className="w-[52%] flex flex-col border-r border-border-subtle/20 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border-subtle/20 shrink-0 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[15px] text-primary">tune</span>
            <span className="text-[12px] font-semibold text-text-main">Query Builder</span>
            <span className="text-[10px] text-text-muted bg-bg-card px-1.5 py-0.5 rounded border border-border-subtle/20">SELECT only</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-text-muted/40 hover:text-text-main transition-colors p-1 rounded hover:bg-bg-hover/30"
            aria-label="Close Query Builder"
          >
            <span className="material-symbols-outlined text-[15px]">close</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">

          <div>
            <SectionLabel>Table</SectionLabel>
            <CustomSelect
              value={selectedTable}
              onChange={handleTableChange}
              placeholder="— select a table —"
              options={[{ value: '', label: '— select a table —' }, ...tables.map(t => ({ value: t.name, label: t.name }))]}
              className="w-full"
            />
          </div>

          {selectedTable && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <SectionLabel>Columns</SectionLabel>
                <button
                  type="button"
                  onClick={resetToStar}
                  className="text-[10px] text-text-muted/60 hover:text-primary transition-colors"
                >
                  {selectedCols.length === 0 ? 'SELECT *' : `${selectedCols.length} selected — reset to *`}
                </button>
              </div>
              {colsLoading ? (
                <p className="text-[11px] text-text-muted animate-pulse">Loading columns…</p>
              ) : (
                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 max-h-44 overflow-y-auto pr-1">
                  {colNames.map(col => {
                    const checked = selectedCols.length === 0 || selectedCols.includes(col)
                    return (
                      <label key={col} className="flex items-center gap-2 cursor-pointer group">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleCol(col)}
                          className="w-3.5 h-3.5 rounded accent-primary cursor-pointer shrink-0"
                        />
                        <span className={`text-[12px] truncate ${checked ? 'text-text-main' : 'text-text-muted/50'}`}>
                          {col}
                        </span>
                      </label>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {selectedTable && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <SectionLabel>WHERE Conditions</SectionLabel>
                {conditions.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setLogicalOp(prev => prev === 'AND' ? 'OR' : 'AND')}
                    className={`text-[10px] font-bold font-mono px-2 py-0.5 rounded border transition-colors ${
                      logicalOp === 'AND'
                        ? 'border-blue-500/40 text-blue-400 bg-blue-500/10 hover:bg-blue-500/20'
                        : 'border-amber-500/40 text-amber-400 bg-amber-500/10 hover:bg-amber-500/20'
                    }`}
                  >
                    {logicalOp} ↔ {logicalOp === 'AND' ? 'OR' : 'AND'}
                  </button>
                )}
              </div>

              <div className="space-y-2">
                {conditions.map((cond, idx) => (
                  <div key={cond.id} className="flex items-center gap-1.5">
                    <span className={`text-[10px] font-bold font-mono w-7 text-center shrink-0 ${
                      idx === 0 ? 'text-text-muted/40' : logicalOp === 'AND' ? 'text-blue-400' : 'text-amber-400'
                    }`}>
                      {idx === 0 ? 'IF' : logicalOp}
                    </span>

                    <CustomSelect
                      value={cond.column}
                      onChange={v => updateCondition(cond.id, 'column', v)}
                      options={colNames.map(c => ({ value: c, label: c }))}
                      className="flex-1 min-w-0"
                    />

                    <CustomSelect
                      value={cond.operator}
                      onChange={v => updateCondition(cond.id, 'operator', v as SQLOperator)}
                      options={SQL_OPERATORS.map(op => ({ value: op, label: op }))}
                      className="shrink-0"
                    />

                    {!VALUE_LESS_OPS.has(cond.operator) ? (
                      <input
                        type="text"
                        value={cond.value}
                        onChange={e => updateCondition(cond.id, 'value', e.target.value)}
                        placeholder={OPERATOR_PLACEHOLDERS[cond.operator] ?? 'value'}
                        className={`flex-1 min-w-0 ${inputStyle}`}
                      />
                    ) : (
                      <div className="flex-1 min-w-0" />
                    )}

                    <button
                      type="button"
                      onClick={() => removeCondition(cond.id)}
                      className="text-text-muted/30 hover:text-red-400 transition-colors shrink-0"
                      aria-label="Remove condition"
                    >
                      <span className="material-symbols-outlined text-[14px]">remove_circle</span>
                    </button>
                  </div>
                ))}
              </div>

              <AddButton onClick={addCondition} disabled={colNames.length === 0}>
                Add condition
              </AddButton>
            </div>
          )}

          {selectedTable && (
            <div>
              <SectionLabel>ORDER BY</SectionLabel>
              <div className="space-y-2">
                {orderBy.map(ord => (
                  <div key={ord.id} className="flex items-center gap-1.5">
                    <CustomSelect
                      value={ord.column}
                      onChange={v => updateOrderBy(ord.id, 'column', v)}
                      options={colNames.map(c => ({ value: c, label: c }))}
                      className="flex-1"
                    />
                    <CustomSelect
                      value={ord.direction}
                      onChange={v => updateOrderBy(ord.id, 'direction', v as 'ASC' | 'DESC')}
                      options={[{ value: 'ASC', label: 'ASC ↑' }, { value: 'DESC', label: 'DESC ↓' }]}
                      className="shrink-0"
                    />
                    <button
                      type="button"
                      onClick={() => removeOrderBy(ord.id)}
                      className="text-text-muted/30 hover:text-red-400 transition-colors shrink-0"
                      aria-label="Remove sort"
                    >
                      <span className="material-symbols-outlined text-[14px]">remove_circle</span>
                    </button>
                  </div>
                ))}
              </div>
              <AddButton onClick={addOrderBy} disabled={colNames.length === 0}>
                Add sort column
              </AddButton>
            </div>
          )}

          {selectedTable && (
            <div>
              <SectionLabel>LIMIT</SectionLabel>
              <input
                type="number"
                min="1"
                value={limit}
                onChange={e => setLimit(e.target.value)}
                placeholder="No limit"
                className={`w-36 ${inputStyle}`}
              />
            </div>
          )}

        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border-subtle/20 shrink-0 flex items-center justify-between">
          <span className="text-[10px] font-semibold text-text-muted uppercase tracking-widest">Generated SQL</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              disabled={!selectedTable}
              className="flex items-center gap-1.5 text-[11px] text-text-muted/60 hover:text-text-main px-2.5 py-1 rounded border border-border-subtle/20 hover:border-border-subtle/50 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              title="Copy SQL to clipboard"
            >
              <span className="material-symbols-outlined text-[13px]">{copied ? 'check' : 'content_copy'}</span>
              {copied ? 'Copied!' : 'Copy'}
            </button>
            <button
              type="button"
              onClick={() => onSendToEditor(generatedSQL)}
              disabled={!selectedTable}
              className="flex items-center gap-1.5 text-[11px] bg-primary/10 hover:bg-primary/20 text-primary px-3 py-1 rounded border border-primary/30 hover:border-primary/50 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              title="Send SQL to editor"
            >
              <span className="material-symbols-outlined text-[13px]">send</span>
              Send to Editor
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {!selectedTable ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
              <span className="material-symbols-outlined text-[40px] text-text-muted/20">manage_search</span>
              <p className="text-[12px] text-text-muted/50 max-w-[200px]">
                Select a table on the left to start building your query
              </p>
            </div>
          ) : (
            <pre className="text-[13px] text-text-main font-mono leading-relaxed whitespace-pre-wrap break-all select-all">
              {generatedSQL}
            </pre>
          )}
        </div>

        <div className="px-4 py-2 border-t border-border-subtle/20 shrink-0">
          <p className="text-[10px] text-text-muted/40">
            Dialect: {connType === 'mysql' || connType === 'mariadb' ? 'MySQL / MariaDB (backtick identifiers)' : 'PostgreSQL / SQLite / Redshift (double-quote identifiers)'}
          </p>
        </div>

      </div>
    </div>
  )
}
