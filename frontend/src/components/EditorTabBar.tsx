interface QueryTab {
  id: string
  title: string
  query: string
  isFullView?: boolean
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
  onAIToggle?: () => void
  aiPanelOpen?: boolean
  onERDiagramToggle?: () => void
  erDiagramOpen?: boolean
  onQueryBuilderToggle?: () => void
  queryBuilderOpen?: boolean
  onCompareToggle?: () => void
  compareOpen?: boolean
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
  onAIToggle,
  aiPanelOpen,
  onERDiagramToggle,
  erDiagramOpen,
  onQueryBuilderToggle,
  queryBuilderOpen,
  onCompareToggle,
  compareOpen,
}: EditorTabBarProps) {
  return (
    <div className="h-9 flex items-center border-b border-border-subtle/20 bg-bg-editor shrink-0">
      {/* Tabs area */}
      <div className="flex items-center gap-0 overflow-x-auto flex-1">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabSelect(tab.id)}
              className={`px-3.5 h-9 text-[11px] font-medium flex items-center gap-1.5 cursor-pointer transition-all duration-150 shrink-0 relative ${
                isActive
                  ? 'bg-bg-editor text-text-main'
                  : 'bg-bg-app/50 text-text-muted/60 hover:text-text-main hover:bg-bg-hover/20'
              }`}
            >
              {isActive && (
                <div className="absolute bottom-0 left-2 right-2 h-[2px] bg-primary rounded-t" />
              )}
              <span className={`material-symbols-outlined text-[8px] ${isActive ? 'text-primary' : 'opacity-50'}`}>{tab.isFullView ? 'dataset' : 'code'}</span>
              <span>{tab.title}</span>
              {tabs.length > 1 && (
                <button
                  type="button"
                  aria-label="Close tab"
                  onClick={(e) => { e.stopPropagation(); onTabClose(tab.id) }}
                  className="w-4 h-4 flex items-center justify-center text-text-muted/30 hover:text-text-main ml-0.5 rounded-sm hover:bg-bg-hover/50 transition-colors"
                >
                  <span className="material-symbols-outlined text-[8px] leading-none">close</span>
                </button>
              )}
              {!isActive && (
                <div className="absolute right-0 top-2 bottom-2 w-px bg-border-subtle/20" />
              )}
            </button>
          )
        })}
        <button
          type="button"
          aria-label="New query tab"
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
          type="button"
          onClick={onSidebarToggle}
          className="text-text-muted/50 hover:text-text-main transition-colors p-1.5 rounded-md hover:bg-bg-hover/30"
          title={sidebarCollapsed ? 'Show Sidebar' : 'Hide Sidebar'}
          aria-label={sidebarCollapsed ? 'Show Sidebar' : 'Hide Sidebar'}
        >
          <span className="material-symbols-outlined text-[16px]">
            {sidebarCollapsed ? 'left_panel_open' : 'left_panel_close'}
          </span>
        </button>
        <button
          type="button"
          onClick={onHistoryOpen}
          className="text-text-muted/50 hover:text-text-main transition-colors p-1.5 rounded-md hover:bg-bg-hover/30"
          title="Query History"
          aria-label="Query History"
        >
          <span className="material-symbols-outlined text-[16px]">history</span>
        </button>
        {onQueryBuilderToggle && (
          <button
            type="button"
            onClick={onQueryBuilderToggle}
            className={`transition-colors p-1.5 rounded-md hover:bg-bg-hover/30 ${
              queryBuilderOpen ? 'text-primary' : 'text-text-muted/50 hover:text-text-main'
            }`}
            title={queryBuilderOpen ? 'Close Query Builder' : 'Open Query Builder'}
            aria-label={queryBuilderOpen ? 'Close Query Builder' : 'Open Query Builder'}
          >
            <span className="material-symbols-outlined text-[16px]">tune</span>
          </button>
        )}
        {onCompareToggle && (
          <button
            type="button"
            onClick={onCompareToggle}
            className={`transition-colors p-1.5 rounded-md hover:bg-bg-hover/30 ${
              compareOpen ? 'text-primary' : 'text-text-muted/50 hover:text-text-main'
            }`}
            title={compareOpen ? 'Close Schema Compare' : 'Schema Compare'}
            aria-label={compareOpen ? 'Close Schema Compare' : 'Schema Compare'}
          >
            <span className="material-symbols-outlined text-[16px]">compare</span>
          </button>
        )}
        {onERDiagramToggle && (
          <button
            type="button"
            onClick={onERDiagramToggle}
            className={`transition-colors p-1.5 rounded-md hover:bg-bg-hover/30 ${
              erDiagramOpen ? 'text-primary' : 'text-text-muted/50 hover:text-text-main'
            }`}
            title={erDiagramOpen ? 'Close ER Diagram' : 'Open ER Diagram'}
            aria-label={erDiagramOpen ? 'Close ER Diagram' : 'Open ER Diagram'}
          >
            <span className="material-symbols-outlined text-[16px]">schema</span>
          </button>
        )}
        {onAIToggle && (
          <button
            type="button"
            onClick={onAIToggle}
            className={`transition-colors p-1.5 rounded-md hover:bg-bg-hover/30 ${
              aiPanelOpen ? 'text-primary' : 'text-text-muted/50 hover:text-text-main'
            }`}
            title={aiPanelOpen ? 'Close AI Assistant' : 'Open AI Assistant'}
            aria-label={aiPanelOpen ? 'Close AI Assistant' : 'Open AI Assistant'}
          >
            <span className="material-symbols-outlined text-[16px]">auto_awesome</span>
          </button>
        )}
      </div>
    </div>
  )
}
