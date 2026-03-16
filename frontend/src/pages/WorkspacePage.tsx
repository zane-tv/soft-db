import { ConnectionTabBar, type ConnectionTab } from '@/components/ConnectionTabBar'
import { TableExplorer } from '@/pages/TableExplorer'

interface WorkspacePageProps {
  tabs: ConnectionTab[]
  activeTabId: string
  onSelectTab: (tabId: string) => void
  onCloseTab: (tabId: string) => void
  onAddTab: () => void
  onBackToHub: () => void
}

export function WorkspacePage({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onAddTab,
  onBackToHub,
}: WorkspacePageProps) {
  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      <ConnectionTabBar
        tabs={tabs}
        activeId={activeTabId}
        onSelect={onSelectTab}
        onClose={onCloseTab}
        onAdd={onAddTab}
        onBackToHub={onBackToHub}
      />
      <div className="flex-1 overflow-hidden relative">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`absolute inset-0 ${tab.id === activeTabId ? 'z-10 visible' : 'z-0 invisible'}`}
          >
            <TableExplorer
              connectionId={tab.id}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
