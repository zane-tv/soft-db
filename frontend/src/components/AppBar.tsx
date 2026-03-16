import { useState, useEffect } from 'react'
import { Window } from '@wailsio/runtime'

export function AppBar() {
  const [isMaximized, setIsMaximized] = useState(false)

  // Track maximize state
  useEffect(() => {
    const checkMaximized = async () => {
      try {
        const maximized = await Window.IsMaximised()
        setIsMaximized(maximized)
      } catch {
        // Not in Wails runtime
      }
    }
    checkMaximized()
    // Listen for resize to update maximize state
    window.addEventListener('resize', checkMaximized)
    return () => window.removeEventListener('resize', checkMaximized)
  }, [])

  const handleMinimize = () => {
    try { Window.Minimise() } catch { /* browser dev */ }
  }

  const handleMaximize = () => {
    try {
      Window.ToggleMaximise()
      setIsMaximized((prev) => !prev)
    } catch { /* browser dev */ }
  }

  const handleClose = () => {
    try { Window.Close() } catch { /* browser dev */ }
  }

  return (
    <div className="app-bar flex items-center justify-between px-3 bg-bg-app border-b border-border-subtle/50 shrink-0 z-50">
      {/* Left: Logo + App Name */}
      <div className="flex items-center gap-2.5 pl-1">
        <img src="/softdb-logo.png" alt="SoftDB" className="size-5 rounded" />
        <span className="text-[13px] font-semibold text-text-main/80 tracking-tight select-none">SoftDB</span>
      </div>

      {/* Right: Window Controls */}
      <div className="flex items-center gap-0.5">
        <button
          onClick={handleMinimize}
          className="app-bar-btn size-8 rounded-md flex items-center justify-center text-text-muted hover:text-text-main hover:bg-bg-hover transition-colors"
          title="Minimize"
        >
          <span className="material-symbols-outlined text-[18px]">horizontal_rule</span>
        </button>
        <button
          onClick={handleMaximize}
          className="app-bar-btn size-8 rounded-md flex items-center justify-center text-text-muted hover:text-text-main hover:bg-bg-hover transition-colors"
          title={isMaximized ? 'Restore' : 'Maximize'}
        >
          <span className="material-symbols-outlined text-[18px]">
            {isMaximized ? 'fullscreen_exit' : 'fullscreen'}
          </span>
        </button>
        <button
          onClick={handleClose}
          className="app-bar-btn size-8 rounded-md flex items-center justify-center text-text-muted hover:text-white hover:bg-red-500 transition-colors"
          title="Close"
        >
          <span className="material-symbols-outlined text-[18px]">close</span>
        </button>
      </div>
    </div>
  )
}
