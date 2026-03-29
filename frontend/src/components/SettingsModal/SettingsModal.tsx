import { useState, useRef, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { useTheme, ThemeOption, type ThemeId } from '@/hooks/useTheme'
import { useSettingsContext, type AppSettings } from '@/hooks/useSettings'
import { useTranslation, type Language, type TranslationKey } from '@/lib/i18n'
import { useUpdate } from '@/hooks/useUpdate'
import * as MCPService from '../../../bindings/soft-db/services/mcpservice'
import { MCP } from '@lobehub/icons'

interface SettingsModalProps {
  open: boolean
  onClose: () => void
}

type SectionId = 'general' | 'appearance' | 'editor' | 'execution' | 'connection' | 'data' | 'mcp' | 'about'

function getSections(t: (key: TranslationKey) => string): { id: SectionId; label: string; icon: string }[] {
  return [
    { id: 'general', label: t('settings.general'), icon: 'settings' },
    { id: 'appearance', label: t('settings.appearance'), icon: 'palette' },
    { id: 'editor', label: t('settings.editor'), icon: 'edit_note' },
    { id: 'execution', label: t('settings.execution'), icon: 'bolt' },
    { id: 'connection', label: t('settings.connection'), icon: 'cable' },
    { id: 'data', label: t('settings.data'), icon: 'table_chart' },
    { id: 'mcp', label: 'MCP Server', icon: 'developer_mode' },
    { id: 'about', label: t('settings.about'), icon: 'info' },
  ]
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const overlayRef = useRef<HTMLButtonElement>(null)
  const modalRef = useRef<HTMLDivElement>(null)
  const [activeSection, setActiveSection] = useState<SectionId>('general')
  const { settings, updateSetting } = useSettingsContext()
  const { theme, setTheme, themes } = useTheme()
  const { t } = useTranslation((settings.language as Language) || 'en')
  const { version } = useUpdate()
  const sections = getSections(t)

  useFocusTrap(modalRef, open, onClose)

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true" aria-labelledby="settings-modal-title">
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close settings"
        ref={overlayRef}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
        style={{ animationDuration: '0.2s' }}
        onClick={onClose}
      />

      {/* Modal */}
      <div
        ref={modalRef}
        className="relative w-full max-w-[720px] h-[560px] bg-bg-card rounded-2xl border border-border-subtle flex overflow-hidden animate-fade-in-up"
        style={{ animationDuration: '0.3s' }}
      >
        {/* Sidebar */}
        <div className="w-[200px] bg-bg-app border-r border-border-subtle/50 flex flex-col shrink-0">
          <div className="px-5 pt-5 pb-4">
            <h2 id="settings-modal-title" className="text-lg font-bold text-text-main">{t('settings.title')}</h2>
            <p className="text-xs text-text-muted mt-0.5">SoftDB</p>
          </div>
          <nav className="flex-1 px-2 pb-4 space-y-0.5 overflow-y-auto">
            {sections.map((s) => (
              <button
                key={s.id}
                type="button"
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
              {sections.find((s) => s.id === activeSection)?.label}
            </h3>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close settings"
              className="text-text-muted hover:text-text-main p-1.5 rounded-lg hover:bg-white/5 transition-colors duration-200"
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>

          {/* Content Body */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            {activeSection === 'general' && (
              <GeneralSection settings={settings} updateSetting={updateSetting} t={t} />
            )}
            {activeSection === 'appearance' && (
              <AppearanceSection
                settings={settings}
                updateSetting={updateSetting}
                theme={theme}
                setTheme={setTheme}
                themes={themes}
                t={t}
              />
            )}
            {activeSection === 'editor' && (
              <EditorSection settings={settings} updateSetting={updateSetting} t={t} />
            )}
            {activeSection === 'execution' && (
              <ExecutionSection settings={settings} updateSetting={updateSetting} t={t} />
            )}
            {activeSection === 'connection' && (
              <ConnectionSection settings={settings} updateSetting={updateSetting} t={t} />
            )}
            {activeSection === 'data' && (
              <DataSection settings={settings} updateSetting={updateSetting} t={t} />
            )}
            {activeSection === 'mcp' && (
              <MCPSection settings={settings} updateSetting={updateSetting} t={t} />
            )}
            {activeSection === 'about' && (
              <AboutSection t={t} version={version} />
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-3.5 border-t border-border-subtle/50 flex items-center justify-end shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="flex items-center gap-2 px-5 py-2 rounded-lg bg-primary hover:bg-primary-hover text-white text-sm font-semibold transition-all duration-200 active:scale-[0.97]"
            >
              {t('settings.done')}
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
  t: (key: TranslationKey) => string
}

function SettingRow({
  icon,
  label,
  description,
  children,
}: {
  icon: string | React.ReactNode
  label: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-border-subtle/20 last:border-0">
      <div className="flex items-start gap-3 flex-1 min-w-0">
        {typeof icon === 'string' ? (
          <span className="material-symbols-outlined text-[18px] text-text-muted mt-0.5 shrink-0">{icon}</span>
        ) : (
          <span className="text-text-muted mt-0.5 shrink-0 flex items-center">{icon}</span>
        )}
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
          const raw = e.target.value
          if (raw === '') {
            onChange(min ?? 0)
          } else {
            const n = parseInt(raw, 10)
            if (!isNaN(n)) onChange(n)
          }
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
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23a1a1aa' d='M3 5l3 3 3-3z'/%3E%3C/svg%3E")`,
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

function GeneralSection({ settings, updateSetting, t }: SectionProps) {
  return (
    <>
      <SettingRow icon="translate" label={t('settings.language')} description={t('settings.language.desc')}>
        <div className="flex gap-1.5">
          {[
            { id: 'en' as const, flag: '🇺🇸', label: 'English' },
            { id: 'vi' as const, flag: '🇻🇳', label: 'Tiếng Việt' },
          ].map((lang) => (
            <button
              key={lang.id}
              type="button"
              onClick={() => updateSetting('language', lang.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 border ${
                settings.language === lang.id
                  ? 'border-primary/50 bg-primary/10 text-primary'
                  : 'border-border-subtle bg-bg-app text-text-muted hover:text-text-main hover:bg-bg-hover/50'
              }`}
            >
              <span className="text-base">{lang.flag}</span>
              {lang.label}
            </button>
          ))}
        </div>
      </SettingRow>
      <SettingRow icon="link" label={t('settings.autoConnect')} description={t('settings.autoConnect.desc')}>
        <Toggle checked={settings.autoConnect} onChange={(v) => updateSetting('autoConnect', v)} />
      </SettingRow>
      <SettingRow icon="warning" label={t('settings.confirmDangerous')} description={t('settings.confirmDangerous.desc')}>
        <Toggle checked={settings.confirmDangerous} onChange={(v) => updateSetting('confirmDangerous', v)} />
      </SettingRow>
      <SettingRow icon="history" label={t('settings.maxHistory')} description={t('settings.maxHistory.desc')}>
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
  t: _t,
}: SectionProps & { theme: string; setTheme: (t: ThemeId) => void; themes: ThemeOption[] }) {
  return (
    <>
      {/* Theme Grid */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <span className="material-symbols-outlined text-[16px] text-text-muted">palette</span>
          <span className="text-sm font-medium text-text-main">{_t('settings.theme')}</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {themes.map((t) => (
            <ThemeCard key={t.id} theme={t} isActive={theme === t.id} onClick={() => setTheme(t.id)} />
          ))}
        </div>
      </div>

      <div className="h-px bg-border-subtle/30" />

      <SettingRow icon="format_size" label={_t('settings.fontSize')} description={_t('settings.fontSize.desc')}>
        <NumberInput value={settings.fontSize} onChange={(v) => updateSetting('fontSize', v)} min={10} max={24} suffix="px" />
      </SettingRow>
      <SettingRow icon="density_medium" label={_t('settings.rowDensity')} description={_t('settings.rowDensity.desc')}>
        <SelectInput
          value={settings.rowDensity}
          onChange={(v) => updateSetting('rowDensity', v)}
          options={[
            { value: 'compact', label: _t('settings.rowDensity.compact') },
            { value: 'normal', label: 'Normal' },
            { value: 'comfortable', label: _t('settings.rowDensity.comfortable') },
          ]}
        />
      </SettingRow>
    </>
  )
}

function EditorSection({ settings, updateSetting, t }: SectionProps) {
  return (
    <>
      <SettingRow icon="tab" label={t('settings.tabSize')} description={t('settings.tabSize.desc')}>
        <SelectInput
          value={String(settings.tabSize)}
          onChange={(v) => updateSetting('tabSize', parseInt(v, 10))}
          options={[
            { value: '2', label: '2' },
            { value: '4', label: '4' },
          ]}
        />
      </SettingRow>
      <SettingRow icon="wrap_text" label={t('settings.wordWrap')} description={t('settings.wordWrap.desc')}>
        <Toggle checked={settings.wordWrap} onChange={(v) => updateSetting('wordWrap', v)} />
      </SettingRow>
      <SettingRow icon="format_list_numbered" label={t('settings.lineNumbers')} description={t('settings.lineNumbers.desc')}>
        <Toggle checked={settings.lineNumbers} onChange={(v) => updateSetting('lineNumbers', v)} />
      </SettingRow>
      <SettingRow icon="text_fields" label={t('settings.autoUppercase')} description={t('settings.autoUppercase.desc')}>
        <Toggle checked={settings.autoUppercase} onChange={(v) => updateSetting('autoUppercase', v)} />
      </SettingRow>
    </>
  )
}

function ExecutionSection({ settings, updateSetting, t }: SectionProps) {
  return (
    <>
      <SettingRow icon="timer" label={t('settings.queryTimeout')} description={t('settings.queryTimeout.desc')}>
        <NumberInput value={settings.queryTimeout} onChange={(v) => updateSetting('queryTimeout', v)} min={5} max={600} suffix="sec" />
      </SettingRow>
      <SettingRow icon="view_list" label={t('settings.defaultLimit')} description={t('settings.defaultLimit.desc')}>
        <NumberInput value={settings.defaultLimit} onChange={(v) => updateSetting('defaultLimit', v)} min={10} max={10000} />
      </SettingRow>
      <SettingRow icon="edit_off" label={t('settings.confirmMutations')} description={t('settings.confirmMutations.desc')}>
        <Toggle checked={settings.confirmMutations} onChange={(v) => updateSetting('confirmMutations', v)} />
      </SettingRow>
      <SettingRow icon="priority_high" label={t('settings.warnQueryRisks')} description={t('settings.warnQueryRisks.desc')}>
        <Toggle checked={settings.warnQueryRisks} onChange={(v) => updateSetting('warnQueryRisks', v)} />
      </SettingRow>
      <SettingRow icon="rule" label={t('settings.warnLimitedQueryAnalysis')} description={t('settings.warnLimitedQueryAnalysis.desc')}>
        <Toggle checked={settings.warnLimitedQueryAnalysis} onChange={(v) => updateSetting('warnLimitedQueryAnalysis', v)} />
      </SettingRow>
      <SettingRow icon="playlist_add" label={t('settings.autoLimit')} description={t('settings.autoLimit.desc')}>
        <Toggle checked={settings.autoLimit} onChange={(v) => updateSetting('autoLimit', v)} />
      </SettingRow>
      <SettingRow icon="search_insights" label={t('settings.explainAvailability')} description={t('settings.explainAvailability.desc')}>
        <span className="text-[11px] font-semibold text-amber-300 px-2 py-1 rounded-md border border-amber-500/30 bg-amber-500/10">
          SQL only
        </span>
      </SettingRow>
      <SettingRow icon="build" label={t('settings.structureLimitations')} description={t('settings.structureLimitations.desc')}>
        <span className="text-[11px] font-semibold text-text-muted px-2 py-1 rounded-md border border-border-subtle/60 bg-bg-app">
          v1 limits
        </span>
      </SettingRow>
    </>
  )
}

function ConnectionSection({ settings, updateSetting, t }: SectionProps) {
  return (
    <>
      <SettingRow icon="schedule" label={t('settings.connectionTimeout')} description={t('settings.connectionTimeout.desc')}>
        <NumberInput value={settings.connectionTimeout} onChange={(v) => updateSetting('connectionTimeout', v)} min={3} max={120} suffix="sec" />
      </SettingRow>
    </>
  )
}

function DataSection({ settings, updateSetting, t }: SectionProps) {
  return (
    <>
      <SettingRow icon="block" label={t('settings.nullDisplay')} description={t('settings.nullDisplay.desc')}>
        <SelectInput
          value={settings.nullDisplay}
          onChange={(v) => updateSetting('nullDisplay', v)}
          options={[
            { value: 'badge', label: t('settings.nullDisplay.badge') },
            { value: 'italic', label: t('settings.nullDisplay.italic') },
            { value: 'dash', label: t('settings.nullDisplay.dash') + ' (—)' },
          ]}
        />
      </SettingRow>
      <SettingRow icon="calendar_month" label={t('settings.dateFormat')} description={t('settings.dateFormat.desc')}>
        <SelectInput
          value={settings.dateFormat}
          onChange={(v) => updateSetting('dateFormat', v)}
          options={[
            { value: 'iso', label: 'ISO 8601' },
            { value: 'us', label: 'US (MM/DD/YYYY)' },
            { value: 'eu', label: 'EU (DD/MM/YYYY)' },
            { value: 'relative', label: 'Relative' },
          ]}
        />
      </SettingRow>
      <SettingRow icon="download" label={t('settings.exportFormat')} description={t('settings.exportFormat.desc')}>
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
      <SettingRow icon="view_column" label={t('settings.csvDelimiter')} description={t('settings.csvDelimiter.desc')}>
        <TextInput value={settings.csvDelimiter} onChange={(v) => updateSetting('csvDelimiter', v)} maxLength={1} />
      </SettingRow>
    </>
  )
}

// ─── About Section ───

const SHORTCUTS = [
  { keys: 'Ctrl/Cmd + E', action: 'about.shortcut.execute' as const },
  { keys: 'Ctrl/Cmd + Shift + E', action: 'about.shortcut.explain' as const },
  { keys: 'Ctrl/Cmd + Shift + O', action: 'about.shortcut.optimize' as const },
  { keys: 'Ctrl/Cmd + S', action: 'about.shortcut.save' as const },
]

const DATABASES = [
  { name: 'PostgreSQL', color: '#4169E1' },
  { name: 'MySQL', color: '#4479A1' },
  { name: 'MariaDB', color: '#003545' },
  { name: 'SQLite', color: '#003B57' },
  { name: 'MongoDB', color: '#47A248' },
  { name: 'Redshift', color: '#8C4FFF' },
]

function AboutSection({ t, version }: { t: (key: TranslationKey) => string; version: string }) {
  return (
    <div className="space-y-6">
      {/* App Info */}
      <div className="text-center py-4">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 mb-3">
          <img src="/softdb-logo.png" alt="SoftDB" className="size-10 rounded-lg" />
        </div>
        <h3 className="text-xl font-bold text-text-main">SoftDB</h3>
        <p className="text-xs text-text-muted mt-1">{t('about.version')} {version}</p>
        <p className="text-sm text-text-muted mt-2 max-w-sm mx-auto">{t('about.description')}</p>
      </div>

      {/* Databases */}
      <div>
        <h4 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-3">{t('about.databases')}</h4>
        <div className="flex flex-wrap gap-2">
          {DATABASES.map((db) => (
            <span
              key={db.name}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-bg-app border border-border-subtle/50 text-text-main"
            >
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: db.color }} />
              {db.name}
            </span>
          ))}
        </div>
      </div>

      {/* Keyboard Shortcuts */}
      <div>
        <h4 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-3">{t('about.shortcuts')}</h4>
        <div className="bg-bg-app rounded-xl border border-border-subtle/50 overflow-hidden">
          {SHORTCUTS.map((s, i) => (
            <div
              key={s.keys}
              className={`flex items-center justify-between px-4 py-2.5 ${
                i < SHORTCUTS.length - 1 ? 'border-b border-border-subtle/20' : ''
              }`}
            >
              <span className="text-sm text-text-muted">{t(s.action)}</span>
              <kbd className="px-2 py-0.5 rounded-md bg-bg-card border border-border-subtle text-xs font-mono text-text-main">
                {s.keys}
              </kbd>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h4 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-3">{t('about.notes')}</h4>
        <div className="bg-bg-app rounded-xl border border-border-subtle/50 p-4 space-y-2">
          <p className="text-xs text-text-muted">• {t('about.note.explainMongo')}</p>
          <p className="text-xs text-text-muted">• {t('about.note.structureLimits')}</p>
          <p className="text-xs text-text-muted">• {t('about.note.structureUnsupported')}</p>
          <p className="text-xs text-text-muted">• {t('about.note.snippetSave')}</p>
        </div>
      </div>

      {/* Credits */}
      <div className="text-center pt-2 space-y-1">
        <p className="text-xs text-text-muted/60">{t('about.license')}</p>
        <div className="flex items-center justify-center gap-3">
          <a
            href="https://softdb.site"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary-hover transition-colors"
          >
            <span className="material-symbols-outlined text-[14px]">menu_book</span>
            Docs
          </a>
          <span className="text-text-muted/30">·</span>
          <a
            href="https://github.com/zane-tv/soft-db"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary-hover transition-colors"
          >
            <span className="material-symbols-outlined text-[14px]">open_in_new</span>
            GitHub
          </a>
        </div>
      </div>
    </div>
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
      type="button"
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
        {Object.entries(theme.colors).map(([name, color]) => (
          <div
            key={name}
            className="size-3 rounded-full border border-white/10"
            style={{ backgroundColor: color }}
          />
        ))}
      </div>
    </button>
  )
}

function MCPSection({ settings, updateSetting }: SectionProps) {
  const { data: status, refetch } = useQuery({
    queryKey: ['mcp', 'status'],
    queryFn: () => MCPService.GetStatus(),
    refetchInterval: 2000,
  })

  const handleToggle = useCallback(async (enabled: boolean) => {
    updateSetting('mcpEnabled', enabled)
    try {
      if (enabled) {
        await MCPService.StartServer()
      } else {
        await MCPService.StopServer()
      }
    } catch {
      updateSetting('mcpEnabled', !enabled)
    }
    refetch()
  }, [updateSetting, refetch])

  const port = settings.mcpPort || 9090
  const running = status?.running ?? false
  const configSnippet = JSON.stringify({ mcpServers: { softdb: { url: `http://localhost:${port}/mcp` } } }, null, 2)

  const copySnippet = useCallback(() => {
    navigator.clipboard.writeText(configSnippet).catch(() => {})
  }, [configSnippet])

  return (
    <>
      <SettingRow
        icon={<MCP size={18} />}
        label="Enable MCP Server"
        description="Allow AI agents (Claude, Cursor) to connect to your databases via MCP protocol"
      >
        <Toggle checked={settings.mcpEnabled ?? false} onChange={handleToggle} />
      </SettingRow>

      <SettingRow
        icon="lan"
        label="Server Port"
        description="HTTP port for the MCP server (requires restart to take effect)"
      >
        <NumberInput
          value={port}
          onChange={(v) => updateSetting('mcpPort', v)}
          min={1024}
          max={65535}
        />
      </SettingRow>

      <div className="py-3 border-b border-border-subtle/20">
        <div className="flex items-center gap-2 mb-2">
          <span className="material-symbols-outlined text-[18px] text-text-muted">circle</span>
          <span className="text-sm font-medium text-text-main">Status</span>
          <span className={`flex items-center gap-1.5 text-xs font-medium ${running ? 'text-emerald-500' : 'text-text-muted'}`}>
            {running ? (
              <>
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Running on port {status?.port ?? port}
              </>
            ) : (
              <>
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-text-muted/40" />
                Stopped
              </>
            )}
          </span>
        </div>
      </div>

      {running && (
        <div className="py-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-text-muted uppercase tracking-wider">Claude / Cursor Config</span>
            <button
              type="button"
              onClick={copySnippet}
              className="flex items-center gap-1 text-xs text-text-muted hover:text-text-main transition-colors"
            >
              <span className="material-symbols-outlined text-[14px]">content_copy</span>
              Copy
            </button>
          </div>
          <pre className="bg-bg-app border border-border-subtle rounded-lg p-3 text-xs text-text-muted font-mono overflow-x-auto">
            {configSnippet}
          </pre>
        </div>
      )}
    </>
  )
}
