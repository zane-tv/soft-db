interface QueryTab {
  id: string
  title: string
  query: string
}

interface EditorTabBarProps {
  tabs: QueryTab[]
  activeTabId: string
  sidebarCollapsed: boolean
  onTabSelect: (id: string) => void
  onTabClose: (id: string) => void
  onTabAdd: () => void
  onHistoryOpen: () => void
  onSidebarToggle: () => void
}

export function EditorTabBar({
  tabs,
  activeTabId,
  sidebarCollapsed,
  onTabSelect,
  onTabClose,
  onTabAdd,
  onHistoryOpen,
  onSidebarToggle,
}: EditorTabBarProps) {
  return (
    <div className="h-9 flex items-center border-b border-border-subtle/20 bg-bg-editor shrink-0">
      {/* Tabs area */}
      <div className="flex items-center gap-0 overflow-x-auto flex-1">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId
          return (
            <div
              key={tab.id}
              onClick={() => onTabSelect(tab.id)}
              className={`px-3.5 h-9 text-[11px] font-medium flex items-center gap-1.5 cursor-pointer transition-all duration-150 shrink-0 relative ${
                isActive
                  ? 'bg-bg-editor text-text-main'
                  : 'bg-bg-app/50 text-text-muted/60 hover:text-text-main hover:bg-bg-hover/20'
              }`}
            >
              {/* Active bottom indicator */}
              {isActive && (
                <div className="absolute bottom-0 left-2 right-2 h-[2px] bg-primary rounded-t" />
              )}
              <span className={`material-symbols-outlined text-[13px] ${isActive ? 'text-primary' : 'opacity-50'}`}>code</span>
              <span>{tab.title}</span>
              {tabs.length > 1 && (
                <button
                  onClick={(e) => { e.stopPropagation(); onTabClose(tab.id) }}
                  className="text-text-muted/30 hover:text-text-main ml-0.5 rounded-sm hover:bg-bg-hover/50 transition-colors"
                >
                  <span className="material-symbols-outlined text-[12px]">close</span>
                </button>
              )}
              {/* Separator */}
              {!isActive && (
                <div className="absolute right-0 top-2 bottom-2 w-px bg-border-subtle/20" />
              )}
            </div>
          )
        })}
        <button
          onClick={onTabAdd}
          className="px-3 h-9 text-text-muted/40 hover:text-text-main text-[11px] font-medium flex items-center gap-1.5 hover:bg-bg-hover/20 transition-colors"
        >
          <span className="material-symbols-outlined text-[13px]">add</span>
          New Query
        </button>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-0.5 px-2 shrink-0">
        <button
          onClick={onHistoryOpen}
          className="text-text-muted/50 hover:text-text-main transition-colors p-1.5 rounded-md hover:bg-bg-hover/30"
          title="Query History"
        >
          <span className="material-symbols-outlined text-[16px]">history</span>
        </button>
        <button
          onClick={onSidebarToggle}
          className="text-text-muted/50 hover:text-text-main transition-colors p-1.5 rounded-md hover:bg-bg-hover/30"
          title={sidebarCollapsed ? 'Show Sidebar' : 'Hide Sidebar'}
        >
          <span className="material-symbols-outlined text-[16px]">
            {sidebarCollapsed ? 'left_panel_open' : 'left_panel_close'}
          </span>
        </button>
      </div>
    </div>
  )
}
