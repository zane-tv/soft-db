<p align="center">
  <img src="build/appicon.png" width="128" height="128" alt="SoftDB Logo" />
</p>

<h1 align="center">SoftDB</h1>

<p align="center">
  <strong>Modern Database Management Tool</strong><br/>
  Connect, explore, and manage your databases with a beautiful cross-platform desktop app.
</p>

<p align="center">
  <a href="https://github.com/zane-tv/soft-db/releases"><img src="https://img.shields.io/github/v/release/zane-tv/soft-db?style=flat-square&color=blue" alt="Release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/zane-tv/soft-db?style=flat-square" alt="License" /></a>
  <a href="https://github.com/zane-tv/soft-db/releases"><img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey?style=flat-square" alt="Platform" /></a>
</p>

---

## ✨ Features

- 🗄️ **Multi-Database Support** — PostgreSQL, MySQL, MariaDB, SQLite, MongoDB, Redshift
- 🔀 **Multi-Database Browsing** — Browse all databases on a server with a 3-level tree (Connection → Database → Tables)
- 🤖 **AI Assistant** — Built-in ChatGPT-powered chatbot with DB schema context, streaming responses, and per-connection chat history
- 📝 **Monaco SQL Editor** — Syntax highlighting, dynamic column autocomplete, multi-tab queries
- 🔍 **Visual Table Explorer** — Browse schemas, tables, and columns with virtualized data grid
- 🏗️ **Structure Designer** — Create and modify tables visually; MongoDB gets a native JSON Schema Validation editor
- 🔗 **Multi-Connection Tabs** — Work with multiple databases side-by-side
- ⚙️ **Connection Manager** — Save, organize, and quick-connect with AES-256-GCM encrypted credentials
- 🖥️ **Custom App Bar** — Frameless window with custom title bar and window controls
- 🌙 **Dark Mode** — Beautiful dark UI designed for long coding sessions
- 🔒 **Security First** — Parameterized queries, encrypted credential storage, OAuth PKCE authentication

## 🗃️ Supported Databases

| Database | Status | Multi-DB Browsing |
|----------|--------|-------------------|
| PostgreSQL | ✅ Full support | ✅ |
| MySQL | ✅ Full support | ✅ |
| MariaDB | ✅ Full support | ✅ |
| SQLite | ✅ Full support | — (single file) |
| MongoDB | ✅ Full support | ✅ |
| Redshift | ✅ Full support | ✅ |

## 🤖 AI Assistant

SoftDB includes a built-in AI chat assistant powered by OpenAI:

- **DB-aware context** — Automatically injects your schema (tables, columns, types) into the AI prompt
- **Multi-model** — Choose from GPT-5.3 Codex (default, optimized for SQL), GPT-5.4, GPT-5, GPT-5 Mini, o4-mini, and more
- **Streaming** — Real-time response streaming via Wails events
- **Per-connection isolation** — Each connection tab has its own chat history

## 🚀 Quick Start

### Download

Download the latest release for your platform from the [Releases page](https://github.com/zane-tv/soft-db/releases).

| Platform | Download | Notes |
|----------|----------|-------|
| **Windows** | `SoftDB-amd64-installer.exe` | NSIS installer with shortcuts & uninstaller |
| **macOS (Apple Silicon)** | `SoftDB-darwin-arm64.tar.gz` | `.app` bundle — extract and drag to Applications |
| **macOS (Intel)** | `SoftDB-darwin-amd64.tar.gz` | `.app` bundle |
| **Linux** | `SoftDB-linux-amd64.AppImage` | Portable — `chmod +x` and run |
| **Linux (Debian/Ubuntu)** | `SoftDB-linux-amd64.deb` | `sudo dpkg -i SoftDB-linux-amd64.deb` |

### Verify Downloads

All release binaries are signed with [Sigstore](https://sigstore.dev) for supply chain security. Each file has a corresponding `.bundle` signature file.

```bash
# Install cosign
brew install cosign          # macOS
# or: go install github.com/sigstore/cosign/v2/cmd/cosign@latest

# Verify any downloaded file
cosign verify-blob SoftDB-amd64-installer.exe \
  --bundle SoftDB-amd64-installer.exe.bundle \
  --certificate-identity-regexp "https://github.com/zane-tv/soft-db" \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com

# Or use the helper script
./scripts/verify-release.sh SoftDB-amd64-installer.exe
```

### Build from Source

**Prerequisites:**
- [Go](https://golang.org/dl/) 1.22+
- [Bun](https://bun.sh/) (or Node.js 18+)
- [Wails CLI v3](https://v3.wails.io/getting-started/installation/)

```bash
# Clone the repository
git clone https://github.com/zane-tv/soft-db.git
cd soft-db

# Development mode (hot-reload)
wails3 dev
# or
./dev.sh

# Production build
wails3 build
```

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Desktop Runtime** | [Wails v3](https://v3.wails.io/) (Go + WebView) |
| **Backend** | Go 1.22+ |
| **Frontend** | React 19 + TypeScript + Vite |
| **SQL Editor** | Monaco Editor |
| **Routing** | TanStack Router |
| **State** | TanStack Query |
| **Styling** | Tailwind CSS |
| **Encryption** | AES-256-GCM (credentials & OAuth tokens) |
| **AI** | OpenAI Codex API |

## 📁 Project Structure

```
soft-db/
├── main.go                  # App entry point, service wiring
├── services/                # Go backend services
│   ├── connection_service   # Connection lifecycle & pooling
│   ├── query_service        # Query execution (parameterized)
│   ├── schema_service       # Schema introspection & multi-DB
│   ├── edit_service         # CRUD operations on table data
│   ├── settings_service     # User preferences
│   ├── ai_service           # AI chat proxy with streaming
│   └── oauth_service        # OAuth 2.0 PKCE for ChatGPT
├── internal/
│   ├── driver/              # Database drivers (Postgres, MySQL, SQLite, MongoDB, Redshift)
│   ├── store/               # Local SQLite store (connections, settings, chat history, OAuth tokens)
│   └── crypto/              # AES-256-GCM encryption for credentials
├── frontend/
│   ├── src/
│   │   ├── pages/           # ConnectionHub, TableExplorer, WorkspacePage
│   │   ├── components/      # AppBar, SqlEditor, ResultsGrid, AIChatPanel, MongoSchemaEditor, ...
│   │   ├── hooks/           # useConnections, useSchema, useAIChat, useEditableGrid, useTheme
│   │   ├── routes/          # TanStack Router config
│   │   └── lib/             # Utilities
│   └── ...
├── docs/plans/              # Design documents
└── build/                   # Build config, icons, platform assets
```

## 🔒 Security

- **Encrypted credentials** — Connection passwords and OAuth tokens encrypted with AES-256-GCM using machine-derived keys
- **Parameterized queries** — All mutation queries use parameterized statements to prevent SQL injection
- **OAuth PKCE** — No client secrets; authorization codes protected by PKCE challenge
- **Local-only callback** — OAuth redirect server only accepts connections from `127.0.0.1`
- **Tokens never exposed** — AI/OAuth tokens managed entirely in Go backend, never sent to frontend

## ⭐ Star History

[![Star History Chart](https://api.star-history.com/svg?repos=zane-tv/soft-db&type=Date)](https://star-history.com/#zane-tv/soft-db&Date)

## 📄 License

[MIT](LICENSE) — Made with ❤️ by [Zane](https://github.com/zane-tv)
