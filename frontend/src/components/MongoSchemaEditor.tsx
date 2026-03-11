import { useState, useCallback, useMemo, useEffect } from 'react'
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
import { useColumns, useMongoValidator, useSetMongoValidator } from '@/hooks/useSchema'

// ─── BSON Types ───
const BSON_TYPES = [
  'objectId', 'string', 'int', 'long', 'double', 'decimal',
  'bool', 'date', 'timestamp', 'object', 'array',
  'binData', 'regex', 'null',
]

// ─── Field Definition ───
interface MongoFieldDef {
  id: string
  name: string
  bsonType: string
  required: boolean
  description: string
  status: 'existing' | 'new' | 'modified' | 'deleted'
  originalName?: string
}

let fieldIdCounter = 0
function newFieldId() {
  return `field_${Date.now()}_${fieldIdCounter++}`
}

// ─── Props ───
interface MongoSchemaEditorProps {
  open: boolean
  onClose: () => void
  connectionId: string
  collection: string
  database: string
}

export function MongoSchemaEditor({ open, onClose, connectionId, collection, database }: MongoSchemaEditorProps) {
  const { data: serverColumns = [] } = useColumns(connectionId, collection)
  const { data: existingValidator } = useMongoValidator(connectionId, database, collection)
  const setValidatorMutation = useSetMongoValidator()

  // ─── Build fields from existing validator or inferred columns ───
  const [fields, setFields] = useState<MongoFieldDef[]>([])
  const [initialized, setInitialized] = useState(false)

  useEffect(() => {
    if (initialized) return
    if (!serverColumns.length && !existingValidator) return

    // Build from validator if exists, else from inferred columns
    const validatorProps = existingValidator?.properties as Record<string, Record<string, unknown>> | undefined
    const requiredFields = (existingValidator?.required as string[]) || []

    if (validatorProps && Object.keys(validatorProps).length > 0) {
      // Use validator schema
      const items: MongoFieldDef[] = Object.entries(validatorProps).map(([name, def]) => ({
        id: newFieldId(),
        name,
        bsonType: (def.bsonType as string) || 'string',
        required: requiredFields.includes(name),
        description: (def.description as string) || '',
        status: 'existing' as const,
        originalName: name,
      }))
      setFields(items)
    } else if (serverColumns.length > 0) {
      // Fall back to inferred columns
      const items: MongoFieldDef[] = serverColumns.map((c) => ({
        id: newFieldId(),
        name: c.name,
        bsonType: c.type || 'string',
        required: c.name === '_id',
        description: '',
        status: 'existing' as const,
        originalName: c.name,
      }))
      setFields(items)
    }
    setInitialized(true)
  }, [serverColumns, existingValidator, initialized])

  // Reset on re-open
  useEffect(() => {
    if (!open) setInitialized(false)
  }, [open])

  // ─── DnD ───
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      setFields((prev) => {
        const oldIdx = prev.findIndex((f) => f.id === active.id)
        const newIdx = prev.findIndex((f) => f.id === over.id)
        return arrayMove(prev, oldIdx, newIdx)
      })
    }
  }, [])

  // ─── Field Operations ───
  const updateField = useCallback((id: string, updates: Partial<MongoFieldDef>) => {
    setFields((prev) =>
      prev.map((f) =>
        f.id === id
          ? { ...f, ...updates, status: f.status === 'new' ? 'new' : 'modified' }
          : f
      )
    )
  }, [])

  const addField = useCallback(() => {
    setFields((prev) => [
      ...prev,
      {
        id: newFieldId(),
        name: `new_field_${prev.length + 1}`,
        bsonType: 'string',
        required: false,
        description: '',
        status: 'new',
      },
    ])
  }, [])

  const removeField = useCallback((id: string) => {
    setFields((prev) =>
      prev.map((f) => (f.id === id ? { ...f, status: 'deleted' as const } : f))
    )
  }, [])

  const discardChanges = useCallback(() => {
    setFields((prev) =>
      prev
        .filter((f) => f.status !== 'new')
        .map((f) => (f.status === 'deleted' || f.status === 'modified' ? { ...f, status: 'existing' as const } : f))
    )
  }, [])

  // ─── Computed ───
  const pendingChanges = useMemo(() => fields.filter((f) => f.status !== 'existing'), [fields])
  const visibleFields = useMemo(() => fields.filter((f) => f.status !== 'deleted'), [fields])

  // ─── JSON Schema preview ───
  const [showPreview, setShowPreview] = useState(false)
  const schemaPreview = useMemo(() => {
    const active = fields.filter((f) => f.status !== 'deleted')
    const required = active.filter((f) => f.required).map((f) => f.name)
    const properties: Record<string, Record<string, unknown>> = {}
    for (const f of active) {
      const prop: Record<string, unknown> = { bsonType: f.bsonType }
      if (f.description) prop.description = f.description
      properties[f.name] = prop
    }
    return JSON.stringify({
      bsonType: 'object',
      required: required.length ? required : undefined,
      properties,
    }, null, 2)
  }, [fields])

  const commandPreview = useMemo(() => {
    return `db.runCommand({
  collMod: "${collection}",
  validator: {
    $jsonSchema: ${schemaPreview.split('\n').map((l, i) => i === 0 ? l : '    ' + l).join('\n')}
  },
  validationLevel: "moderate",
  validationAction: "warn"
})`
  }, [collection, schemaPreview])

  // ─── Apply ───
  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState('')

  const handleApply = useCallback(async () => {
    setApplying(true)
    setApplyError('')
    try {
      const active = fields.filter((f) => f.status !== 'deleted')
      const required = active.filter((f) => f.required).map((f) => f.name)
      const properties: Record<string, Record<string, unknown>> = {}
      for (const f of active) {
        const prop: Record<string, unknown> = { bsonType: f.bsonType }
        if (f.description) prop.description = f.description
        properties[f.name] = prop
      }

      const schema: Record<string, unknown> = {
        bsonType: 'object',
        properties,
      }
      if (required.length) schema.required = required

      await setValidatorMutation.mutateAsync({
        connectionId,
        database,
        collection,
        schema,
      })

      // Mark all as existing
      setFields((prev) =>
        prev
          .filter((f) => f.status !== 'deleted')
          .map((f) => ({ ...f, status: 'existing' as const, originalName: f.name }))
      )
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : String(err))
    } finally {
      setApplying(false)
    }
  }, [fields, connectionId, database, collection, setValidatorMutation])

  // ─── Escape to close ───
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
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-[1000px] max-h-[85vh] bg-bg-card rounded-xl border border-border-subtle flex flex-col overflow-hidden animate-fade-in-up mx-4">
        {/* Header */}
        <div className="px-6 py-5 border-b border-border-subtle flex items-center justify-between bg-bg-card z-10 shrink-0">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-text-muted">schema</span>
              <h1 className="text-xl font-bold text-text-main font-display tracking-tight">{collection}</h1>
              <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-emerald-500/15 text-emerald-400">
                mongodb
              </span>
            </div>
            <p className="text-sm text-text-muted pl-9">
              Define JSON Schema validation rules for this collection.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowPreview(!showPreview)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-bg-hover hover:bg-border-subtle text-text-main text-sm font-medium transition-all"
            >
              <span className="material-symbols-outlined text-[18px]">code</span>
              Preview
            </button>
            <button
              onClick={addField}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary hover:bg-primary-hover text-white text-sm font-bold transition-all"
            >
              <span className="material-symbols-outlined text-[18px]">add</span>
              Add Field
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-text-muted hover:text-text-main hover:bg-bg-hover transition-colors ml-1"
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto bg-bg-card/50">
          {/* Command Preview */}
          {showPreview && (
            <div className="mx-6 mt-4 bg-bg-editor rounded-lg border border-border-subtle overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border-subtle/50 flex items-center justify-between">
                <span className="text-xs font-semibold text-text-main">MongoDB Command Preview</span>
                <button onClick={() => setShowPreview(false)} className="text-text-muted hover:text-text-main">
                  <span className="material-symbols-outlined text-[16px]">close</span>
                </button>
              </div>
              <pre className="p-4 text-[13px] font-mono text-emerald-400 overflow-x-auto whitespace-pre-wrap">{commandPreview}</pre>
            </div>
          )}

          {/* Grid Header */}
          <div className="grid grid-cols-12 gap-4 px-6 py-3 border-b border-border-subtle bg-bg-card sticky top-0 z-10 text-xs font-semibold text-text-muted uppercase tracking-wider">
            <div className="col-span-1 text-center">Order</div>
            <div className="col-span-3">Field Name</div>
            <div className="col-span-2">BSON Type</div>
            <div className="col-span-1 text-center">Required</div>
            <div className="col-span-4">Description</div>
            <div className="col-span-1 text-right">Actions</div>
          </div>

          {/* Sortable Rows */}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={visibleFields.map((f) => f.id)} strategy={verticalListSortingStrategy}>
              <div className="divide-y divide-border-subtle/50">
                {visibleFields.map((field) => (
                  <SortableFieldRow
                    key={field.id}
                    field={field}
                    onUpdate={(updates) => updateField(field.id, updates)}
                    onRemove={() => removeField(field.id)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>

          {/* Add Row Ghost */}
          <button
            onClick={addField}
            className="grid grid-cols-12 gap-4 px-6 py-3 items-center hover:bg-bg-hover/20 transition-colors group w-full text-left"
          >
            <div className="col-span-1" />
            <div className="col-span-11 flex items-center gap-2 text-text-muted group-hover:text-primary transition-colors">
              <span className="material-symbols-outlined text-[18px]">add</span>
              <span className="text-sm font-mono">Add new field...</span>
            </div>
          </button>
        </div>

        {/* Error */}
        {applyError && (
          <div className="px-6 py-3 bg-red-500/10 border-t border-red-500/30 text-red-400 text-sm">
            <span className="font-semibold">Error:</span> {applyError}
          </div>
        )}

        {/* Pending Changes Footer */}
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
                <p className="text-xs text-text-muted">Review changes before applying validator.</p>
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
                onClick={handleApply}
                disabled={applying}
                className="flex items-center gap-2 px-5 py-2 rounded-lg bg-primary hover:bg-primary-hover text-white text-sm font-bold transition-all active:scale-95 disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[18px]">
                  {applying ? 'hourglass_top' : 'check'}
                </span>
                {applying ? 'Applying...' : 'Apply Validator'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Sortable Field Row ───
function SortableFieldRow({ field, onUpdate, onRemove }: {
  field: MongoFieldDef
  onUpdate: (updates: Partial<MongoFieldDef>) => void
  onRemove: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.id })
  const [typeOpen, setTypeOpen] = useState(false)
  const [typeSearch, setTypeSearch] = useState('')

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : undefined,
  }

  const filteredTypes = useMemo(
    () => (typeSearch ? BSON_TYPES.filter((t) => t.includes(typeSearch.toLowerCase())) : BSON_TYPES),
    [typeSearch]
  )

  const statusBorder =
    field.status === 'new'
      ? 'border-l-2 border-l-emerald-500 bg-emerald-500/5'
      : field.status === 'modified'
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

      {/* Field Name */}
      <div className="col-span-3">
        <div className="flex items-center gap-2">
          {field.name === '_id' ? (
            <span className="material-symbols-outlined text-[16px] text-amber-400">key</span>
          ) : (
            <div className="w-4" />
          )}
          <input
            className="bg-transparent border-none p-0 text-text-main font-mono text-sm focus:ring-0 w-full hover:text-primary transition-colors cursor-text outline-none"
            type="text"
            value={field.name}
            onChange={(e) => onUpdate({ name: e.target.value })}
          />
        </div>
      </div>

      {/* BSON Type Dropdown */}
      <div className="col-span-2 relative">
        <button
          onClick={() => setTypeOpen(!typeOpen)}
          className="flex items-center justify-between w-full px-3 py-1.5 rounded bg-bg-hover/50 hover:bg-bg-hover border border-transparent hover:border-border-subtle text-emerald-400 font-mono text-xs transition-all"
        >
          <span>{field.bsonType}</span>
          <span className="material-symbols-outlined text-[16px] text-text-muted">expand_more</span>
        </button>

        {typeOpen && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setTypeOpen(false)} />
            <div className="absolute top-0 left-0 w-full z-40 bg-bg-hover border border-primary rounded-lg overflow-hidden animate-fade-in">
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
              <div className="max-h-[160px] overflow-y-auto">
                {filteredTypes.map((t) => (
                  <button
                    key={t}
                    onClick={() => {
                      onUpdate({ bsonType: t })
                      setTypeOpen(false)
                      setTypeSearch('')
                    }}
                    className={`w-full px-3 py-2 text-xs font-mono text-left flex justify-between items-center transition-colors ${
                      t === field.bsonType ? 'text-text-main bg-primary/20' : 'text-text-muted hover:text-text-main hover:bg-bg-card/50'
                    }`}
                  >
                    <span>{t}</span>
                    {t === field.bsonType && <span className="material-symbols-outlined text-[14px]">check</span>}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Required Toggle */}
      <div className="col-span-1 flex justify-center">
        <button
          onClick={() => onUpdate({ required: !field.required })}
          title="Required"
          className={`h-6 px-2 rounded-full text-[10px] font-bold tracking-wide transition-all ${
            field.required
              ? 'bg-amber-500 text-white'
              : 'border border-border-subtle text-text-muted hover:border-text-muted/50 hover:text-text-main'
          }`}
        >
          REQ
        </button>
      </div>

      {/* Description */}
      <div className="col-span-4">
        <input
          className="bg-transparent border-none p-0 text-text-muted font-mono text-xs focus:ring-0 w-full hover:text-text-main transition-colors cursor-text outline-none placeholder:text-text-muted/30"
          type="text"
          placeholder="Field description..."
          value={field.description}
          onChange={(e) => onUpdate({ description: e.target.value })}
        />
      </div>

      {/* Actions */}
      <div className="col-span-1 flex justify-end">
        {field.status === 'new' ? (
          <div className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span className="text-[10px] text-emerald-500 font-medium">New</span>
          </div>
        ) : field.status === 'modified' ? (
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
