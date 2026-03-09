import { useState, useRef } from 'react'
import { useTheme, ThemeOption, type ThemeId } from '@/hooks/useTheme'
import { useSettingsContext, type AppSettings } from '@/hooks/useSettings'

interface SettingsModalProps {
  open: boolean
  onClose: () => void
}

type SectionId = 'general' | 'appearance' | 'editor' | 'execution' | 'connection' | 'data'

const SECTIONS: { id: SectionId; label: string; icon: string }[] = [
  { id: 'general', label: 'General', icon: 'settings' },
  { id: 'appearance', label: 'Appearance', icon: 'palette' },
  { id: 'editor', label: 'Editor', icon: 'edit_note' },
  { id: 'execution', label: 'Execution', icon: 'bolt' },
  { id: 'connection', label: 'Connection', icon: 'cable' },
  { id: 'data', label: 'Data & Export', icon: 'table_chart' },
]

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const [activeSection, setActiveSection] = useState<SectionId>('general')
  const { settings, updateSetting } = useSettingsContext()
  const { theme, setTheme, themes } = useTheme()

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        ref={overlayRef}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
        style={{ animationDuration: '0.2s' }}
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className="relative w-full max-w-[720px] h-[560px] bg-bg-card rounded-2xl border border-border-subtle flex overflow-hidden animate-fade-in-up"
        style={{ animationDuration: '0.3s' }}
      >
        {/* Sidebar */}
        <div className="w-[200px] bg-bg-app border-r border-border-subtle/50 flex flex-col shrink-0">
          <div className="px-5 pt-5 pb-4">
            <h2 className="text-lg font-bold text-text-main">Settings</h2>
            <p className="text-xs text-text-muted mt-0.5">Customize your experience.</p>
          </div>
          <nav className="flex-1 px-2 pb-4 space-y-0.5 overflow-y-auto">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                onClick={() => setActiveSection(s.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                  activeSection === s.id
                    ? 'bg-primary/15 text-primary'
                    : 'text-text-muted hover:text-text-main hover:bg-bg-hover/50'
                }`}
              >
                <span className={`material-symbols-outlined text-[18px] ${activeSection === s.id ? 'text-primary' : ''}`}>
                  {s.icon}
                </span>
                {s.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Content Header */}
          <div className="px-6 py-4 border-b border-border-subtle/50 flex items-center justify-between shrink-0">
            <h3 className="text-sm font-bold text-text-main uppercase tracking-wider">
              {SECTIONS.find((s) => s.id === activeSection)?.label}
            </h3>
            <button
              onClick={onClose}
              className="text-text-muted hover:text-text-main p-1.5 rounded-lg hover:bg-white/5 transition-colors duration-200"
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>

          {/* Content Body */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            {activeSection === 'general' && (
              <GeneralSection settings={settings} updateSetting={updateSetting} />
            )}
            {activeSection === 'appearance' && (
              <AppearanceSection
                settings={settings}
                updateSetting={updateSetting}
                theme={theme}
                setTheme={setTheme}
                themes={themes}
              />
            )}
            {activeSection === 'editor' && (
              <EditorSection settings={settings} updateSetting={updateSetting} />
            )}
            {activeSection === 'execution' && (
              <ExecutionSection settings={settings} updateSetting={updateSetting} />
            )}
            {activeSection === 'connection' && (
              <ConnectionSection settings={settings} updateSetting={updateSetting} />
            )}
            {activeSection === 'data' && (
              <DataSection settings={settings} updateSetting={updateSetting} />
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-3.5 border-t border-border-subtle/50 flex items-center justify-end shrink-0">
            <button
              onClick={onClose}
              className="flex items-center gap-2 px-5 py-2 rounded-lg bg-primary hover:bg-primary-hover text-white text-sm font-semibold transition-all duration-200 active:scale-[0.97]"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Shared Components ───

interface SectionProps {
  settings: AppSettings
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void
}

function SettingRow({
  icon,
  label,
  description,
  children,
}: {
  icon: string
  label: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-border-subtle/20 last:border-0">
      <div className="flex items-start gap-3 flex-1 min-w-0">
        <span className="material-symbols-outlined text-[18px] text-text-muted mt-0.5 shrink-0">{icon}</span>
        <div>
          <span className="text-sm font-medium text-text-main">{label}</span>
          {description && <p className="text-xs text-text-muted mt-0.5">{description}</p>}
        </div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ${
        checked ? 'bg-primary' : 'bg-bg-hover'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  )
}

function NumberInput({
  value,
  onChange,
  min,
  max,
  suffix,
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  suffix?: string
}) {
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10)
          if (!isNaN(n)) onChange(n)
        }}
        className="w-20 bg-bg-app border border-border-subtle rounded-lg px-3 py-1.5 text-sm text-text-main text-center outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors"
      />
      {suffix && <span className="text-xs text-text-muted">{suffix}</span>}
    </div>
  )
}

function SelectInput({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-bg-app border border-border-subtle rounded-lg px-3 py-1.5 text-sm text-text-main outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors cursor-pointer appearance-none pr-8"
      style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23888' d='M3 5l3 3 3-3z'/%3E%3C/svg%3E")`,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 8px center',
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}

function TextInput({
  value,
  onChange,
  maxLength,
}: {
  value: string
  onChange: (v: string) => void
  maxLength?: number
}) {
  return (
    <input
      type="text"
      value={value}
      maxLength={maxLength}
      onChange={(e) => onChange(e.target.value)}
      className="w-16 bg-bg-app border border-border-subtle rounded-lg px-3 py-1.5 text-sm text-text-main text-center outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors"
    />
  )
}

// ─── Section Components ───

function GeneralSection({ settings, updateSetting }: SectionProps) {
  return (
    <>
      <SettingRow icon="link" label="Auto-connect on startup" description="Automatically reconnect previously active connections when the app starts.">
        <Toggle checked={settings.autoConnect} onChange={(v) => updateSetting('autoConnect', v)} />
      </SettingRow>
      <SettingRow icon="warning" label="Confirm dangerous queries" description="Show confirmation dialog before executing DROP, TRUNCATE, or ALTER statements.">
        <Toggle checked={settings.confirmDangerous} onChange={(v) => updateSetting('confirmDangerous', v)} />
      </SettingRow>
      <SettingRow icon="history" label="Max history entries" description="Maximum number of queries stored in history per connection.">
        <NumberInput value={settings.maxHistory} onChange={(v) => updateSetting('maxHistory', v)} min={50} max={5000} />
      </SettingRow>
    </>
  )
}

function AppearanceSection({
  settings,
  updateSetting,
  theme,
  setTheme,
  themes,
}: SectionProps & { theme: string; setTheme: (t: ThemeId) => void; themes: ThemeOption[] }) {
  return (
    <>
      {/* Theme Grid */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <span className="material-symbols-outlined text-[16px] text-text-muted">palette</span>
          <span className="text-sm font-medium text-text-main">Theme</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {themes.map((t) => (
            <ThemeCard key={t.id} theme={t} isActive={theme === t.id} onClick={() => setTheme(t.id)} />
          ))}
        </div>
      </div>

      <div className="h-px bg-border-subtle/30" />

      <SettingRow icon="format_size" label="Font size" description="Text size for query editor and results table.">
        <NumberInput value={settings.fontSize} onChange={(v) => updateSetting('fontSize', v)} min={10} max={24} suffix="px" />
      </SettingRow>
      <SettingRow icon="density_medium" label="Row density" description="Spacing between rows in the results table.">
        <SelectInput
          value={settings.rowDensity}
          onChange={(v) => updateSetting('rowDensity', v)}
          options={[
            { value: 'compact', label: 'Compact' },
            { value: 'normal', label: 'Normal' },
            { value: 'comfortable', label: 'Comfortable' },
          ]}
        />
      </SettingRow>
    </>
  )
}

function EditorSection({ settings, updateSetting }: SectionProps) {
  return (
    <>
      <SettingRow icon="tab" label="Tab size" description="Number of spaces per indent level.">
        <SelectInput
          value={String(settings.tabSize)}
          onChange={(v) => updateSetting('tabSize', parseInt(v, 10))}
          options={[
            { value: '2', label: '2 spaces' },
            { value: '4', label: '4 spaces' },
          ]}
        />
      </SettingRow>
      <SettingRow icon="wrap_text" label="Word wrap" description="Wrap long lines in the query editor.">
        <Toggle checked={settings.wordWrap} onChange={(v) => updateSetting('wordWrap', v)} />
      </SettingRow>
      <SettingRow icon="format_list_numbered" label="Line numbers" description="Show line numbers in the query editor.">
        <Toggle checked={settings.lineNumbers} onChange={(v) => updateSetting('lineNumbers', v)} />
      </SettingRow>
      <SettingRow icon="text_fields" label="Auto-uppercase keywords" description="Automatically capitalize SQL keywords (SELECT, FROM, WHERE...).">
        <Toggle checked={settings.autoUppercase} onChange={(v) => updateSetting('autoUppercase', v)} />
      </SettingRow>
    </>
  )
}

function ExecutionSection({ settings, updateSetting }: SectionProps) {
  return (
    <>
      <SettingRow icon="timer" label="Query timeout" description="Maximum time to wait for a query to complete.">
        <NumberInput value={settings.queryTimeout} onChange={(v) => updateSetting('queryTimeout', v)} min={5} max={600} suffix="sec" />
      </SettingRow>
      <SettingRow icon="view_list" label="Default row limit" description="Default LIMIT when clicking a table in the sidebar.">
        <NumberInput value={settings.defaultLimit} onChange={(v) => updateSetting('defaultLimit', v)} min={10} max={10000} />
      </SettingRow>
      <SettingRow icon="edit_off" label="Confirm mutations" description="Show confirmation before executing INSERT, UPDATE, or DELETE.">
        <Toggle checked={settings.confirmMutations} onChange={(v) => updateSetting('confirmMutations', v)} />
      </SettingRow>
      <SettingRow icon="playlist_add" label="Auto-add LIMIT" description="Automatically append LIMIT to SELECT queries that don't have one.">
        <Toggle checked={settings.autoLimit} onChange={(v) => updateSetting('autoLimit', v)} />
      </SettingRow>
    </>
  )
}

function ConnectionSection({ settings, updateSetting }: SectionProps) {
  return (
    <>
      <SettingRow icon="schedule" label="Connection timeout" description="Maximum time to wait when establishing a database connection.">
        <NumberInput value={settings.connectionTimeout} onChange={(v) => updateSetting('connectionTimeout', v)} min={3} max={120} suffix="sec" />
      </SettingRow>
    </>
  )
}

function DataSection({ settings, updateSetting }: SectionProps) {
  return (
    <>
      <SettingRow icon="block" label="NULL display" description="How NULL values appear in the results table.">
        <SelectInput
          value={settings.nullDisplay}
          onChange={(v) => updateSetting('nullDisplay', v)}
          options={[
            { value: 'badge', label: 'Badge' },
            { value: 'italic', label: 'Italic text' },
            { value: 'dash', label: 'Dash (—)' },
          ]}
        />
      </SettingRow>
      <SettingRow icon="calendar_month" label="Date format" description="How date/time values are displayed.">
        <SelectInput
          value={settings.dateFormat}
          onChange={(v) => updateSetting('dateFormat', v)}
          options={[
            { value: 'iso', label: 'ISO 8601' },
            { value: 'us', label: 'US (MM/DD/YYYY)' },
            { value: 'eu', label: 'EU (DD/MM/YYYY)' },
            { value: 'relative', label: 'Relative (2h ago)' },
          ]}
        />
      </SettingRow>
      <SettingRow icon="download" label="Default export format" description="File format when exporting query results.">
        <SelectInput
          value={settings.exportFormat}
          onChange={(v) => updateSetting('exportFormat', v)}
          options={[
            { value: 'csv', label: 'CSV' },
            { value: 'json', label: 'JSON' },
            { value: 'tsv', label: 'TSV' },
          ]}
        />
      </SettingRow>
      <SettingRow icon="view_column" label="CSV delimiter" description="Character used to separate values in CSV exports.">
        <TextInput value={settings.csvDelimiter} onChange={(v) => updateSetting('csvDelimiter', v)} maxLength={1} />
      </SettingRow>
    </>
  )
}

// ─── Theme Card ───

function ThemeCard({
  theme,
  isActive,
  onClick,
}: {
  theme: ThemeOption
  isActive: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`group relative flex flex-col items-start gap-3 p-4 rounded-xl border text-left transition-all duration-200 ${
        isActive
          ? 'border-primary/50 bg-primary/10 ring-2 ring-primary/20'
          : 'border-border-subtle bg-bg-app hover:bg-bg-hover/50 hover:border-border-subtle/80'
      }`}
    >
      {/* Theme Preview */}
      <div className="flex items-center gap-2 w-full">
        {/* Mini preview */}
        <div
          className="size-9 rounded-lg flex items-center justify-center border border-white/10 shrink-0"
          style={{ backgroundColor: theme.colors.bg }}
        >
          <div
            className="size-5 rounded-md"
            style={{ backgroundColor: theme.colors.card }}
          >
            <div
              className="w-3 h-1 rounded-full mt-1.5 mx-auto"
              style={{ backgroundColor: theme.colors.primary }}
            />
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px] text-text-muted">
              {theme.icon}
            </span>
            <span className="text-sm font-semibold text-text-main">{theme.label}</span>
          </div>
        </div>

        {/* Active indicator */}
        {isActive && (
          <span className="material-symbols-outlined text-[18px] text-primary shrink-0">
            check_circle
          </span>
        )}
      </div>

      {/* Color dots */}
      <div className="flex gap-1.5">
        {Object.values(theme.colors).map((color, i) => (
          <div
            key={i}
            className="size-3 rounded-full border border-white/10"
            style={{ backgroundColor: color }}
          />
        ))}
      </div>
    </button>
  )
}
