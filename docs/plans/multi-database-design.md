# Multi-Database Connection Support — Design Document

> **Approved:** 2026-03-11
> **Approach:** Phương án 2 — Parallel Method (MultiDatabaseDriver interface)

## Problem

Hiện tại mỗi connection chỉ hỗ trợ 1 database duy nhất. User không thể:
- Xem tất cả databases trên 1 MongoDB server
- Chuyển đổi giữa các databases trong cùng 1 connection
- Query cross-database

## Requirements

| # | Requirement | Choice |
|---|------------|--------|
| 1 | Scope | Tất cả DB types (MongoDB, MySQL, PostgreSQL, Redshift). SQLite excluded. |
| 2 | Sidebar UX | 3-level tree: Connection → Database → Tables/Collections |
| 3 | Connection Modal | Giữ "Database" field nhưng optional. Nếu trống → list tất cả DBs |
| 4 | Query execution | Mỗi query tab có dropdown chọn database riêng |

## Architecture

### New Interface: `MultiDatabaseDriver`

```go
// MultiDatabaseDriver extends Driver with multi-database capabilities.
// Drivers that support browsing multiple databases implement this interface
// alongside the base Driver interface.
type MultiDatabaseDriver interface {
    // Databases returns all databases on the connected server
    Databases(ctx context.Context) ([]DatabaseInfo, error)
    // TablesInDB returns tables for a specific database
    TablesInDB(ctx context.Context, database string) ([]TableInfo, error)
    // ColumnsInDB returns columns for a table in a specific database
    ColumnsInDB(ctx context.Context, database string, table string) ([]ColumnInfo, error)
    // SwitchDatabase changes the active database for query execution
    SwitchDatabase(ctx context.Context, database string) error
}

type DatabaseInfo struct {
    Name       string `json:"name"`
    SizeBytes  int64  `json:"sizeBytes,omitempty"`
    Empty      bool   `json:"empty,omitempty"`
}
```

### Driver Implementation Matrix

| Driver | Implements MultiDatabaseDriver | Method |
|--------|-------------------------------|--------|
| MongoDriver | ✅ | `client.ListDatabases()` |
| MySQLDriver | ✅ | `SHOW DATABASES` |
| PostgresDriver | ✅ | `SELECT datname FROM pg_database` |
| RedshiftDriver | ✅ | `SELECT datname FROM pg_database` |
| SQLiteDriver | ❌ | Single file = single DB |

### Data Flow

```
User connects (Database field empty)
    → driver.Connect() with empty dbName
    → Frontend calls SchemaService.HasMultiDB(connId)
    → if true: calls SchemaService.GetDatabases(connId)
    → Sidebar renders 3-level tree

User expands database node
    → SchemaService.GetTablesForDB(connId, dbName)
    → Tables render under database node

User selects query tab database
    → SchemaService.SwitchDatabase(connId, dbName)
    → Subsequent queries run against selected DB

User clicks table in sidebar
    → Auto-sets query tab's DB to that table's parent DB
    → Generates SELECT query
```

### Frontend Changes

1. **ExplorerSidebar**: Add `DatabaseNode` component between connection header and tables
2. **QueryTab toolbar**: Add database picker dropdown
3. **ConnectionModal**: Make "Database" field optional with hint text
4. **useSchema hook**: Add `useDatabases(connId)`, update `useTables` to accept optional `dbName`

### Backend Changes

1. **driver/driver.go**: Add `MultiDatabaseDriver` interface + `DatabaseInfo` struct
2. **driver/mongodb.go**: Implement `MultiDatabaseDriver` methods
3. **driver/mysql.go**: Implement `MultiDatabaseDriver` methods
4. **driver/postgres.go**: Implement `MultiDatabaseDriver` methods
5. **driver/redshift.go**: Implement `MultiDatabaseDriver` methods
6. **services/schema_service.go**: Add `HasMultiDB()`, `GetDatabases()`, `GetTablesForDB()`, `GetColumnsForDB()`, `SwitchDatabase()`
7. **services/query_service.go**: Support database context per query

### Edge Cases

- **Empty database field + SQLite**: Fallback to existing behavior (single DB from file)
- **MongoDB without auth**: Some system DBs (admin, local, config) should be filterable
- **PostgreSQL schemas**: databases ≠ schemas. List databases, each DB has schemas, each schema has tables — keep it 3-level (DB → Tables in public schema), PostgreSQL schemas as future enhancement
- **Connection with pre-set database**: If user fills "Database" field → connect to that DB only, sidebar shows flat tree (backward compatible)
