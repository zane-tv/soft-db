import { useState, useMemo, useCallback, useRef } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { SQL_TYPES, type ColumnDef } from './structure-designer-types'

// ─── Constraint Pill Toggle ───
function ConstraintPill({ label, active, onClick, title }: { label: string; active: boolean; onClick: () => void; title: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`h-6 px-2 rounded-full text-[10px] font-bold tracking-wide transition-all ${
        active
          ? 'bg-primary text-text-main'
          : 'border border-border-subtle text-text-muted hover:border-text-muted/50 hover:text-text-main'
      }`}
    >
      {label}
    </button>
  )
}

// ─── Sortable Column Row ───
export function SortableColumnRow({ column, onUpdate, onRemove }: {
  column: ColumnDef
  onUpdate: (updates: Partial<ColumnDef>) => void
  onRemove: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: column.id })
  const [typeOpen, setTypeOpen] = useState(false)
  const [typeSearch, setTypeSearch] = useState('')
  const typeBtnRef = useRef<HTMLButtonElement>(null)
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 0 })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : undefined,
  }

  const filteredTypes = useMemo(
    () => (typeSearch ? SQL_TYPES.filter((t) => t.includes(typeSearch.toLowerCase())) : SQL_TYPES),
    [typeSearch]
  )

  const handleTypeOpen = useCallback(() => {
    if (!typeOpen && typeBtnRef.current) {
      const rect = typeBtnRef.current.getBoundingClientRect()
      setDropdownPos({ top: rect.top, left: rect.left, width: rect.width })
    }
    setTypeOpen((prev) => !prev)
  }, [typeOpen])

  const statusBorder =
    column.status === 'new'
      ? 'border-l-2 border-l-emerald-500 bg-emerald-500/5'
      : column.status === 'modified'
        ? 'border-l-2 border-l-primary'
        : ''

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`grid grid-cols-12 gap-4 px-6 py-4 items-center hover:bg-bg-hover/30 transition-colors group ${statusBorder}`}
    >
      {/* Drag Handle */}
      <div className="col-span-1 flex justify-center">
        <button type="button" {...attributes} {...listeners} className="cursor-grab text-text-muted hover:text-text-main active:cursor-grabbing">
          <span className="material-symbols-outlined text-[20px]">drag_indicator</span>
        </button>
      </div>

      {/* Column Name */}
      <div className="col-span-4">
        <div className="flex items-center gap-2">
          {column.primaryKey ? (
            <span className="material-symbols-outlined text-[16px] text-amber-400">key</span>
          ) : (
            <div className="w-4" />
          )}
          <input
            className="bg-transparent border-none p-0 text-text-main font-mono text-sm focus:ring-0 w-full hover:text-primary transition-colors cursor-text outline-none"
            type="text"
            value={column.name}
            onChange={(e) => onUpdate({ name: e.target.value })}
          />
        </div>
      </div>

      {/* Type Dropdown */}
      <div className="col-span-3">
        <button
          type="button"
          ref={typeBtnRef}
          onClick={handleTypeOpen}
          className="flex items-center justify-between w-full px-3 py-1.5 rounded bg-bg-hover/50 hover:bg-bg-hover border border-transparent hover:border-border-subtle text-emerald-400 font-mono text-xs transition-all"
        >
          <span>{column.type}</span>
          <span className="material-symbols-outlined text-[16px] text-text-muted">expand_more</span>
        </button>

        {typeOpen && (
          <>
            <button
              type="button"
              aria-label="Close type menu"
              className="fixed inset-0 z-[60]"
              onClick={() => {
                setTypeOpen(false)
                setTypeSearch('')
              }}
            />
            <div
              className="fixed z-[70] bg-bg-hover border border-primary rounded-lg overflow-hidden animate-fade-in shadow-xl"
              style={{ top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width }}
            >
              <div className="p-2 border-b border-border-subtle/50">
                <div className="flex items-center gap-2 bg-bg-card px-2 py-1.5 rounded border border-border-subtle/50">
                  <span className="material-symbols-outlined text-[14px] text-text-muted">search</span>
                  <input
                    className="bg-transparent border-none p-0 text-xs text-text-main w-full focus:ring-0 outline-none"
                    placeholder="Search type..."
                    value={typeSearch}
                    onChange={(e) => setTypeSearch(e.target.value)}
                  />
                </div>
              </div>
              <div className="max-h-[200px] overflow-y-auto">
                {filteredTypes.map((t) => (
                  <button
                    type="button"
                    key={t}
                    onClick={() => {
                      onUpdate({ type: t })
                      setTypeOpen(false)
                      setTypeSearch('')
                    }}
                    className={`w-full px-3 py-2 text-xs font-mono text-left flex justify-between items-center transition-colors ${
                      t === column.type ? 'text-text-main bg-primary/20' : 'text-text-muted hover:text-text-main hover:bg-bg-card/50'
                    }`}
                  >
                    <span>{t}</span>
                    {t === column.type && <span className="material-symbols-outlined text-[14px]">check</span>}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Constraint Toggles */}
      <div className="col-span-3 flex items-center gap-2">
        <ConstraintPill label="PK" active={column.primaryKey} onClick={() => onUpdate({ primaryKey: !column.primaryKey })} title="Primary Key" />
        <ConstraintPill label="NN" active={column.notNull} onClick={() => onUpdate({ notNull: !column.notNull })} title="Not Null" />
        <ConstraintPill label="UN" active={column.unique} onClick={() => onUpdate({ unique: !column.unique })} title="Unique" />
      </div>

      {/* Actions */}
      <div className="col-span-1 flex justify-end">
        {column.status === 'new' ? (
          <div className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span className="text-[10px] text-emerald-500 font-medium">New</span>
          </div>
        ) : column.status === 'modified' ? (
          <div className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            <span className="text-[10px] text-amber-400 font-medium">Edit</span>
          </div>
        ) : (
          <button
            type="button"
            onClick={onRemove}
            className="p-1.5 rounded-lg text-text-muted hover:text-red-400 hover:bg-red-400/10 transition-colors opacity-0 group-hover:opacity-100"
          >
            <span className="material-symbols-outlined text-[18px]">delete</span>
          </button>
        )}
      </div>
    </div>
  )
}
