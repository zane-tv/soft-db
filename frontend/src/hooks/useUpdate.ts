import { useState, useEffect, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Events } from '@wailsio/runtime'
import * as UpdateService from '../../bindings/soft-db/services/updateservice'

export interface DownloadProgress {
  percent: number
  downloaded: number
  total: number
  status: 'downloading' | 'verifying' | 'ready' | 'error'
  error?: string
}

export function useUpdate() {
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null)

  const version = useQuery({
    queryKey: ['app', 'version'],
    queryFn: () => UpdateService.GetAppVersion(),
    staleTime: Infinity,
  })

  const updateCheck = useQuery({
    queryKey: ['app', 'update'],
    queryFn: () => UpdateService.CheckForUpdate(),
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: false,
  })

  const changelog = useQuery({
    queryKey: ['app', 'changelog'],
    queryFn: () => UpdateService.GetChangelog(10),
    enabled: false, // only fetch on demand
  })

  // Listen for download progress events
  useEffect(() => {
    const cleanup = Events.On('update:progress' as any, (ev: any) => {
      const data = ev.data as DownloadProgress
      setDownloadProgress(data)
    })
    return cleanup
  }, [])

  const startDownload = useCallback(async () => {
    setDownloadProgress({ percent: 0, downloaded: 0, total: 0, status: 'downloading' })
    try {
      await UpdateService.DownloadUpdate()
    } catch (e) {
      setDownloadProgress({ percent: 0, downloaded: 0, total: 0, status: 'error', error: String(e) })
    }
  }, [])

  const resetDownload = useCallback(() => {
    setDownloadProgress(null)
  }, [])

  const openReleasePage = useCallback((url: string) => {
    UpdateService.OpenReleasePage(url)
  }, [])

  return {
    version: version.data ?? 'dev',
    hasUpdate: updateCheck.data?.hasUpdate ?? false,
    latestVersion: updateCheck.data?.latestVersion ?? '',
    updateInfo: updateCheck.data,
    changelog,
    downloadProgress,
    startDownload,
    resetDownload,
    openReleasePage,
    isChecking: updateCheck.isLoading,
  }
}
