import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { MongoSchemaEditor } from './MongoSchemaEditor'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useColumns } from '@/hooks/useSchema'

// ─── SQL Types ───
const SQL_TYPES = [
  'uuid', 'serial', 'bigserial',
  'integer', 'bigint', 'smallint',
  'numeric', 'decimal', 'real', 'double precision',
  'varchar', 'char', 'text',
  'boolean',
  'date', 'time', 'timestamp', 'timestamptz',
  'json', 'jsonb',
  'bytea', 'blob',
]

// ─── Column Definition ───
interface ColumnDef {
  id: string
  name: string
  type: string
  primaryKey: boolean
  notNull: boolean
  unique: boolean
  defaultValue: string
  status: 'existing' | 'new' | 'modified' | 'deleted'
  originalName?: string
}

let colIdCounter = 0
function newColId() {
  return `col_${Date.now()}_${colIdCounter++}`
}

// ─── Props ───
interface StructureDesignerModalProps {
  open: boolean
  onClose: () => void
  connectionId: string
  tableName: string
  dbType?: string
  database?: string
}

export function StructureDesignerModal({ open, onClose, connectionId, tableName, dbType, database }: StructureDesignerModalProps) {
  // MongoDB: use dedicated schema validation editor
  if (dbType === 'mongodb' && database) {
    return (
      <MongoSchemaEditor
        open={open}
        onClose={onClose}
        connectionId={connectionId}
        collection={tableName}
        database={database}
      />
    )
  }

  const isNewTable = tableName === '__new__'
  const { data: serverColumns = [] } = useColumns(connectionId, isNewTable ? '' : tableName)

  // Editable table name for new tables
  const [editableName, setEditableName] = useState(isNewTable ? 'new_table' : tableName)

  // ─── Local editable column state ───
  const [columns, setColumns] = useState<ColumnDef[]>(() => {
    if (!isNewTable && serverColumns.length) {
      return serverColumns.map((c) => ({
        id: newColId(),
        name: c.name,
        type: c.type,
        primaryKey: c.primaryKey,
        notNull: !c.nullable,
        unique: c.unique,
        defaultValue: c.defaultValue || '',
        status: 'existing' as const,
        originalName: c.name,
      }))
    }
    return [
      { id: newColId(), name: 'id', type: 'uuid', primaryKey: true, notNull: true, unique: false, defaultValue: 'gen_random_uuid()', status: 'new' as const },
      { id: newColId(), name: 'created_at', type: 'timestamptz', primaryKey: false, notNull: true, unique: false, defaultValue: 'now()', status: 'new' as const },
    ]
  })

  // ─── Sync server columns when async data arrives ───
  useEffect(() => {
    if (!isNewTable && serverColumns.length > 0) {
      setColumns(serverColumns.map((c) => ({
        id: newColId(),
        name: c.name,
        type: c.type,
        primaryKey: c.primaryKey,
        notNull: !c.nullable,
        unique: c.unique,
        defaultValue: c.defaultValue || '',
        status: 'existing' as const,
        originalName: c.name,
      })))
    }
  }, [serverColumns, isNewTable])

  // ─── DnD Sensors ───
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      setColumns((prev) => {
        const oldIdx = prev.findIndex((c) => c.id === active.id)
        const newIdx = prev.findIndex((c) => c.id === over.id)
        return arrayMove(prev, oldIdx, newIdx)
      })
    }
  }, [])

  // ─── Column Operations ───
  const updateColumn = useCallback((id: string, updates: Partial<ColumnDef>) => {
    setColumns((prev) =>
      prev.map((c) =>
        c.id === id
          ? { ...c, ...updates, status: c.status === 'new' ? 'new' : 'modified' }
          : c
      )
    )
  }, [])

  const addColumn = useCallback(() => {
    setColumns((prev) => [
      ...prev,
      {
        id: newColId(),
        name: `new_column_${prev.length + 1}`,
        type: 'varchar(255)',
        primaryKey: false,
        notNull: false,
        unique: false,
        defaultValue: '',
        status: 'new',
      },
    ])
  }, [])

  const removeColumn = useCallback((id: string) => {
    setColumns((prev) =>
      prev.map((c) => (c.id === id ? { ...c, status: 'deleted' as const } : c))
    )
  }, [])

  const discardChanges = useCallback(() => {
    setColumns((prev) =>
      prev
        .filter((c) => c.status !== 'new')
        .map((c) => (c.status === 'deleted' || c.status === 'modified' ? { ...c, status: 'existing' as const } : c))
    )
  }, [])

  // ─── Pending Changes ───
  const pendingChanges = useMemo(() => columns.filter((c) => c.status !== 'existing'), [columns])
  const visibleColumns = useMemo(() => columns.filter((c) => c.status !== 'deleted'), [columns])

  // ─── DDL Preview ───
  const [showDDL, setShowDDL] = useState(false)
  const ddlPreview = useMemo(() => {
    const lines: string[] = []
    const newCols = columns.filter((c) => c.status === 'new')
    const modCols = columns.filter((c) => c.status === 'modified')
    const delCols = columns.filter((c) => c.status === 'deleted')

    for (const col of newCols) {
      let line = `ALTER TABLE ${isNewTable ? editableName : tableName} ADD COLUMN ${col.name} ${col.type}`
      if (col.notNull) line += ' NOT NULL'
      if (col.unique) line += ' UNIQUE'
      if (col.defaultValue) line += ` DEFAULT ${col.defaultValue}`
      lines.push(line + ';')
    }
    for (const col of modCols) {
      if (col.originalName && col.originalName !== col.name) {
        lines.push(`ALTER TABLE ${isNewTable ? editableName : tableName} RENAME COLUMN ${col.originalName} TO ${col.name};`)
      }
      lines.push(`ALTER TABLE ${isNewTable ? editableName : tableName} ALTER COLUMN ${col.name} TYPE ${col.type};`)
    }
    for (const col of delCols) {
      lines.push(`ALTER TABLE ${isNewTable ? editableName : tableName} DROP COLUMN ${col.name};`)
    }
    return lines.join('\n') || '-- No pending changes'
  }, [columns, tableName])

  // Escape to close
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal Card */}
      <div className="relative w-full max-w-[1000px] max-h-[85vh] bg-bg-card rounded-xl border border-border-subtle flex flex-col overflow-hidden animate-fade-in-up mx-4">
        {/* ─── Header ─── */}
        <div className="px-6 py-5 border-b border-border-subtle flex items-center justify-between bg-bg-card z-10 shrink-0">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-text-muted">table_chart</span>
              {isNewTable ? (
                <input
                  className="text-xl font-bold text-text-main font-display tracking-tight bg-transparent border-b-2 border-primary/50 focus:border-primary outline-none px-1 py-0.5 w-64"
                  value={editableName}
                  onChange={(e) => setEditableName(e.target.value)}
                  placeholder="table_name"
                  autoFocus
                />
              ) : (
                <h1 className="text-xl font-bold text-text-main font-display tracking-tight">{tableName}</h1>
              )}
              {dbType && (
                <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-bg-hover text-text-muted">
                  {dbType}
                </span>
              )}
            </div>
            <p className="text-sm text-text-muted pl-9">
              {isNewTable
                ? 'Design your new table. Add columns and set constraints.'
                : 'Modify columns and constraints visually. Changes are staged until applied.'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowDDL(!showDDL)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-bg-hover hover:bg-border-subtle text-text-main text-sm font-medium transition-all"
            >
              <span className="material-symbols-outlined text-[18px]">code</span>
              DDL
            </button>
            <button
              onClick={addColumn}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary hover:bg-primary-hover text-white text-sm font-bold transition-all"
            >
              <span className="material-symbols-outlined text-[18px]">add_column_right</span>
              Add Column
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-text-muted hover:text-text-main hover:bg-bg-hover transition-colors ml-1"
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>
        </div>

        {/* ─── Scrollable Content ─── */}
        <div className="flex-1 overflow-y-auto bg-bg-card/50">
          {/* DDL Preview Panel */}
          {showDDL && (
            <div className="mx-6 mt-4 bg-bg-editor rounded-lg border border-border-subtle overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border-subtle/50 flex items-center justify-between">
                <span className="text-xs font-semibold text-text-main">Generated DDL</span>
                <button onClick={() => setShowDDL(false)} className="text-text-muted hover:text-text-main">
                  <span className="material-symbols-outlined text-[16px]">close</span>
                </button>
              </div>
              <pre className="p-4 text-[13px] font-mono text-emerald-400 overflow-x-auto">{ddlPreview}</pre>
            </div>
          )}

          {/* Grid Header */}
          <div className="grid grid-cols-12 gap-4 px-6 py-3 border-b border-border-subtle bg-bg-card sticky top-0 z-10 text-xs font-semibold text-text-muted uppercase tracking-wider">
            <div className="col-span-1 text-center">Order</div>
            <div className="col-span-4">Column Name</div>
            <div className="col-span-3">Type</div>
            <div className="col-span-3">Constraints</div>
            <div className="col-span-1 text-right">Actions</div>
          </div>

          {/* Sortable Column Rows */}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={visibleColumns.map((c) => c.id)} strategy={verticalListSortingStrategy}>
              <div className="divide-y divide-border-subtle/50">
                {visibleColumns.map((col) => (
                  <SortableColumnRow
                    key={col.id}
                    column={col}
                    onUpdate={(updates) => updateColumn(col.id, updates)}
                    onRemove={() => removeColumn(col.id)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>

          {/* Add Row Ghost */}
          <button
            onClick={addColumn}
            className="grid grid-cols-12 gap-4 px-6 py-3 items-center hover:bg-bg-hover/20 transition-colors group w-full text-left"
          >
            <div className="col-span-1" />
            <div className="col-span-11 flex items-center gap-2 text-text-muted group-hover:text-primary transition-colors">
              <span className="material-symbols-outlined text-[18px]">add</span>
              <span className="text-sm font-mono">Add new column...</span>
            </div>
          </button>
        </div>

        {/* ─── Pending Changes Footer ─── */}
        {pendingChanges.length > 0 && (
          <div className="px-6 py-4 bg-bg-card border-t border-border-subtle z-20 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center size-8 rounded-full text-primary">
                <span className="material-symbols-outlined text-[18px]">history_edu</span>
              </div>
              <div>
                <p className="text-sm font-medium text-text-main">
                  {pendingChanges.length} Change{pendingChanges.length > 1 ? 's' : ''} Pending
                </p>
                <p className="text-xs text-text-muted">Review changes before applying to production.</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={discardChanges}
                className="px-4 py-2 rounded-lg text-text-muted hover:text-text-main text-sm font-medium transition-colors"
              >
                Discard
              </button>
              <button
                onClick={() => setShowDDL(true)}
                className="flex items-center gap-2 px-5 py-2 rounded-lg bg-primary hover:bg-primary-hover text-white text-sm font-bold transition-all active:scale-95"
              >
                <span className="material-symbols-outlined text-[18px]">check</span>
                Apply Changes
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Sortable Column Row ───
function SortableColumnRow({ column, onUpdate, onRemove }: {
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
        <button {...attributes} {...listeners} className="cursor-grab text-text-muted hover:text-text-main active:cursor-grabbing">
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
          ref={typeBtnRef}
          onClick={handleTypeOpen}
          className="flex items-center justify-between w-full px-3 py-1.5 rounded bg-bg-hover/50 hover:bg-bg-hover border border-transparent hover:border-border-subtle text-emerald-400 font-mono text-xs transition-all"
        >
          <span>{column.type}</span>
          <span className="material-symbols-outlined text-[16px] text-text-muted">expand_more</span>
        </button>

        {typeOpen && (
          <>
            <div className="fixed inset-0 z-[60]" onClick={() => { setTypeOpen(false); setTypeSearch('') }} />
            <div
              className="fixed z-[70] bg-bg-hover border border-primary rounded-lg overflow-hidden animate-fade-in shadow-xl"
              style={{ top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width }}
            >
              <div className="p-2 border-b border-border-subtle/50">
                <div className="flex items-center gap-2 bg-bg-card px-2 py-1.5 rounded border border-border-subtle/50">
                  <span className="material-symbols-outlined text-[14px] text-text-muted">search</span>
                  <input
                    autoFocus
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

// ─── Constraint Pill Toggle ───
function ConstraintPill({ label, active, onClick, title }: { label: string; active: boolean; onClick: () => void; title: string }) {
  return (
    <button
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
