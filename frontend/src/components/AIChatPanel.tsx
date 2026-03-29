/* eslint-disable react-dom/no-dangerously-set-innerhtml */

import DOMPurify from 'dompurify'
import { useState, useRef, useEffect, useCallback, type FormEvent } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useAIChat, useAuth, useModelSelection, type AIError } from '@/hooks/useAIChat'
import { useConnections } from '@/hooks/useConnections'
import * as AIService from '../../bindings/soft-db/services/aiservice'

interface AIChatPanelProps {
  connectionId: string
  database?: string
  visible: boolean
  onClose: () => void
  onInsertToEditor?: (code: string) => void
  prefillText?: string
  prefillMode?: 'append' | 'replace'
  onPrefillConsumed?: () => void
}

const MIN_WIDTH = 280
const MAX_WIDTH = 600
const DEFAULT_WIDTH = 340
const STORAGE_KEY = 'ai-panel-width'

export function AIChatPanel({ connectionId, database, visible, onClose, onInsertToEditor, prefillText, prefillMode = 'append', onPrefillConsumed }: AIChatPanelProps) {
  const { isLoggedIn, login, logout, isExpired, email } = useAuth()
  const { models, selectedModel, setModel } = useModelSelection(connectionId)
  const {
    messages, streamingContent, isStreaming,
    error, sendMessage, stopStreaming, clearChat, clearError,
    canSend, rateLimitCooldown,
  } = useAIChat(connectionId)

  const { data: connections = [] } = useConnections()
  const currentConn = connections.find(c => c.id === connectionId)
  const connHasMCP = currentConn?.mcpEnabled ?? false

  const mcpModeQuery = useQuery({
    queryKey: ['ai', 'mcpMode', connectionId],
    queryFn: () => AIService.GetMCPMode(connectionId),
    enabled: !!connectionId && connHasMCP,
  })
  const mcpModeEnabled = connHasMCP && (mcpModeQuery.data ?? false)

  const setMCPModeMutation = useMutation({
    mutationFn: (enabled: boolean) => AIService.SetMCPMode(connectionId, enabled),
    onSuccess: () => mcpModeQuery.refetch(),
  })

  const [input, setInput] = useState('')
  const [panelWidth, setPanelWidth] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved ? Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, parseInt(saved, 10))) : DEFAULT_WIDTH
  })
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const isResizing = useRef(false)
  const latestWidthRef = useRef(panelWidth)

  // Auto-scroll to bottom
  useEffect(() => {
    void messages.length
    void streamingContent
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, streamingContent])

  const handleResizeKeyDown = useCallback((e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') {
      return
    }

    e.preventDefault()

    setPanelWidth(prev => {
      const delta = e.key === 'ArrowLeft' ? 16 : -16
      const next = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, prev + delta))
      latestWidthRef.current = next
      localStorage.setItem(STORAGE_KEY, next.toString())
      return next
    })
  }, [])

  // Handle prefill text (from Attach to AI)
  useEffect(() => {
    if (prefillText && visible) {
      setInput(prev => prefillMode === 'replace' ? prefillText : (prev ? prev + prefillText : prefillText))
      onPrefillConsumed?.()
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [prefillText, visible, prefillMode, onPrefillConsumed])

  // Focus input when panel opens
  useEffect(() => {
    if (visible) inputRef.current?.focus()
  }, [visible])

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isResizing.current = true
    const startX = e.clientX
    const startWidth = latestWidthRef.current

    const onMove = (ev: MouseEvent) => {
      if (!isResizing.current) return
      const delta = startX - ev.clientX
      const newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth + delta))
      latestWidthRef.current = newWidth
      setPanelWidth(newWidth)
    }

    const onUp = () => {
      isResizing.current = false
      localStorage.setItem(STORAGE_KEY, latestWidthRef.current.toString())
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  // Auto-resize textarea
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    const ta = e.target
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    const msg = input.trim()
    if (!msg || !canSend) return
    setInput('')
    if (inputRef.current) inputRef.current.style.height = 'auto'
    sendMessage(msg, selectedModel, mcpModeEnabled, database)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  const handleSuggestionClick = (text: string) => {
    setInput(text)
    inputRef.current?.focus()
  }

  return (
    <div
      className={`ai-chat-panel ${visible ? 'ai-chat-panel-open' : 'ai-chat-panel-closed'}`}
      style={{ width: visible ? panelWidth : 0 }}
    >
      <div className="ai-chat-panel-inner" style={{ minWidth: panelWidth }}>
      {/* Resize handle */}
      <button
        type="button"
        className="ai-resize-handle"
        onMouseDown={handleResizeStart}
        onKeyDown={handleResizeKeyDown}
        aria-label="Resize AI chat panel"
      />

      {/* Header */}
      <div className="ai-chat-header">
        <div className="ai-chat-header-left">
          <span className="material-symbols-outlined text-[15px]">auto_awesome</span>
          <span className="ai-chat-title">AI Assistant</span>
        </div>
        <div className="ai-chat-header-actions">
          {isLoggedIn && connHasMCP && (
            <button
              type="button"
              role="switch"
              aria-checked={mcpModeEnabled}
              aria-label="Toggle MCP mode"
              className="ai-mcp-switch"
              onClick={() => setMCPModeMutation.mutate(!mcpModeEnabled)}
              title={mcpModeEnabled ? 'MCP Mode: ON — AI can query your database (read-only)' : 'MCP Mode: OFF — Schema context only'}
            >
              <span className="ai-mcp-switch-label">MCP</span>
              <span className={`ai-mcp-switch-track ${mcpModeEnabled ? 'ai-mcp-switch-on' : ''}`}>
                <span className="ai-mcp-switch-thumb" />
              </span>
            </button>
          )}
          {isLoggedIn && (
            <select
              className="ai-model-select"
              value={selectedModel}
              onChange={(e) => setModel(e.target.value)}
              title="Select AI model"
            >
              <optgroup label="Code">
                {models.filter(m => m.category === 'code').map(m => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </optgroup>
              <optgroup label="General">
                {models.filter(m => m.category === 'general').map(m => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </optgroup>
              <optgroup label="Fast">
                {models.filter(m => m.category === 'fast').map(m => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </optgroup>
              <optgroup label="Reasoning">
                {models.filter(m => m.category === 'reasoning').map(m => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </optgroup>
            </select>
          )}
          <button type="button" className="ai-icon-btn" onClick={() => clearChat()} title="Clear chat">
            <span className="material-symbols-outlined text-[14px]">delete_sweep</span>
          </button>
          <button type="button" className="ai-icon-btn" onClick={onClose} title="Close panel">
            <span className="material-symbols-outlined text-[14px]">close</span>
          </button>
        </div>
      </div>

      {/* Account bar */}
      {isLoggedIn && (
        <div className="ai-account-bar">
          <div className="ai-account-info">
            <span className="ai-account-dot" />
            <span className="ai-account-email" title={email}>{email || 'Connected'}</span>
          </div>
          <button type="button" className="ai-logout-btn" onClick={() => logout.mutate()} title="Sign out">
            <svg aria-hidden="true" focusable="false" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
            </svg>
            Sign out
          </button>
        </div>
      )}

      {/* Content */}
      <div className="ai-chat-body">
        {/* Login required */}
        {(!isLoggedIn || isExpired) ? (
          <LoginPrompt
            isExpired={isExpired}
            onLogin={() => login.mutate('app_EMoamEEZ73f0CkXaXp7hrann')}
            isLoading={login.isPending}
          />
        ) : (
          <>
            {/* Error banner */}
            {error && <ErrorBanner error={error} onDismiss={clearError} />}

            {/* Messages */}
            <div className="ai-messages">
              {messages.length === 0 && !streamingContent && (
                <WelcomeMessage onSuggestionClick={handleSuggestionClick} />
              )}

              {messages.map((msg, i) => (
                <MessageBubble
                  key={msg.id ?? i}
                  messageRole={msg.role}
                  content={msg.content}
                  onInsertToEditor={onInsertToEditor}
                />
              ))}

              {/* Streaming response */}
              {streamingContent && (
                <MessageBubble
                  messageRole="assistant"
                  content={streamingContent}
                  isStreaming
                  onInsertToEditor={onInsertToEditor}
                />
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <form className="ai-chat-input-form" onSubmit={handleSubmit}>
              <textarea
                ref={inputRef}
                className="ai-chat-input"
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder="Ask about your database..."
                rows={1}
                disabled={isStreaming}
              />
              {isStreaming ? (
                <button type="button" className="ai-send-btn ai-stop-btn" onClick={stopStreaming} title="Stop">
                  <svg aria-hidden="true" focusable="false" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                </button>
              ) : (
                <button type="submit" className="ai-send-btn" disabled={!canSend || !input.trim()} title={rateLimitCooldown > 0 ? `Wait ${rateLimitCooldown}s` : 'Send'}>
                  {rateLimitCooldown > 0 ? (
                    <span style={{ fontSize: 11, fontWeight: 600 }}>{rateLimitCooldown}s</span>
                  ) : (
                    <svg aria-hidden="true" focusable="false" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" />
                    </svg>
                  )}
                </button>
              )}
            </form>
          </>
        )}
      </div>
      </div>{/* .ai-chat-panel-inner */}
    </div>
  )
}

// ─── Sub-components ───

function LoginPrompt({ isExpired, onLogin, isLoading }: { isExpired: boolean; onLogin: () => void; isLoading: boolean }) {
  return (
    <div className="ai-login-prompt">
      <div className="ai-login-icon">
        <svg aria-hidden="true" focusable="false" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5">
          <path d="M12 2a10 10 0 0 1 10 10c0 5.52-4.48 10-10 10S2 17.52 2 12" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </div>
      <h3 className="ai-login-title">
        {isExpired ? 'Session Expired' : 'Sign in with ChatGPT'}
      </h3>
      <p className="ai-login-desc">
        {isExpired
          ? 'Your ChatGPT session has expired. Please sign in again.'
          : 'Use your ChatGPT account to chat with AI about your database.'}
      </p>
      <button
        type="button"
        className="ai-login-btn"
        onClick={onLogin}
        disabled={isLoading}
      >
        {isLoading ? 'Opening browser...' : 'Sign in with ChatGPT'}
      </button>
    </div>
  )
}

function ErrorBanner({ error, onDismiss }: { error: AIError; onDismiss: () => void }) {
  const isQuota = error.type === 'quota_exhausted'
  const isRateLimit = error.type === 'rate_limited'

  return (
    <div className={`ai-error-banner ${isQuota ? 'ai-error-quota' : isRateLimit ? 'ai-error-rate' : ''}`}>
      <div className="ai-error-content">
        <span className="ai-error-icon">{isQuota ? '⚠️' : isRateLimit ? '⏳' : '❌'}</span>
        <span className="ai-error-text">{error.message}</span>
      </div>
      <button type="button" className="ai-error-dismiss" onClick={onDismiss}>×</button>
    </div>
  )
}

// ─── Code Block Parsing ───

interface ContentBlock {
  type: 'text' | 'code'
  content: string
  language?: string
}

function parseCodeBlocks(content: string): ContentBlock[] {
  const blocks: ContentBlock[] = []
  const regex = /```(\w*)\n?([\s\S]*?)```/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  match = regex.exec(content)

  while (match !== null) {
    // Text before code block
    if (match.index > lastIndex) {
      blocks.push({ type: 'text', content: content.slice(lastIndex, match.index) })
    }
    // Code block
    blocks.push({
      type: 'code',
      language: match[1] || 'sql',
      content: match[2].trim(),
    })
    lastIndex = match.index + match[0].length
    match = regex.exec(content)
  }

  // Remaining text
  if (lastIndex < content.length) {
    blocks.push({ type: 'text', content: content.slice(lastIndex) })
  }

  return blocks.length > 0 ? blocks : [{ type: 'text', content }]
}

function CodeBlock({ code, language, onInsertToEditor }: {
  code: string
  language?: string
  onInsertToEditor?: (code: string) => void
}) {
  const [copied, setCopied] = useState(false)
  const [inserted, setInserted] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleInsert = () => {
    onInsertToEditor?.(code)
    setInserted(true)
    setTimeout(() => setInserted(false), 2000)
  }

  return (
    <div className="ai-code-block">
      <div className="ai-code-header">
        <span className="ai-code-lang">{language || 'code'}</span>
        <div className="ai-code-actions">
          {onInsertToEditor && (
            <button type="button" className="ai-code-action-btn" onClick={handleInsert} title="Insert to Editor">
              {inserted ? '✓ Inserted' : '⬇ Insert'}
            </button>
          )}
          <button type="button" className="ai-code-action-btn" onClick={handleCopy} title="Copy">
            {copied ? '✓ Copied' : '📋 Copy'}
          </button>
        </div>
      </div>
      <pre className="ai-code-content"><code>{code}</code></pre>
    </div>
  )
}

// ─── Markdown Formatting ───

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

const MARKDOWN_SANITIZE_OPTIONS = {
  FORBID_ATTR: ['onerror', 'onload'],
  FORBID_TAGS: ['script', 'iframe'],
}

function sanitizeMarkdownHtml(html: string): string {
  return DOMPurify.sanitize(html, MARKDOWN_SANITIZE_OPTIONS)
}

function formatMarkdown(text: string): string {
  let html = escapeHtml(text)

  // Headings: #### h4, ### h3, ## h2, # h1 (must process longer prefixes first)
  html = html.replace(/^#### (.+)$/gm, '<h4 class="ai-heading ai-h4">$1</h4>')
  html = html.replace(/^### (.+)$/gm, '<h3 class="ai-heading ai-h3">$1</h3>')
  html = html.replace(/^## (.+)$/gm, '<h2 class="ai-heading ai-h2">$1</h2>')
  html = html.replace(/^# (.+)$/gm, '<h1 class="ai-heading ai-h1">$1</h1>')

  // Inline code: `code`
  html = html.replace(/`([^`]+)`/g, '<code class="ai-inline-code">$1</code>')
  // Bold: **text**
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  // Italic: *text* (but not inside **)
  html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>')
  // List items: lines starting with - 
  html = html.replace(/^- (.+)$/gm, '<span class="ai-list-item">• $1</span>')
  // Numbered list: lines starting with 1. 2. etc
  html = html.replace(/^(\d+)\. (.+)$/gm, '<span class="ai-list-item">$1. $2</span>')

  return sanitizeMarkdownHtml(html)
}

// ─── SVG Icons ───

function AIIcon({ size = 16 }: { size?: number }) {
  return (
    <span aria-hidden="true" className="material-symbols-outlined" style={{ fontSize: size }}>auto_awesome</span>
  )
}

function UserIcon({ size = 16 }: { size?: number }) {
  return (
    <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M20 21a8 8 0 1 0-16 0" />
    </svg>
  )
}

function MessageBubble({ messageRole, content, isStreaming, onInsertToEditor }: {
  messageRole: string
  content: string
  isStreaming?: boolean
  onInsertToEditor?: (code: string) => void
}) {
  const blocks = parseCodeBlocks(content)

  return (
    <div className={`ai-message ai-message-${messageRole}`}>
      <div className={`ai-message-avatar ${messageRole === 'assistant' ? 'ai-avatar-assistant' : 'ai-avatar-user'}`}>
        {messageRole === 'assistant' ? <AIIcon size={15} /> : <UserIcon size={15} />}
      </div>
      <div className="ai-message-content">
        {blocks.map((block) => (
          block.type === 'code' ? (
            <CodeBlock
              key={`code-${block.language ?? 'plain'}-${block.content}`}
              code={block.content}
              language={block.language}
              onInsertToEditor={onInsertToEditor}
            />
          ) : block.content.trim() ? (
            // eslint-disable-next-line react/no-danger, react-dom/no-dangerously-set-innerhtml
            <div
              key={`text-${block.content}`}
              className="ai-message-text"
              dangerouslySetInnerHTML={{ __html: sanitizeMarkdownHtml(formatMarkdown(block.content.trim())) }}
            />
          ) : null
        ))}
        {isStreaming && <span className="ai-cursor-blink">▊</span>}
      </div>
    </div>
  )
}

function WelcomeMessage({ onSuggestionClick }: { onSuggestionClick: (text: string) => void }) {
  const suggestions = [
    { emoji: '📊', text: 'Show me all tables' },
    { emoji: '🔗', text: 'Write a JOIN query for...' },
    { emoji: '⚡', text: 'Optimize this query' },
  ]

  return (
    <div className="ai-welcome">
      <div className="ai-welcome-icon">
        <AIIcon size={36} />
      </div>
      <h3>Database AI Assistant</h3>
      <p>Ask questions about your schema, write SQL queries, or get optimization tips.</p>
      <div className="ai-welcome-suggestions">
          {suggestions.map((s) => (
            <button
              key={s.text}
              type="button"
              className="ai-suggestion"
              onClick={() => onSuggestionClick(s.text)}
            >
            {s.emoji} {s.text}
          </button>
        ))}
      </div>
    </div>
  )
}
