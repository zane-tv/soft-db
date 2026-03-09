import { useState, useMemo } from 'react'
import type { ColumnInfo } from '../../bindings/soft-db/internal/driver/models'

type FieldValues = Record<string, unknown>

interface AddRecordModalProps {
  mode: 'add' | 'edit' | 'duplicate'
  columns: ColumnInfo[]
  initialValues?: FieldValues
  onSubmit: (values: FieldValues) => Promise<void>
  onClose: () => void
}

export function AddRecordModal({ mode, columns, initialValues, onSubmit, onClose }: AddRecordModalProps) {
  const [values, setValues] = useState<FieldValues>(() => {
    if (!initialValues) return {}
    if (mode === 'duplicate') {
      // Clear PK values for duplication
      const clone = { ...initialValues }
      for (const col of columns) {
        if (col.primaryKey) delete clone[col.name]
      }
      return clone
    }
    return { ...initialValues }
  })
  const [nullFields, setNullFields] = useState<Set<string>>(() => {
    const set = new Set<string>()
    if (initialValues) {
      for (const [k, v] of Object.entries(initialValues)) {
        if (v === null || v === undefined) set.add(k)
      }
    }
    return set
  })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')

  const editableColumns = useMemo(() => {
    if (mode === 'edit') {
      // In edit mode, show all columns but disable PK
      return columns
    }
    // In add/duplicate, skip auto-increment PK columns
    return columns.filter((col) => {
      if (col.primaryKey && isAutoIncrement(col)) return false
      return true
    })
  }, [columns, mode])

  const title = mode === 'add' ? 'Add Record' : mode === 'edit' ? 'Edit Record' : 'Duplicate Record'
  const submitLabel = mode === 'add' ? 'Insert' : mode === 'edit' ? 'Update' : 'Insert Copy'

  const handleSubmit = async () => {
    setIsSubmitting(true)
    setError('')
    try {
      // Build final values with null handling
      const finalValues: FieldValues = {}
      for (const col of editableColumns) {
        if (mode === 'edit' && col.primaryKey) continue // Skip PK in edit mode
        if (nullFields.has(col.name)) {
          finalValues[col.name] = null
        } else if (values[col.name] !== undefined) {
          finalValues[col.name] = parseFieldValue(values[col.name], col.type)
        }
      }
      await onSubmit(finalValues)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsSubmitting(false)
    }
  }

  const updateField = (name: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [name]: value }))
    setNullFields((prev) => { const s = new Set(prev); s.delete(name); return s })
  }

  const toggleNull = (name: string) => {
    setNullFields((prev) => {
      const s = new Set(prev)
      if (s.has(name)) s.delete(name)
      else s.add(name)
      return s
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-bg-card border border-border-subtle rounded-2xl w-[520px] max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle/50">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[20px] text-primary">
              {mode === 'add' ? 'add_circle' : mode === 'edit' ? 'edit' : 'content_copy'}
            </span>
            <h3 className="text-base font-semibold text-text-main">{title}</h3>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-main transition-colors">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Form */}
        <div className="flex-1 overflow-auto p-6 space-y-4">
          {editableColumns.map((col) => {
            const isPk = col.primaryKey
            const isNull = nullFields.has(col.name)
            const disabled = mode === 'edit' && isPk

            return (
              <div key={col.name} className={`space-y-1 ${disabled ? 'opacity-50' : ''}`}>
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-text-main flex items-center gap-1.5">
                    {isPk && <span className="material-symbols-outlined text-[12px] text-amber-400">key</span>}
                    {col.name}
                    <span className="text-[10px] text-text-muted/50 font-mono">{col.type}</span>
                  </label>
                  <div className="flex items-center gap-2">
                    {col.nullable && !disabled && (
                      <button
                        onClick={() => toggleNull(col.name)}
                        className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                          isNull
                            ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                            : 'text-text-muted/40 border-border-subtle/30 hover:text-text-muted'
                        }`}
                      >
                        NULL
                      </button>
                    )}
                  </div>
                </div>
                {isNull ? (
                  <div className="h-9 flex items-center px-3 bg-bg-hover/30 border border-border-subtle/30 rounded-lg text-text-muted/40 text-sm italic">
                    NULL
                  </div>
                ) : (
                  <FieldInput
                    type={col.type}
                    value={values[col.name]}
                    defaultValue={col.defaultValue}
                    disabled={disabled}
                    onChange={(val) => updateField(col.name, val)}
                  />
                )}
              </div>
            )
          })}
        </div>

        {/* Error */}
        {error && (
          <div className="mx-6 mb-2 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs">
            {error}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border-subtle/50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-text-muted hover:text-text-main hover:bg-bg-hover/50 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="px-5 py-2 text-sm bg-primary hover:bg-primary-hover text-white rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            {isSubmitting ? 'Saving...' : submitLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Field Input ───
function FieldInput({ type, value, defaultValue, disabled, onChange }: {
  type: string
  value: unknown
  defaultValue?: string
  disabled?: boolean
  onChange: (val: unknown) => void
}) {
  const t = type.toLowerCase()
  const baseClass = "w-full h-9 px-3 text-sm bg-bg-app border border-border-subtle/50 rounded-lg text-text-main focus:outline-none focus:border-primary/50 disabled:opacity-40 disabled:cursor-not-allowed"

  if (t.includes('bool')) {
    return (
      <select
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value === 'true')}
        disabled={disabled}
        className={baseClass}
      >
        <option value="">—</option>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    )
  }

  if (t.includes('int') || t.includes('float') || t.includes('numeric') || t.includes('decimal') || t.includes('real') || t.includes('double')) {
    return (
      <input
        type="number"
        value={value !== undefined && value !== null ? String(value) : ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={defaultValue || '0'}
        disabled={disabled}
        step="any"
        className={`${baseClass} [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none`}
      />
    )
  }

  if (t.includes('date') && !t.includes('time')) {
    return (
      <input
        type="date"
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={baseClass}
      />
    )
  }

  if (t.includes('timestamp') || t.includes('datetime')) {
    return (
      <input
        type="datetime-local"
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={baseClass}
      />
    )
  }

  if (t.includes('text') || t.includes('json') || t.includes('clob')) {
    return (
      <textarea
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
        placeholder={defaultValue || ''}
        disabled={disabled}
        rows={3}
        className={`${baseClass} h-auto resize-none py-2`}
      />
    )
  }

  // Default: text input
  return (
    <input
      type="text"
      value={value !== undefined && value !== null ? String(value) : ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={defaultValue || ''}
      disabled={disabled}
      className={baseClass}
    />
  )
}

// ─── Helpers ───
function isAutoIncrement(col: ColumnInfo): boolean {
  const extra = (col.extra || '').toLowerCase()
  const type = col.type.toLowerCase()
  return extra.includes('auto_increment') ||
    extra.includes('autoincrement') ||
    type.includes('serial') ||
    type === 'integer' // SQLite INTEGER PRIMARY KEY is auto-increment
}

function parseFieldValue(value: unknown, type: string): unknown {
  if (value === '' || value === undefined) return null
  const t = type.toLowerCase()
  if (t.includes('int') || t.includes('float') || t.includes('numeric') || t.includes('decimal') || t.includes('real') || t.includes('double')) {
    const n = Number(value)
    return isNaN(n) ? value : n
  }
  if (t.includes('bool')) return value === true || value === 'true'
  return value
}
