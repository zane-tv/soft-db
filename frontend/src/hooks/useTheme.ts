import { useState, useEffect, useCallback } from 'react'

export type ThemeId = 'dark' | 'light' | 'nord' | 'dracula'

export interface ThemeOption {
  id: ThemeId
  label: string
  icon: string
  colors: { bg: string; card: string; primary: string; text: string }
}

export const THEMES: ThemeOption[] = [
  {
    id: 'dark',
    label: 'Dark',
    icon: 'dark_mode',
    colors: { bg: '#18181B', card: '#27272A', primary: '#3c83f6', text: '#F4F4F5' },
  },
  {
    id: 'light',
    label: 'Light',
    icon: 'light_mode',
    colors: { bg: '#F8FAFC', card: '#FFFFFF', primary: '#3c83f6', text: '#1E293B' },
  },
  {
    id: 'nord',
    label: 'Nord',
    icon: 'ac_unit',
    colors: { bg: '#2E3440', card: '#3B4252', primary: '#88C0D0', text: '#ECEFF4' },
  },
  {
    id: 'dracula',
    label: 'Dracula',
    icon: 'nights_stay',
    colors: { bg: '#282A36', card: '#44475A', primary: '#BD93F9', text: '#F8F8F2' },
  },
]

const STORAGE_KEY = 'softdb-theme'

function applyTheme(theme: ThemeId) {
  document.documentElement.setAttribute('data-theme', theme)
}

function getInitialTheme(): ThemeId {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved && THEMES.some((t) => t.id === saved)) {
      return saved as ThemeId
    }
  } catch {
    // localStorage unavailable
  }
  return 'dark'
}

// Apply theme immediately on load (before React hydration)
applyTheme(getInitialTheme())

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeId>(getInitialTheme)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const setTheme = useCallback((newTheme: ThemeId) => {
    setThemeState(newTheme)
    applyTheme(newTheme)
    try {
      localStorage.setItem(STORAGE_KEY, newTheme)
    } catch {
      // localStorage unavailable
    }
  }, [])

  return { theme, setTheme, themes: THEMES }
}
