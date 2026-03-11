# AI Chatbox Feature — Design Document

> **Approach**: A — Full Backend Proxy  
> **Model**: User-selectable (GPT-5.3-Codex, GPT-5.4, GPT-5 Mini, o4-mini, etc.)  
> **Auth**: OAuth 2.0 PKCE via ChatGPT account  
> **Scope**: DB-aware AI assistant, workspace-only, per-connection chat isolation

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         SoftDB Desktop                          │
├──────────┬──────────────────────────────────────┬───────────────┤
│          │           Main Content               │  AI Chat      │
│ Explorer │  ┌─────────────────────────┐         │  Panel        │
│ Sidebar  │  │     SQL Editor          │         │               │
│          │  └─────────────────────────┘         │  ┌─────────┐  │
│          │  ┌─────────────────────────┐         │  │ Messages│  │
│          │  │     Results Grid        │         │  │         │  │
│          │  └─────────────────────────┘         │  │         │  │
│          │                                      │  │         │  │
│          │                                      │  ├─────────┤  │
│          │                                      │  │ Input   │  │
├──────────┴──────────────────────────────────────┴───────────────┤
│                          AppBar                                 │
└─────────────────────────────────────────────────────────────────┘

Data Flow:
  Frontend ──[Wails Binding]──▶ AIService (Go)
                                    │
                                    ├──▶ Get schema context from ConnectionService
                                    ├──▶ Build system prompt with DB context
                                    ├──▶ Call OpenAI Codex API (streaming)
                                    └──▶ Stream chunks back via Wails Events
                                         ◀──[Events]── Frontend updates UI
```

**Key decisions:**
- Token **never** exposed to frontend — Go manages entire OAuth lifecycle
- Streaming via **Wails application events** (`app.EmitEvent`) — real-time response chunks
- Each connection tab maintains **isolated chat history** (stored in SQLite)
- DB context (tables, columns, types) injected into **system prompt** automatically

---

## 2. Go Backend Components

### 2.1 OAuth Service (`services/oauth_service.go`)

Handles the ChatGPT OAuth 2.0 PKCE flow:

```
User clicks "Sign in with ChatGPT"
       │
       ▼
  Go spawns temporary HTTP server (localhost:PORT/callback)
       │
       ▼
  Go opens system browser → OpenAI authorization URL
  (with client_id, code_challenge, redirect_uri)
       │
       ▼
  User logs in with ChatGPT account, grants permission
       │
       ▼
  OpenAI redirects to localhost:PORT/callback?code=XXX
       │
       ▼
  Go exchanges code + code_verifier → access_token + refresh_token
       │
       ▼
  Tokens encrypted (AES-256-GCM via crypto package) → stored in SQLite
       │
       ▼
  Frontend receives "auth:success" event → UI updates
```

**Methods exposed via Wails binding:**
| Method | Description |
|--------|-------------|
| `StartOAuthLogin()` | Initiates OAuth PKCE flow, opens browser |
| `GetAuthStatus() AuthStatus` | Returns current auth state (logged_in/logged_out/expired) |
| `Logout()` | Clears stored tokens |

**Internal methods (not exposed):**
- `refreshToken()` — auto-refresh when access_token expires
- `getValidToken() string` — returns current valid token (refreshes if needed)

### 2.2 AI Chat Service (`services/ai_service.go`)

Proxies chat requests to OpenAI API with DB context injection:

**Methods exposed via Wails binding:**
| Method | Description |
|--------|-------------|
| `SendMessage(connectionId, message, model string)` | Send chat message with chosen model, streams response via events |
| `GetChatHistory(connectionId string) []ChatMessage` | Load persisted chat history for a connection |
| `ClearChatHistory(connectionId string)` | Clear chat history for a connection |
| `ListModels() []ModelInfo` | Returns available models list (hardcoded, categorized) |

**Internal flow for `SendMessage`:**
1. Get valid OAuth token from OAuthService
2. Fetch schema context: tables, columns, types, relationships from ConnectionService
3. Build system prompt:
   ```
   You are a database assistant for {dbType} database "{dbName}".
   Available tables and their columns:
   - users (id INT PK, name VARCHAR, email VARCHAR, ...)
   - orders (id INT PK, user_id INT FK→users, ...)
   
   Help the user write queries, explain schemas, and optimize SQL.
   Respond in the same language the user writes in.
   ```
4. Call `POST https://api.openai.com/v1/chat/completions` with streaming
5. For each SSE chunk: `app.EmitEvent("ai:chunk:{connectionId}", chunkData)`
6. On completion: `app.EmitEvent("ai:done:{connectionId}", fullMessage)`
7. Save message pair to SQLite chat_history table

### 2.3 Store Migration — New Tables

```sql
-- OAuth tokens (encrypted)
CREATE TABLE IF NOT EXISTS oauth_tokens (
    id INTEGER PRIMARY KEY DEFAULT 1,
    access_token TEXT NOT NULL,     -- AES-encrypted
    refresh_token TEXT NOT NULL,    -- AES-encrypted
    expires_at TEXT NOT NULL,
    provider TEXT DEFAULT 'openai',
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(id)  -- only one active session
);

-- Chat history (per connection)
CREATE TABLE IF NOT EXISTS chat_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    connection_id TEXT NOT NULL,
    role TEXT NOT NULL,              -- 'user' | 'assistant'
    content TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_chat_conn ON chat_history(connection_id);
CREATE INDEX IF NOT EXISTS idx_chat_created ON chat_history(created_at);
```

---

## 3. Frontend Components

### 3.1 AIChatPanel (`components/AIChatPanel.tsx`)

Collapsible right-side panel within `TableExplorer`:

**Props:**
```typescript
interface AIChatPanelProps {
  connectionId: string
  collapsed: boolean
  onToggle: () => void
  // Schema context (from existing hooks)
  tables: TableInfo[]
  dbType: string
  dbName: string
}
```

**Features:**
- Message list with user/AI message bubbles
- Markdown rendering for AI responses (code blocks, tables)
- Streaming indicator (typing animation during response)
- "Apply to Editor" button on SQL code blocks → inserts into SqlEditor
- Auth status indicator (signed in / sign in button)
- **Model selector dropdown** (top of panel, persisted per-connection)
- Clear history button

### 3.1.1 Model Selector

Dropdown tại header của chat panel, cho user chọn model:

```typescript
interface ModelInfo {
  id: string          // API model ID
  name: string        // Display name
  category: string    // "code" | "general" | "fast" | "reasoning"
  description: string // Short description
}
```

**Available models (March 2026):**

| Model ID | Display Name | Category | Best for |
|----------|-------------|----------|----------|
| `gpt-5.3-codex` | GPT-5.3 Codex | 💻 Code | SQL generation, code tasks **(default)** |
| `gpt-5.4` | GPT-5.4 | 🧠 Flagship | Complex reasoning, latest & smartest |
| `gpt-5` | GPT-5 | 🧠 General | Versatile, multimodal |
| `gpt-5-mini` | GPT-5 Mini | ⚡ Fast | Quick answers, cost-effective |
| `gpt-5-nano` | GPT-5 Nano | 💨 Ultra-fast | Simple completions, cheapest |
| `o4-mini` | o4 Mini | 🔬 Reasoning | Deep analysis, code reasoning |
| `o3` | o3 | 🔬 Reasoning | Advanced reasoning, optimization |

- **Default**: `gpt-5.3-codex` (tối ưu cho SQL/code generation)
- **Persisted**: Lưu model đã chọn vào `settings` table (key: `ai_model_{connectionId}`)
- **UI**: Compact dropdown với icon category, hiện ngay dưới header chat panel
- **Dynamic list**: `ListModels()` trả về hardcoded list, dễ update khi có model mới

### 3.2 AI Toggle Button (in `EditorTabBar` or `AppBar`)

Small button to open/close the AI panel:
- Icon: `smart_toy` (Material Symbols)
- Position: Right side of EditorTabBar
- Badge: green dot when authenticated

### 3.3 React Hook — `useAIChat.ts`

```typescript
interface UseAIChatReturn {
  // State
  messages: ChatMessage[]
  isStreaming: boolean
  authStatus: 'logged_in' | 'logged_out' | 'expired'
  selectedModel: string
  availableModels: ModelInfo[]
  
  // Actions
  sendMessage: (content: string) => void
  setModel: (modelId: string) => void
  clearHistory: () => void
  login: () => void
  logout: () => void
}

function useAIChat(connectionId: string): UseAIChatReturn
```

**Event listeners:**
- `ai:chunk:{connectionId}` → append to streaming message
- `ai:done:{connectionId}` → finalize message, set isStreaming=false
- `auth:status` → update auth state

---

## 4. Layout Integration

Current layout in `TableExplorer.tsx`:
```
[ExplorerSidebar] | [SqlEditor + ResultsGrid]
```

New layout:
```
[ExplorerSidebar] | [SqlEditor + ResultsGrid] | [AIChatPanel]
```

The AIChatPanel is:
- **Collapsible**: Toggle via button, persisted in `explorerStateCache`
- **Resizable**: Horizontal `ResizeHandle` between main content and chat (reuse existing pattern)
- **Default width**: 350px (collapsed: 0px)
- **Per-connection**: Each connection tab's `TableExplorer` has its own chat state

---

## 5. OpenAI API Details

| Config | Value |
|--------|-------|
| Authorization endpoint | `https://auth0.openai.com/authorize` |
| Token endpoint | `https://auth0.openai.com/oauth/token` |
| API endpoint | `https://api.openai.com/v1/chat/completions` |
| Default model | `gpt-5.3-codex` (user can change) |
| Auth flow | OAuth 2.0 Authorization Code + PKCE |
| Client type | Public (no client_secret) |
| Redirect URI | `http://localhost:{dynamic_port}/callback` |
| Scopes | `openid profile` |
| Streaming | SSE (`stream: true`) |

> **Note**: The exact `client_id` and OAuth endpoints need to be confirmed from OpenAI documentation or by referencing open-source implementations like `openai-auth` or OpenCode.

---

## 6. Edge Cases & Error Handling

| Scenario | Handling |
|----------|----------|
| Token expired mid-chat | Auto-refresh via refresh_token, retry request |
| Refresh token expired | Show "Session expired, please sign in again" |
| No internet | Show "Cannot reach OpenAI API" with retry button |
| User cancels OAuth | Close callback server, show "Sign in cancelled" |
| **Rate limited (429 RPM/TPM)** | Parse `x-ratelimit-reset-requests` header → show countdown “Rate limited, please wait Xs”, auto-retry after reset |
| **Quota exhausted (429 quota)** | Detect `"code": "insufficient_quota"` in error body → show “⚠️ ChatGPT usage limit reached. Please wait or upgrade your plan at openai.com” with direct link |
| **Message cap reached (Plus)** | ChatGPT Plus has message caps per 3-hour window → show “You’ve reached your message limit. Resets in ~Xh Xm” with timer |
| Connection deleted | CASCADE delete chat history via FK |
| Very long schema | Truncate to fit context window (prioritize selected table) |
| User doesn’t have Plus/Pro | Show error from API: “Insufficient subscription” |

### Quota Detection Logic

Go backend parses the 429 response to distinguish rate limit vs quota:

```go
// In AIService.SendMessage() error handling:
if resp.StatusCode == 429 {
    body, _ := io.ReadAll(resp.Body)
    if strings.Contains(string(body), "insufficient_quota") {
        // Quota exhausted — notify user with specific message
        app.Event.Emit("ai:error:{connId}", map[string]interface{}{
            "type":    "quota_exhausted",
            "message": "ChatGPT usage limit reached",
        })
    } else {
        // Rate limited — read reset header, auto-retry
        resetAfter := resp.Header.Get("x-ratelimit-reset-requests")
        app.Event.Emit("ai:error:{connId}", map[string]interface{}{
            "type":       "rate_limited",
            "retryAfter": resetAfter,
        })
    }
}
```

Frontend displays different UI for each:
- **Rate limited**: Progress bar + countdown, auto-retry when timer expires
- **Quota exhausted**: Warning banner with link to openai.com/account

---

## 7. Security Considerations

- OAuth tokens encrypted at rest using existing `crypto.Encrypt` (AES-256-GCM)
- Tokens never sent to frontend — Go proxies all API calls
- Callback HTTP server only accepts from `127.0.0.1`, auto-closes after callback
- PKCE prevents authorization code interception attacks
- Chat history stored locally (never leaves the machine)

---

## 8. File Summary

| File | Type | Description |
|------|------|-------------|
| `services/oauth_service.go` | NEW | OAuth PKCE flow, token management |
| `services/ai_service.go` | NEW | Chat proxy, schema context, streaming |
| `internal/store/store.go` | MODIFY | Add oauth_tokens + chat_history tables |
| `main.go` | MODIFY | Register OAuthService + AIService |
| `frontend/src/components/AIChatPanel.tsx` | NEW | Chat panel UI component |
| `frontend/src/hooks/useAIChat.ts` | NEW | Chat hook with Wails event listeners |
| `frontend/src/pages/TableExplorer.tsx` | MODIFY | Add AIChatPanel to layout |
| `frontend/src/components/EditorTabBar.tsx` | MODIFY | Add AI toggle button |
