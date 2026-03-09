import { useState, useMemo } from 'react'
import type { Column } from '@tanstack/react-table'

type Row = Record<string, unknown>

interface ColumnFilterProps {
  column: Column<Row, unknown>
}

// ─── Filter Operators ───
type TextOp = 'contains' | 'equals' | 'startsWith' | 'endsWith' | 'notContains'
type NumOp = '=' | '!=' | '>' | '<' | '>=' | '<='

// ─── Helpers ───
function getColumnCategory(type?: string): 'text' | 'number' | 'date' | 'boolean' | 'other' {
  if (!type) return 'text'
  const t = type.toLowerCase()
  if (t.includes('int') || t.includes('float') || t.includes('numeric') || t.includes('decimal') || t.includes('real') || t.includes('double')) return 'number'
  if (t.includes('bool')) return 'boolean'
  if (t.includes('date') || t.includes('time') || t.includes('timestamp')) return 'date'
  if (t.includes('char') || t.includes('text') || t.includes('varchar') || t.includes('clob')) return 'text'
  return 'text'
}

// ─── Main Component ───
export function ColumnFilter({ column }: ColumnFilterProps) {
  const colType = (column.columnDef.meta as Record<string, string>)?.type
  const category = useMemo(() => getColumnCategory(colType), [colType])

  switch (category) {
    case 'number':
      return <NumberFilter column={column} />
    case 'boolean':
      return <BooleanFilter column={column} />
    case 'date':
      return <DateFilter column={column} />
    default:
      return <TextFilter column={column} />
  }
}

// ─── Text Filter ───
function TextFilter({ column }: { column: Column<Row, unknown> }) {
  const [op, setOp] = useState<TextOp>('contains')
  const currentValue = (column.getFilterValue() as { op: TextOp; value: string })?.value ?? ''

  const handleChange = (value: string) => {
    if (!value) {
      column.setFilterValue(undefined)
    } else {
      column.setFilterValue({ op, value })
    }
  }

  const handleOpChange = (newOp: TextOp) => {
    setOp(newOp)
    if (currentValue) {
      column.setFilterValue({ op: newOp, value: currentValue })
    }
  }

  return (
    <div className="flex items-center gap-0.5">
      <select
        value={op}
        onChange={(e) => handleOpChange(e.target.value as TextOp)}
        className="h-6 px-1 text-[10px] bg-bg-app border border-border-subtle/50 rounded-l text-text-muted focus:outline-none focus:border-primary/50 w-[52px]"
        title="Filter operator"
      >
        <option value="contains">∋</option>
        <option value="equals">=</option>
        <option value="startsWith">A..</option>
        <option value="endsWith">..Z</option>
        <option value="notContains">∌</option>
      </select>
      <input
        type="text"
        value={currentValue}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="Filter..."
        className="h-6 px-1.5 text-[11px] bg-bg-app border border-border-subtle/50 rounded-r text-text-main placeholder:text-text-muted/30 focus:outline-none focus:border-primary/50 w-full min-w-[60px]"
      />
    </div>
  )
}

// ─── Number Filter ───
function NumberFilter({ column }: { column: Column<Row, unknown> }) {
  const [op, setOp] = useState<NumOp>('=')
  const currentValue = (column.getFilterValue() as { op: NumOp; value: string })?.value ?? ''

  const handleChange = (value: string) => {
    if (!value) {
      column.setFilterValue(undefined)
    } else {
      column.setFilterValue({ op, value })
    }
  }

  const handleOpChange = (newOp: NumOp) => {
    setOp(newOp)
    if (currentValue) {
      column.setFilterValue({ op: newOp, value: currentValue })
    }
  }

  return (
    <div className="flex items-center gap-0.5">
      <select
        value={op}
        onChange={(e) => handleOpChange(e.target.value as NumOp)}
        className="h-6 px-1 text-[10px] bg-bg-app border border-border-subtle/50 rounded-l text-text-muted focus:outline-none focus:border-primary/50 w-[40px]"
        title="Filter operator"
      >
        <option value="=">=</option>
        <option value="!=">≠</option>
        <option value=">">{'>'}</option>
        <option value="<">{'<'}</option>
        <option value=">=">≥</option>
        <option value="<=">≤</option>
      </select>
      <input
        type="number"
        value={currentValue}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="0"
        className="h-6 px-1.5 text-[11px] bg-bg-app border border-border-subtle/50 rounded-r text-text-main placeholder:text-text-muted/30 focus:outline-none focus:border-primary/50 w-full min-w-[50px] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
      />
    </div>
  )
}

// ─── Boolean Filter ───
function BooleanFilter({ column }: { column: Column<Row, unknown> }) {
  const currentValue = column.getFilterValue() as string | undefined

  return (
    <select
      value={currentValue ?? 'all'}
      onChange={(e) => {
        const v = e.target.value
        column.setFilterValue(v === 'all' ? undefined : v)
      }}
      className="h-6 px-1 text-[10px] bg-bg-app border border-border-subtle/50 rounded text-text-muted focus:outline-none focus:border-primary/50 w-full"
    >
      <option value="all">All</option>
      <option value="true">True</option>
      <option value="false">False</option>
    </select>
  )
}

// ─── Date Filter ───
function DateFilter({ column }: { column: Column<Row, unknown> }) {
  const currentValue = (column.getFilterValue() as { from: string; to: string }) ?? { from: '', to: '' }

  const handleChange = (field: 'from' | 'to', value: string) => {
    const updated = { ...currentValue, [field]: value }
    if (!updated.from && !updated.to) {
      column.setFilterValue(undefined)
    } else {
      column.setFilterValue(updated)
    }
  }

  return (
    <div className="flex items-center gap-0.5">
      <input
        type="date"
        value={currentValue.from}
        onChange={(e) => handleChange('from', e.target.value)}
        className="h-6 px-1 text-[10px] bg-bg-app border border-border-subtle/50 rounded-l text-text-muted focus:outline-none focus:border-primary/50 w-1/2"
        title="From date"
      />
      <input
        type="date"
        value={currentValue.to}
        onChange={(e) => handleChange('to', e.target.value)}
        className="h-6 px-1 text-[10px] bg-bg-app border border-border-subtle/50 rounded-r text-text-muted focus:outline-none focus:border-primary/50 w-1/2"
        title="To date"
      />
    </div>
  )
}

// ─── Custom Filter Functions ───

export function textFilterFn(row: Row, columnId: string, filterValue: { op: TextOp; value: string }): boolean {
  const cellValue = String(row[columnId] ?? '').toLowerCase()
  const search = filterValue.value.toLowerCase()

  switch (filterValue.op) {
    case 'contains': return cellValue.includes(search)
    case 'equals': return cellValue === search
    case 'startsWith': return cellValue.startsWith(search)
    case 'endsWith': return cellValue.endsWith(search)
    case 'notContains': return !cellValue.includes(search)
    default: return true
  }
}

export function numberFilterFn(row: Row, columnId: string, filterValue: { op: NumOp; value: string }): boolean {
  const cellValue = Number(row[columnId])
  const target = Number(filterValue.value)
  if (isNaN(cellValue) || isNaN(target)) return true

  switch (filterValue.op) {
    case '=': return cellValue === target
    case '!=': return cellValue !== target
    case '>': return cellValue > target
    case '<': return cellValue < target
    case '>=': return cellValue >= target
    case '<=': return cellValue <= target
    default: return true
  }
}

export function booleanFilterFn(row: Row, columnId: string, filterValue: string): boolean {
  const cellValue = row[columnId]
  if (filterValue === 'true') return cellValue === true || cellValue === 1 || String(cellValue).toLowerCase() === 'true'
  if (filterValue === 'false') return cellValue === false || cellValue === 0 || String(cellValue).toLowerCase() === 'false'
  return true
}

export function dateFilterFn(row: Row, columnId: string, filterValue: { from: string; to: string }): boolean {
  const cellValue = String(row[columnId] ?? '')
  if (!cellValue) return false

  // Try to parse as date
  const cellDate = new Date(cellValue).getTime()
  if (isNaN(cellDate)) return true

  if (filterValue.from) {
    const from = new Date(filterValue.from).getTime()
    if (cellDate < from) return false
  }
  if (filterValue.to) {
    const to = new Date(filterValue.to + 'T23:59:59').getTime()
    if (cellDate > to) return false
  }
  return true
}
