import { useState, useEffect, useCallback, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Events } from '@wailsio/runtime'
import * as AIService from '../../bindings/soft-db/services/aiservice'
import * as OAuthService from '../../bindings/soft-db/services/oauthservice'

// ─── Types ───

export interface ChatMessage {
  id?: number
  connectionId: string
  role: 'user' | 'assistant'
  content: string
  model?: string
  createdAt?: string
}

export interface AIError {
  type: 'rate_limited' | 'quota_exhausted' | 'auth_error' | 'error'
  message: string
  code: number
}

export interface ModelInfo {
  id: string
  name: string
  category: string
  description: string
}

// ─── Auth Hook ───

export function useAuth() {
  const queryClient = useQueryClient()

  const authStatus = useQuery({
    queryKey: ['auth', 'status'],
    queryFn: () => OAuthService.GetAuthStatus(),
  })

  const login = useMutation({
    mutationFn: (clientId: string) => OAuthService.StartOAuthLogin(clientId),
  })

  const logout = useMutation({
    mutationFn: () => OAuthService.Logout(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['auth'] }),
  })

  // Listen for auth status events from backend
  useEffect(() => {
    const cleanup = Events.On('auth:status', () => {
      queryClient.invalidateQueries({ queryKey: ['auth'] })
    })
    return cleanup
  }, [queryClient])

  return {
    isLoggedIn: authStatus.data?.status === 'logged_in',
    isExpired: authStatus.data?.status === 'expired',
    email: authStatus.data?.email ?? '',
    authStatus,
    login,
    logout,
  }
}

// ─── Model Selection Hook ───

export function useModelSelection(connectionId: string) {
  const selectedModel = useQuery({
    queryKey: ['ai', 'model', connectionId],
    queryFn: () => AIService.GetSelectedModel(connectionId),
    enabled: !!connectionId,
  })

  const models = useQuery({
    queryKey: ['ai', 'models'],
    queryFn: () => AIService.ListModels(),
    staleTime: Infinity,
  })

  const setModel = useMutation({
    mutationFn: (modelId: string) => AIService.SetSelectedModel(connectionId, modelId),
    onSuccess: () => {
      selectedModel.refetch()
    },
  })

  return {
    models: models.data ?? [],
    selectedModel: selectedModel.data ?? 'gpt-5.3-codex',
    setModel: setModel.mutate,
    isLoading: models.isLoading,
  }
}

// ─── Chat Hook ───

export function useAIChat(connectionId: string) {
  const queryClient = useQueryClient()
  const [streamingContent, setStreamingContent] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<AIError | null>(null)
  const streamingRef = useRef('')
  const [rateLimitCooldown, setRateLimitCooldown] = useState(0)
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Load persisted chat history
  const history = useQuery({
    queryKey: ['ai', 'chat', connectionId],
    queryFn: () => AIService.GetChatHistory(connectionId),
    enabled: !!connectionId,
  })

  // Listen for AI events
  useEffect(() => {
    if (!connectionId) return

    const cleanupChunk = Events.On(`ai:chunk:${connectionId}` as any, (ev: any) => {
      const data = ev.data as { content: string }
      streamingRef.current += data.content
      setStreamingContent(streamingRef.current)
    })

    const cleanupDone = Events.On(`ai:done:${connectionId}` as any, () => {
      setIsStreaming(false)
      setStreamingContent('')
      streamingRef.current = ''
      // Refresh history to get the saved assistant response
      queryClient.invalidateQueries({ queryKey: ['ai', 'chat', connectionId] })
    })

    const cleanupError = Events.On(`ai:error:${connectionId}` as any, (ev: any) => {
      const data = ev.data as AIError
      setIsStreaming(false)
      setStreamingContent('')
      streamingRef.current = ''
      setError(data)

      // Start cooldown timer for rate limits
      if (data.type === 'rate_limited') {
        // Parse seconds from message like "Rate limited. Please wait 30s"
        const match = data.message.match(/(\d+)s/)
        const seconds = match ? Math.min(parseInt(match[1], 10), 120) : 30
        setRateLimitCooldown(seconds)
        if (cooldownRef.current) clearInterval(cooldownRef.current)
        cooldownRef.current = setInterval(() => {
          setRateLimitCooldown(prev => {
            if (prev <= 1) {
              if (cooldownRef.current) clearInterval(cooldownRef.current)
              cooldownRef.current = null
              return 0
            }
            return prev - 1
          })
        }, 1000)
      }
    })

    return () => {
      cleanupChunk()
      cleanupDone()
      cleanupError()
    }
  }, [connectionId, queryClient])

  // Send message
  const sendMessage = useCallback(async (message: string, model?: string) => {
    setError(null)
    setIsStreaming(true)
    setStreamingContent('')
    streamingRef.current = ''

    // Optimistically add user message to history
    const userMessage: ChatMessage = {
      connectionId,
      role: 'user',
      content: message,
      model,
      createdAt: new Date().toISOString(),
    }

    queryClient.setQueryData(
      ['ai', 'chat', connectionId],
      (old: ChatMessage[] | undefined) => [...(old ?? []), userMessage]
    )

    try {
      await AIService.SendMessage(connectionId, message, model ?? '')
    } catch (e) {
      setIsStreaming(false)
      setError({ type: 'error', message: String(e), code: 0 })
    }
  }, [connectionId, queryClient])

  // Stop streaming
  const stopStreaming = useCallback(() => {
    AIService.StopStreaming(connectionId)
    setIsStreaming(false)
    setStreamingContent('')
    streamingRef.current = ''
  }, [connectionId])

  // Clear chat
  const clearChat = useMutation({
    mutationFn: () => AIService.ClearChatHistory(connectionId),
    onSuccess: () => {
      queryClient.setQueryData(['ai', 'chat', connectionId], [])
      setError(null)
      setRateLimitCooldown(0)
      if (cooldownRef.current) clearInterval(cooldownRef.current)
    },
  })

  const canSend = !isStreaming && rateLimitCooldown === 0

  return {
    messages: history.data ?? [],
    streamingContent,
    isStreaming,
    error,
    sendMessage,
    stopStreaming,
    clearChat: clearChat.mutate,
    clearError: () => {
      setError(null)
      setRateLimitCooldown(0)
      if (cooldownRef.current) clearInterval(cooldownRef.current)
    },
    canSend,
    rateLimitCooldown,
    isLoading: history.isLoading,
  }
}
