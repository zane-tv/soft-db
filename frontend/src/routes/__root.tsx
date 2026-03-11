import { useState, useCallback } from 'react'
import { createRootRoute } from '@tanstack/react-router'
import { useConnections, useConnect } from '@/hooks/useConnections'
import { ConnectionHub } from '@/pages/ConnectionHub'
import { WorkspacePage } from '@/pages/WorkspacePage'
import { ConnectionPickerModal } from '@/components/ConnectionPickerModal'
import { AppBar } from '@/components/AppBar'
import type { ConnectionTab } from '@/components/ConnectionTabBar'

export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  const { data: connections = [] } = useConnections()
  const connectMutation = useConnect()

  // ─── Workspace state (lives forever in root) ───
  const [activeView, setActiveView] = useState<'hub' | 'workspace'>('hub')
  const [openTabs, setOpenTabs] = useState<ConnectionTab[]>([])
  const [activeTabId, setActiveTabId] = useState('')
  const [showPicker, setShowPicker] = useState(false)

  // ─── Hub → Workspace ───
  const handleConnect = useCallback(async (connectionId: string) => {
    // Auto-connect if not already connected
    const conn = connections.find((c) => c.id === connectionId)
    if (conn && conn.status !== 'connected') {
      try {
        await connectMutation.mutateAsync(connectionId)
      } catch {
        return // Connection failed
      }
    }

    setOpenTabs((prev) => {
      // Already have this tab? Just activate it
      if (prev.some((t) => t.id === connectionId)) {
        setActiveTabId(connectionId)
        return prev
      }
      // Add new tab
      const c = connections.find((c) => c.id === connectionId)
      const newTab: ConnectionTab = {
        id: connectionId,
        name: c?.name || 'Connection',
        type: (c?.type as string) || 'postgresql',
      }
      setActiveTabId(connectionId)
      return [...prev, newTab]
    })
    setActiveView('workspace')
  }, [connections, connectMutation])

  // ─── Workspace → Hub ───
  const handleBackToHub = useCallback(() => {
    setActiveView('hub')
  }, [])

  // ─── Tab management (passed to WorkspacePage) ───
  const handleAddTab = useCallback(() => {
    setShowPicker(true)
  }, [])

  const handleCloseTab = useCallback((tabId: string) => {
    setOpenTabs((prev) => {
      if (prev.length <= 1) {
        setActiveView('hub')
        return []
      }
      const filtered = prev.filter((t) => t.id !== tabId)
      setActiveTabId((currentActive) => {
        if (currentActive === tabId) return filtered[0].id
        return currentActive
      })
      return filtered
    })
  }, [])

  const handleSelectTab = useCallback((tabId: string) => {
    setActiveTabId(tabId)
  }, [])

  // Keep tab names synced with connections data
  const tabsWithNames = openTabs.map((tab) => {
    const conn = connections.find((c) => c.id === tab.id)
    return conn ? { ...tab, name: conn.name, type: conn.type as string } : tab
  })

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Custom Title Bar */}
      <AppBar />

      {/* Hub (shown when activeView === 'hub') */}
      <div className={`flex-1 flex flex-col overflow-hidden ${activeView === 'hub' ? '' : 'hidden'}`}>
        <ConnectionHub onConnect={handleConnect} />
      </div>

      {/* Workspace (shown when activeView === 'workspace', NEVER unmounted once created) */}
      {openTabs.length > 0 && (
        <div className={`flex-1 flex flex-col overflow-hidden ${activeView === 'workspace' ? '' : 'hidden'}`}>
          <WorkspacePage
            tabs={tabsWithNames}
            activeTabId={activeTabId}
            onSelectTab={handleSelectTab}
            onCloseTab={handleCloseTab}
            onAddTab={handleAddTab}
            onBackToHub={handleBackToHub}
          />
        </div>
      )}

      {/* Connection Picker Modal */}
      <ConnectionPickerModal
        open={showPicker}
        onClose={() => setShowPicker(false)}
        onSelect={(connId) => {
          handleConnect(connId)
          setShowPicker(false)
        }}
        openTabIds={openTabs.map((t) => t.id)}
      />
    </div>
  )
}
