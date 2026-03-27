import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createContext, useContext, useEffect, type ReactNode } from 'react'
import * as SettingsService from '../../bindings/soft-db/services/settingsservice'
import { AppSettings } from '../../bindings/soft-db/services/models'

export type { AppSettings }

export const settingsKeys = {
  all: ['settings'] as const,
}

const DEFAULT_SETTINGS = new AppSettings({
  language: 'en',
  autoConnect: false,
  confirmDangerous: true,
  maxHistory: 500,
  theme: 'dark',
  fontSize: 13,
  rowDensity: 'normal',
  tabSize: 2,
  wordWrap: false,
  lineNumbers: true,
  autoUppercase: false,
  queryTimeout: 30,
  defaultLimit: 100,
  confirmMutations: false,
  autoLimit: false,
  warnQueryRisks: true,
  warnLimitedQueryAnalysis: true,
  connectionTimeout: 15,
  nullDisplay: 'badge',
  dateFormat: 'iso',
  exportFormat: 'csv',
  csvDelimiter: ',',
})

export function useSettings() {
  return useQuery({
    queryKey: settingsKeys.all,
    queryFn: () => SettingsService.GetSettings(),
    staleTime: Infinity,
    retry: false,
  })
}

export function useUpdateSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (settings: AppSettings) => SettingsService.UpdateSettings(settings),
    onMutate: async (newSettings) => {
      // Optimistic update
      await qc.cancelQueries({ queryKey: settingsKeys.all })
      const previous = qc.getQueryData<AppSettings>(settingsKeys.all)
      qc.setQueryData(settingsKeys.all, newSettings)
      return { previous }
    },
    onError: (_err, _newSettings, context) => {
      if (context?.previous) {
        qc.setQueryData(settingsKeys.all, context.previous)
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: settingsKeys.all })
    },
  })
}

// ─── Settings Context (avoid prop-drilling) ───

interface SettingsContextValue {
  settings: AppSettings
  updateSettings: (settings: AppSettings) => void
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { data: settings } = useSettings()
  const mutation = useUpdateSettings()

  const current = settings ?? DEFAULT_SETTINGS

  const updateSettings = (s: AppSettings) => mutation.mutate(s)

  const updateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    mutation.mutate({ ...current, [key]: value })
  }

  // Sync <html lang> attribute for CSS font switching
  useEffect(() => {
    document.documentElement.lang = current.language || 'en'
  }, [current.language])

  return (
    <SettingsContext.Provider value={{ settings: current, updateSettings, updateSetting }}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettingsContext() {
  const ctx = useContext(SettingsContext)
  if (!ctx) {
    throw new Error('useSettingsContext must be used within SettingsProvider')
  }
  return ctx
}
