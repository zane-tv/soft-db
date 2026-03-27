# Changelog

All notable changes to SoftDB will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.0] - 2026-03-27

### Added

- **Redis support** — connect, browse keys by type (string, hash, list, set, zset), execute CLI commands, multi-database switching (DB 0–15)
- **ER diagram** — interactive entity-relationship visualization powered by ELK layout engine
- **Query builder** — visual drag-and-drop query constructor for SELECT, JOIN, WHERE, ORDER BY without writing SQL
- **Schema compare** — diff two database schemas side-by-side to spot structural differences
- **SQL EXPLAIN view** — visualize query execution plans inline
- **SSH tunnel** — secure remote database connections via SSH port forwarding
- **AI provider modules** — pluggable AI backends (OpenAI, Anthropic, Ollama) for the database assistant
- **CI pipeline** — GitHub Actions workflow with Go linting (golangci-lint) and frontend tests (vitest)
- **Comprehensive Go tests** — unit tests for connection, query, edit, schema, settings, import, and update services

### Fixed

- **Sidebar search now filters tables and collections** — previously only matched database names in multi-DB mode (MySQL, MongoDB, PostgreSQL); now searches through table/collection names and auto-expands parent databases on match
- Redis is properly excluded from SQL-specific code paths (query analysis, DROP TABLE)
- Redis key count uses type-aware SCAN instead of SQL COUNT
- MongoDB `executeFind` pagination skip parameter corrected
- Auto-generated connection name no longer overrides manual edits
- TypeScript config now includes Wails JS bindings for proper type checking

### Changed

- Large monolithic components refactored into modular directories:
  - `ConnectionModal` → `ConnectionModal/`
  - `ExplorerSidebar` → `ExplorerSidebar/` (ExplorerSidebar + TreeComponents)
  - `QueryHistoryDrawer` → `QueryHistoryDrawer/` (HistoryItem, SnippetCard, SnippetEditor, helpers)
  - `ResultsGrid` → `ResultsGrid/`
  - `SettingsModal` → `SettingsModal/`
  - `StructureDesignerModal` → `StructureDesignerModal/` (DDLPreviewPanel, SortableColumnRow, types)
- Improved encryption, store, and driver layers across all supported database types
- Redis card color and icon added to Connection Hub

## [1.2.0] - 2025-12-15

### Added

- Database export/import (SQL dump, CSV)
- Drop table with confirmation dialog
- Query analysis and safety checks
- Snippet folders for organizing saved queries
- Structure designer improvements

### Fixed

- MongoDB `executeFind` skip parameter in pagination

## [1.1.5] - 2025-12-01

### Added

- Connection filtering by type and status in Connection Hub and Picker Modal

## [1.1.0] - 2025-11-15

### Added

- Changelog modal with auto-update notifications
- Table explorer sidebar resize
- Date format improvements

### Fixed

- macOS app icon missing in DMG
- Windows installer upload path in CI
- Homebrew tap install command

## [1.0.1] - 2025-10-20

### Fixed

- Initial bug fixes and stability improvements

## [0.1.0] - 2025-10-01

### Added

- Initial release
- PostgreSQL, MySQL, MariaDB, SQLite, MongoDB, Redshift support
- SQL query editor with syntax highlighting
- Table data viewer with pagination
- Connection management with encryption
- Dark/light theme
- Vietnamese and English localization
