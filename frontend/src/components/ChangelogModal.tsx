import DOMPurify from 'dompurify'
import { useState, useEffect, useRef } from 'react'
import { useUpdate } from '@/hooks/useUpdate'
import { useTranslation, Language } from '@/lib/i18n'

interface ChangelogModalProps {
  open: boolean
  onClose: () => void
  lang: Language
}

const MARKDOWN_SANITIZE_OPTIONS = {
  FORBID_ATTR: ['onerror', 'onload'],
  FORBID_TAGS: ['script', 'iframe'],
}

function sanitizeMarkdownHtml(html: string): string {
  return DOMPurify.sanitize(html, MARKDOWN_SANITIZE_OPTIONS)
}

function SanitizedHtml({ className, html }: { className: string; html: string }) {
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.innerHTML = sanitizeMarkdownHtml(html)
    }
  }, [html])

  return <div ref={contentRef} className={className} />
}

export function ChangelogModal({ open, onClose, lang }: ChangelogModalProps) {
  const { t } = useTranslation(lang)
  const { version, hasUpdate, latestVersion, updateInfo, changelog, downloadProgress, startDownload, resetDownload, openReleasePage } = useUpdate()
  const [tab, setTab] = useState<'latest' | 'history'>('latest')

  // Reset download state when modal opens
  useEffect(() => {
    if (open) {
      resetDownload()
    }
  }, [open, resetDownload])

  // Fetch changelog when switching to history tab
  useEffect(() => {
    if (open && tab === 'history') {
      changelog.refetch()
    }
  }, [changelog, open, tab])

  if (!open) return null

  const isDownloading = downloadProgress?.status === 'downloading'
  const isReady = downloadProgress?.status === 'ready'
  const downloadError = downloadProgress?.status === 'error' ? downloadProgress.error : null
  const notes = updateInfo?.releaseNotes?.trim()

  return (
    <>
      <button
        type="button"
        aria-label={t('update.close')}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 animate-fade-in"
        onClick={onClose}
      />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div
          className="glass-panel pointer-events-auto w-full max-w-lg max-h-[80vh] rounded-xl border border-border-subtle flex flex-col animate-fade-in overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle shrink-0">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center size-9 rounded-lg bg-primary/15">
                <span className="material-symbols-outlined text-primary text-[20px]">new_releases</span>
              </div>
              <div>
                <h2 className="font-semibold text-text-main text-base">{t('update.title')}</h2>
                <p className="text-xs text-text-muted">{t('update.currentVersion')}: {version}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex items-center justify-center size-8 rounded-lg text-text-muted hover:text-text-main hover:bg-white/5 transition-all"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-border-subtle shrink-0">
            <button
              type="button"
              onClick={() => setTab('latest')}
              className={`flex-1 py-2.5 text-xs font-medium transition-all ${
                tab === 'latest'
                  ? 'text-primary border-b-2 border-primary'
                  : 'text-text-muted hover:text-text-main'
              }`}
            >
              {hasUpdate ? t('update.newVersion') : t('update.latest')}
            </button>
            <button
              type="button"
              onClick={() => setTab('history')}
              className={`flex-1 py-2.5 text-xs font-medium transition-all ${
                tab === 'history'
                  ? 'text-primary border-b-2 border-primary'
                  : 'text-text-muted hover:text-text-main'
              }`}
            >
              {t('update.history')}
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-5">
            {tab === 'latest' ? (
              <div className="space-y-4">
                {/* Update banner */}
                {hasUpdate && (
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-primary/10 border border-primary/30">
                    <span className="material-symbols-outlined text-primary text-[20px] mt-0.5">upgrade</span>
                    <div>
                      <p className="text-sm font-medium text-text-main">
                        {t('update.available')} {latestVersion}
                      </p>
                      <p className="text-xs text-text-muted mt-0.5">{t('update.availableDesc')}</p>
                    </div>
                  </div>
                )}

                {!hasUpdate && (
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
                    <span className="material-symbols-outlined text-emerald-400 text-[20px] mt-0.5">check_circle</span>
                    <div>
                      <p className="text-sm font-medium text-text-main">{t('update.upToDate')}</p>
                      <p className="text-xs text-text-muted mt-0.5">{t('update.upToDateDesc')} ({version})</p>
                    </div>
                  </div>
                )}

                {/* Release Notes */}
                <div>
                  <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">
                    {t('update.releaseNotes')} — {updateInfo?.latestVersion ?? latestVersion}
                  </h3>
                  {notes ? (
                    <SanitizedHtml
                      className="changelog-md rounded-lg bg-bg-app/50 p-4 border border-border-subtle"
                      html={mdToHtml(notes)}
                    />
                  ) : (
                    <div className="rounded-lg bg-bg-app/50 p-4 border border-border-subtle text-sm text-text-muted italic">
                      {t('update.noChangelog')}
                    </div>
                  )}
                </div>

                {/* Download Progress */}
                {isDownloading && downloadProgress && (
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs text-text-muted">
                      <span>{t('update.downloading')}...</span>
                      <span>{downloadProgress.percent}%</span>
                    </div>
                    <div className="h-1.5 bg-bg-app rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all duration-300"
                        style={{ width: `${downloadProgress.percent}%` }}
                      />
                    </div>
                  </div>
                )}

                {isReady && (
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-sm text-emerald-400">
                    <span className="material-symbols-outlined text-[18px]">download_done</span>
                    {t('update.downloadComplete')}
                  </div>
                )}

                {downloadError && (
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400">
                    <span className="material-symbols-outlined text-[18px]">error</span>
                    {downloadError}
                  </div>
                )}
              </div>
            ) : (
              /* History tab */
              <div className="space-y-4">
                {changelog.isLoading ? (
                  <div className="flex items-center justify-center py-8 text-text-muted text-sm">
                    <span className="material-symbols-outlined animate-spin mr-2">progress_activity</span>
                    {t('update.loadingChangelog')}
                  </div>
                ) : changelog.data?.length ? (
                  changelog.data.map((release) => (
                    <div key={`${release.latestVersion}-${release.publishedAt}`} className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-text-main">{release.latestVersion}</span>
                        {release.latestVersion === version && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/20 text-primary font-semibold">
                            {t('update.current')}
                          </span>
                        )}
                        <span className="text-xs text-text-muted ml-auto">{formatDate(release.publishedAt)}</span>
                      </div>
                      <SanitizedHtml
                        className="changelog-md text-xs pl-2 border-l-2 border-border-subtle"
                        html={mdToHtml(release.releaseNotes)}
                      />
                    </div>
                  ))
                ) : (
                  <p className="text-center text-text-muted text-sm py-8">{t('update.noChangelog')}</p>
                )}
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-between px-5 py-3 border-t border-border-subtle shrink-0 bg-bg-card/50">
            {updateInfo?.htmlUrl && (
              <button
                type="button"
                onClick={() => openReleasePage(updateInfo.htmlUrl)}
                className="text-xs text-text-muted hover:text-primary transition-colors flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                GitHub
              </button>
            )}
            <div className="flex items-center gap-2 ml-auto">
              {hasUpdate && !isDownloading && !isReady && (
                <button
                  type="button"
                  onClick={startDownload}
                  className="inline-flex items-center gap-1.5 bg-primary hover:bg-primary-hover text-white px-4 py-2 rounded-lg text-xs font-medium transition-all"
                >
                  <span className="material-symbols-outlined text-[16px]">download</span>
                  {t('update.download')}
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg text-xs font-medium text-text-muted hover:text-text-main hover:bg-white/5 transition-all"
              >
                {t('update.close')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

// ─── Lightweight Markdown → HTML ───

function mdToHtml(md: string): string {
  if (!md) return ''

  // Remove "**Full Changelog**: ..." lines
  const raw = md.replace(/\*\*Full Changelog\*\*:.*$/gm, '').trim()
  const lines = raw.split('\n')
  const out: string[] = []
  let inList = false
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // ── Table: detect | ... | pattern with separator row ──
    if (line.trim().startsWith('|') && i + 1 < lines.length && /^\|[\s:*\-|]+\|$/.test(lines[i + 1].trim())) {
      if (inList) { out.push('</ul>'); inList = false }
      const headerCells = line.split('|').filter(c => c.trim()).map(c => inlineFormat(c.trim()))
      i += 2 // skip header + separator
      const rows: string[][] = []
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(lines[i].split('|').filter(c => c.trim()).map(c => inlineFormat(c.trim())))
        i++
      }
      out.push('<table>')
      out.push('<thead><tr>' + headerCells.map(c => `<th>${c}</th>`).join('') + '</tr></thead>')
      out.push('<tbody>')
      for (const row of rows) {
        out.push('<tr>' + row.map(c => `<td>${c}</td>`).join('') + '</tr>')
      }
      out.push('</tbody></table>')
      continue
    }

    // ── Empty line ──
    if (!line.trim()) {
      if (inList) { out.push('</ul>'); inList = false }
      i++
      continue
    }

    // ── Headers ──
    if (line.startsWith('### ')) {
      if (inList) { out.push('</ul>'); inList = false }
      out.push(`<h4>${inlineFormat(line.slice(4))}</h4>`)
      i++; continue
    }
    if (line.startsWith('## ')) {
      if (inList) { out.push('</ul>'); inList = false }
      out.push(`<h3>${inlineFormat(line.slice(3))}</h3>`)
      i++; continue
    }

    // ── List items: * or - ──
    const listMatch = line.match(/^[*\-] (.+)$/)
    if (listMatch) {
      if (!inList) { out.push('<ul>'); inList = true }
      out.push(`<li>${inlineFormat(listMatch[1])}</li>`)
      i++; continue
    }

    // ── Regular paragraph line ──
    if (inList) { out.push('</ul>'); inList = false }
    out.push(`<p>${inlineFormat(line)}</p>`)
    i++
  }

  if (inList) out.push('</ul>')
  return sanitizeMarkdownHtml(out.join('\n'))
}

/** Format inline markdown: bold, italic, code, links */
function inlineFormat(s: string): string {
  let t = s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  // Bold **text**
  t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  // Italic *text*
  t = t.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>')
  // Inline code `code`
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>')
  // Links [text](url)
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
  return t
}

function formatDate(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
