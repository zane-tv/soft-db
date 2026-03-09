import { useState, useEffect, useRef } from 'react'

interface EditableCellProps {
  value: unknown
  columnType?: string
  onCommit: (value: unknown) => void
  onCancel: () => void
  onTab?: () => void
}

export function EditableCell({ value, columnType, onCommit, onCancel, onTab }: EditableCellProps) {
  const category = getCellCategory(columnType)
  const [editValue, setEditValue] = useState(() => formatForEdit(value, category))
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    if (inputRef.current && 'select' in inputRef.current) {
      (inputRef.current as HTMLInputElement).select()
    }
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onCommit(parseFromEdit(editValue, category))
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    } else if (e.key === 'Tab') {
      e.preventDefault()
      onCommit(parseFromEdit(editValue, category))
      onTab?.()
    }
  }

  const handleBlur = () => {
    onCommit(parseFromEdit(editValue, category))
  }

  const baseClass = "w-full h-full bg-bg-app text-text-main text-[12px] font-mono px-2 py-1 border-2 border-primary/70 rounded focus:outline-none focus:border-primary"

  if (category === 'boolean') {
    return (
      <select
        ref={inputRef as React.RefObject<HTMLSelectElement>}
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        className={baseClass}
      >
        <option value="true">true</option>
        <option value="false">false</option>
        <option value="null">NULL</option>
      </select>
    )
  }

  if (category === 'json' || (typeof value === 'string' && value.length > 100)) {
    return (
      <textarea
        ref={inputRef as React.RefObject<HTMLTextAreaElement>}
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        rows={3}
        className={`${baseClass} resize-none`}
      />
    )
  }

  return (
    <div className="flex items-center gap-0.5">
      <input
        ref={inputRef as React.RefObject<HTMLInputElement>}
        type={category === 'number' ? 'number' : category === 'date' ? 'datetime-local' : 'text'}
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        className={`${baseClass} flex-1`}
        step={category === 'number' ? 'any' : undefined}
      />
      {value !== null && (
        <button
          onClick={() => onCommit(null)}
          className="shrink-0 px-1 py-0.5 text-[9px] text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded border border-red-500/20"
          title="Set NULL"
        >
          NULL
        </button>
      )}
    </div>
  )
}

// ─── Helpers ───

type CellCategory = 'text' | 'number' | 'date' | 'boolean' | 'json'

function getCellCategory(type?: string): CellCategory {
  if (!type) return 'text'
  const t = type.toLowerCase()
  if (t.includes('int') || t.includes('float') || t.includes('numeric') || t.includes('decimal') || t.includes('real') || t.includes('double')) return 'number'
  if (t.includes('bool')) return 'boolean'
  if (t.includes('date') || t.includes('time') || t.includes('timestamp')) return 'date'
  if (t.includes('json')) return 'json'
  return 'text'
}

function formatForEdit(value: unknown, category: CellCategory): string {
  if (value === null || value === undefined) return ''
  if (category === 'boolean') return String(value).toLowerCase() === 'true' || value === 1 ? 'true' : 'false'
  if (category === 'json' && typeof value === 'object') return JSON.stringify(value, null, 2)
  return String(value)
}

function parseFromEdit(editValue: string, category: CellCategory): unknown {
  if (editValue === '' || editValue === 'null') return null
  switch (category) {
    case 'number': {
      const n = Number(editValue)
      return isNaN(n) ? editValue : n
    }
    case 'boolean':
      return editValue === 'true'
    case 'json':
      try { return JSON.parse(editValue) } catch { return editValue }
    default:
      return editValue
  }
}
