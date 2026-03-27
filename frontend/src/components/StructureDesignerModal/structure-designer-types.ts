import type { ColumnInfo } from '../../../bindings/soft-db/internal/driver/models'
import type { StructureColumnDefinition } from '@/hooks/useSchema'

// ─── SQL Types ───
export const SQL_TYPES = [
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
export interface ColumnDef {
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
export function newColId() {
  return `col_${Date.now()}_${colIdCounter++}`
}

export function createDefaultNewColumns(): ColumnDef[] {
  return [
    {
      id: newColId(),
      name: 'id',
      type: 'uuid',
      primaryKey: true,
      notNull: true,
      unique: false,
      defaultValue: 'gen_random_uuid()',
      status: 'new',
    },
    {
      id: newColId(),
      name: 'created_at',
      type: 'timestamptz',
      primaryKey: false,
      notNull: true,
      unique: false,
      defaultValue: 'now()',
      status: 'new',
    },
  ]
}

export function mapServerColumnsToDefs(serverColumns: ColumnInfo[]): ColumnDef[] {
  return serverColumns.map((column) => ({
    id: newColId(),
    name: column.name,
    type: column.type,
    primaryKey: column.primaryKey,
    notNull: !column.nullable,
    unique: column.unique,
    defaultValue: column.defaultValue || '',
    status: 'existing' as const,
    originalName: column.name,
  }))
}

export function toStructureColumn(column: ColumnDef): StructureColumnDefinition {
  const defaultValue = column.defaultValue.trim()
  return {
    name: column.name.trim(),
    type: column.type.trim(),
    primaryKey: column.primaryKey,
    notNull: column.notNull,
    unique: column.unique,
    defaultValue: defaultValue.length > 0 ? defaultValue : undefined,
  }
}
