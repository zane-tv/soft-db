import { useState, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Events, Dialogs } from '@wailsio/runtime'
import * as ExportService from '../../bindings/soft-db/services/exportservice'
import * as ImportService from '../../bindings/soft-db/services/importservice'
import {
  ConflictStrategy,
  DataExportFormat,
} from '@/lib/export-types'
import type {
  ExportProgress,
  DatabaseExportRequest,
  DatabaseImportRequest,
  WorkspaceImportResult,
} from '@/lib/export-types'
import { connectionKeys } from './useConnections'
import { settingsKeys } from './useSettings'

function getExportDefaults(format: DataExportFormat) {
  switch (format) {
    case DataExportFormat.FormatCSV:
      return { filters: [{ DisplayName: 'CSV Files', Pattern: '*.csv' }], filename: 'export.csv' }
    case DataExportFormat.FormatJSON:
    case DataExportFormat.FormatExtendedJSON:
      return { filters: [{ DisplayName: 'JSON Files', Pattern: '*.json' }], filename: 'export.json' }
    case DataExportFormat.FormatSQLInsert:
    default:
      return { filters: [{ DisplayName: 'SQL Files', Pattern: '*.sql' }], filename: 'export.sql' }
  }
}

export function useExportProgress() {
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [isActive, setIsActive] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const cleanupProgress = Events.On('export:progress' as any, (ev: any) => {
      setProgress(ev.data as ExportProgress)
      setIsActive(true)
    })

    const cleanupComplete = Events.On('export:complete' as any, (ev: any) => {
      setProgress(ev.data as ExportProgress)
      setIsActive(false)
    })

    const cleanupError = Events.On('export:error' as any, (ev: any) => {
      const data = ev.data as { error: string }
      setError(data.error)
      setIsActive(false)
    })

    const cleanupCancelled = Events.On('export:cancelled' as any, () => {
      setIsActive(false)
      setProgress(null)
    })

    return () => {
      cleanupProgress()
      cleanupComplete()
      cleanupError()
      cleanupCancelled()
    }
  }, [])

  return { progress, isActive, error }
}

export function useImportProgress() {
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [isActive, setIsActive] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const cleanupProgress = Events.On('import:progress' as any, (ev: any) => {
      setProgress(ev.data as ExportProgress)
      setIsActive(true)
    })

    const cleanupComplete = Events.On('import:complete' as any, () => {
      setIsActive(false)
    })

    const cleanupError = Events.On('import:error' as any, (ev: any) => {
      const data = ev.data as { error: string }
      setError(data.error)
      setIsActive(false)
    })

    return () => {
      cleanupProgress()
      cleanupComplete()
      cleanupError()
    }
  }, [])

  return { progress, isActive, error }
}

export function useWorkspaceExport() {
  const mutation = useMutation({
    mutationFn: async (passphrase: string) => {
      const path = await Dialogs.SaveFile({
        Title: 'Export Workspace',
        Filters: [
          { DisplayName: 'SoftDB Workspace', Pattern: '*.softdb' },
          { DisplayName: 'JSON Files', Pattern: '*.json' },
        ],
        DefaultFilename: 'workspace.softdb',
      } as any)
      if (!path) throw new Error('Export cancelled')
      await ExportService.ExportWorkspaceToFile(path as string, passphrase)
    },
  })

  return {
    exportWorkspace: mutation.mutateAsync,
    isExporting: mutation.isPending,
  }
}

export function useWorkspaceImport() {
  const qc = useQueryClient()

  const mutation = useMutation({
    mutationFn: async ({
      passphrase,
      strategy,
    }: {
      passphrase: string
      strategy: ConflictStrategy
    }) => {
      const path = await Dialogs.OpenFile({
        Title: 'Import Workspace',
        Filters: [
          { DisplayName: 'SoftDB Workspace', Pattern: '*.softdb;*.json' },
          { DisplayName: 'All Files', Pattern: '*.*' },
        ],
      })
      if (!path) throw new Error('Import cancelled')
      const result = await ImportService.ImportWorkspaceFromFile(
        path as string,
        passphrase,
        strategy
      )
      return result as WorkspaceImportResult
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: connectionKeys.all })
      qc.invalidateQueries({ queryKey: settingsKeys.all })
      qc.invalidateQueries({ queryKey: ['snippets'] })
    },
  })

  return {
    importWorkspace: mutation.mutateAsync,
    isImporting: mutation.isPending,
  }
}

export function useDatabaseExport() {
  const mutation = useMutation({
    mutationFn: async (req: Omit<DatabaseExportRequest, 'filePath'>) => {
      const { filters, filename } = getExportDefaults(req.dataFormat)

      const path = await Dialogs.SaveFile({
        Title: 'Export Database',
        DefaultFilename: filename,
        Filters: [
          ...filters,
          { DisplayName: 'All Files', Pattern: '*.*' },
        ],
      } as any)
      if (!path) throw new Error('Export cancelled')
      await ExportService.ExportDatabase({ ...req, filePath: path as string })
    },
  })

  return {
    exportDatabase: mutation.mutateAsync,
    isExporting: mutation.isPending,
    cancel: ExportService.CancelExport,
  }
}

export function useDatabaseImport() {
  const mutation = useMutation({
    mutationFn: async (req: Omit<DatabaseImportRequest, 'filePath'>) => {
      const path = await Dialogs.OpenFile({
        Title: 'Import Database',
        Filters: [
          { DisplayName: 'SQL Files', Pattern: '*.sql' },
          { DisplayName: 'JSON Files', Pattern: '*.json' },
          { DisplayName: 'CSV Files', Pattern: '*.csv' },
          { DisplayName: 'All Files', Pattern: '*.*' },
        ],
      })
      if (!path) throw new Error('Import cancelled')
      await ImportService.ImportDatabase({ ...req, filePath: path as string })
    },
  })

  return {
    importDatabase: mutation.mutateAsync,
    isImporting: mutation.isPending,
  }
}
