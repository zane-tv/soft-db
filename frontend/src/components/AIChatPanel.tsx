import { useState, useRef, useEffect, type FormEvent } from 'react'
import { useAIChat, useAuth, useModelSelection, type AIError } from '@/hooks/useAIChat'

interface AIChatPanelProps {
  connectionId: string
  visible: boolean
  onClose: () => void
}

export function AIChatPanel({ connectionId, visible, onClose }: AIChatPanelProps) {
  const { isLoggedIn, login, isExpired } = useAuth()
  const { models, selectedModel, setModel } = useModelSelection(connectionId)
  const {
    messages, streamingContent, isStreaming,
    error, sendMessage, stopStreaming, clearChat, clearError,
    canSend, rateLimitCooldown,
  } = useAIChat(connectionId)

  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

  // Focus input when panel opens
  useEffect(() => {
    if (visible) inputRef.current?.focus()
  }, [visible])

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    const msg = input.trim()
    if (!msg || !canSend) return
    setInput('')
    sendMessage(msg, selectedModel)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  if (!visible) return null

  return (
    <div className="ai-chat-panel">
      {/* Header */}
      <div className="ai-chat-header">
        <div className="ai-chat-header-left">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2a10 10 0 0 1 10 10c0 5.52-4.48 10-10 10S2 17.52 2 12" />
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v4M22 12h-4M12 22v-4M2 12h4" />
          </svg>
          <span className="ai-chat-title">AI Assistant</span>
        </div>
        <div className="ai-chat-header-actions">
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
          <button className="ai-icon-btn" onClick={() => clearChat()} title="Clear chat">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" />
            </svg>
          </button>
          <button className="ai-icon-btn" onClick={onClose} title="Close panel">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

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
                <WelcomeMessage />
              )}

              {messages.map((msg, i) => (
                <MessageBubble key={msg.id ?? i} role={msg.role} content={msg.content} />
              ))}

              {/* Streaming response */}
              {streamingContent && (
                <MessageBubble role="assistant" content={streamingContent} isStreaming />
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <form className="ai-chat-input-form" onSubmit={handleSubmit}>
              <textarea
                ref={inputRef}
                className="ai-chat-input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about your database..."
                rows={1}
                disabled={isStreaming}
              />
              {isStreaming ? (
                <button type="button" className="ai-send-btn ai-stop-btn" onClick={stopStreaming} title="Stop">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                </button>
              ) : (
                <button type="submit" className="ai-send-btn" disabled={!canSend || !input.trim()} title={rateLimitCooldown > 0 ? `Wait ${rateLimitCooldown}s` : 'Send'}>
                  {rateLimitCooldown > 0 ? (
                    <span style={{ fontSize: 11, fontWeight: 600 }}>{rateLimitCooldown}s</span>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" />
                    </svg>
                  )}
                </button>
              )}
            </form>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Sub-components ───

function LoginPrompt({ isExpired, onLogin, isLoading }: { isExpired: boolean; onLogin: () => void; isLoading: boolean }) {
  return (
    <div className="ai-login-prompt">
      <div className="ai-login-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5">
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
        {isQuota && (
          <a
            href="#"
            className="ai-error-link"
            onClick={(e) => { e.preventDefault(); window.open('https://platform.openai.com/account/billing', '_blank') }}
          >
            Manage plan →
          </a>
        )}
      </div>
      <button className="ai-error-dismiss" onClick={onDismiss}>×</button>
    </div>
  )
}

function MessageBubble({ role, content, isStreaming }: { role: string; content: string; isStreaming?: boolean }) {
  return (
    <div className={`ai-message ai-message-${role}`}>
      <div className="ai-message-avatar">
        {role === 'assistant' ? '🤖' : '👤'}
      </div>
      <div className="ai-message-content">
        <pre className="ai-message-text">{content}</pre>
        {isStreaming && <span className="ai-cursor-blink">▊</span>}
      </div>
    </div>
  )
}

function WelcomeMessage() {
  return (
    <div className="ai-welcome">
      <div className="ai-welcome-icon">🤖</div>
      <h3>Database AI Assistant</h3>
      <p>Ask questions about your schema, write SQL queries, or get optimization tips.</p>
      <div className="ai-welcome-suggestions">
        <span className="ai-suggestion">💡 "Show me all tables"</span>
        <span className="ai-suggestion">💡 "Write a JOIN query for..."</span>
        <span className="ai-suggestion">💡 "Optimize this query"</span>
      </div>
    </div>
  )
}
