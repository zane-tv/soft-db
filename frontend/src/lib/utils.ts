import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Database type brand colors
export const DB_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  mysql: {
    bg: 'bg-[#F29111]/10',
    text: 'text-[#F29111]',
    border: 'border-[#F29111]/20',
  },
  mariadb: {
    bg: 'bg-[#003545]/10',
    text: 'text-[#003545]',
    border: 'border-[#003545]/20',
  },
  postgresql: {
    bg: 'bg-[#336791]/10',
    text: 'text-[#336791]',
    border: 'border-[#336791]/20',
  },
  sqlite: {
    bg: 'bg-[#003B57]/10',
    text: 'text-[#44A8E0]',
    border: 'border-[#44A8E0]/20',
  },
  mongodb: {
    bg: 'bg-[#00684A]/10',
    text: 'text-[#00ED64]',
    border: 'border-[#00ED64]/20',
  },
  redshift: {
    bg: 'bg-[#8C4FFF]/10',
    text: 'text-[#8C4FFF]',
    border: 'border-[#8C4FFF]/20',
  },
}

// Database type icons (Material Symbols)
export const DB_ICONS: Record<string, string> = {
  mysql: 'table_view',
  mariadb: 'table_view',
  postgresql: 'database',
  sqlite: 'storage',
  mongodb: 'data_object',
  redshift: 'cloud',
}

// Database default ports
export const DB_DEFAULT_PORTS: Record<string, number> = {
  mysql: 3306,
  mariadb: 3306,
  postgresql: 5432,
  sqlite: 0,
  mongodb: 27017,
  redshift: 5439,
}

export type DatabaseType = 'mysql' | 'mariadb' | 'postgresql' | 'sqlite' | 'mongodb' | 'redshift'

export interface ConnectionConfig {
  id: string
  name: string
  type: DatabaseType
  host: string
  port: number
  database: string
  username: string
  password: string
  filePath?: string // For SQLite
  status: 'connected' | 'idle' | 'offline'
  lastUsed?: string
}

export interface QueryResult {
  columns: { name: string; type: string }[]
  rows: Record<string, unknown>[]
  rowCount: number
  executionTime: number
  error?: string
}

export interface TableInfo {
  name: string
  type: 'table' | 'view'
  rowCount?: number
}

export interface ColumnInfo {
  name: string
  type: string
  nullable: boolean
  primaryKey: boolean
  unique: boolean
  defaultValue?: string
}
