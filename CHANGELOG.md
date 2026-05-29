# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- **Schema-aware PostgreSQL/MSSQL discovery**: when `connect.schema` / `DB_SCHEMA` is empty, table discovery now scans all non-system schemas; when set, table listing, description, row-count estimation, and sampling are scoped to that schema.
- **Schema-qualified metadata**: `tables[]`, `search_schema`, `describe_table`, and `db://tables` responses now include `schema`, and `db://table/{schema}/{name}` is available for schema-qualified resources.

## [1.2.2] — 2026-05-29

### Breaking Changes

- **Structured table discovery responses**: `list_tables`, `connect`, and connected `connection_status` responses now return `tables` as `{ name, comment }[]` instead of `string[]`.

### Added

- **Table comments in table discovery**: `tables[].comment` exposes native table comments when available.
- **Schema comment metadata**: `describe_table` column entries now include `comment`, sourced from MySQL column comments, PostgreSQL `col_description`, and MSSQL `MS_Description`.
- **`db://tables` comments**: the table-list resource now includes each table's `comment` alongside row-count metadata.

### Fixed

- **PostgreSQL partitioned tables**: `listTables()` now includes partitioned table parents (`relkind = 'p'`) instead of only ordinary tables.

## [1.2.1] — 2026-05-29

### Added

- **`connection_status` table discovery**: connected responses now include `tableCount` and `tables`, so clients using startup database configuration can discover available tables without calling `connect`.

## [1.2.0] — 2026-05-26

### Added

- **`search_schema` tool**: keyword search across table names, column names, and column types to quickly locate relevant tables/fields in large schemas.
- **`QUERY_TIMEOUT_MS` configuration**: the `query` tool now fails fast when execution exceeds the configured timeout (default 30000ms).
- **Query result cap**: `query` responses return at most the first 1000 rows, exposing `limit` and `truncated` fields for visibility.
- **Docker support**: multi-stage Dockerfile and docker-compose for containerized deployment.
- **Documentation**: architecture, tools, adapter-extension, and deployment guides.

### Changed

- **`search_schema` performance**: tables are now described in parallel (throttled by the connection pool) instead of serially, significantly reducing latency on large databases.
- **Server version**: now read from `package.json` at runtime instead of being hardcoded.
- Internal restructure: tools, utilities, and resources split into distinct directories.

### Fixed

- Routed `EXPLAIN`-prefixed statements away from the `query` tool to the dedicated `explain` tool.

## [1.1.0] — 2026-05-25

### Added

- Foreign key relationship discovery in `describe_table` tool, enabling LLMs to write correct JOINs without guessing column associations.

## [1.0.0] — 2026-05-25

### Added

- **4 database adapters**: MySQL, PostgreSQL, SQLite, MSSQL with unified tool interface.
- **9 MCP tools**: `connect`, `disconnect`, `connection_status`, `query`, `execute`, `transaction`, `list_tables`, `describe_table`, `explain`.
- **MCP Resources**: `db://tables` and `db://table/{name}` for schema browsing.
- **3 permission modes**: `readonly`, `readwrite`, `full`, fixed at startup via env var with 5-layer anti-privilege-escalation design.
- **Dual transport**: `stdio` for local subprocess and `Streamable HTTP` for remote access with stateful sessions and optional Bearer Token authentication.
- **Transaction support**: Batch multi-statement execution with atomic commit and auto-rollback on failure.
- **Connection resilience**: TCP keepalive, automatic pool rebuild and retry on connection loss, health-check tool.
- **describe_table enrichment**: Returns column definitions, indexes, row count estimation, and sample data in a single call.
- **Multi-statement SQL rejection**: Prevents DDL bypass attacks by rejecting multi-statement SQL input.
- **Execution plan analysis**: `explain` tool for query performance analysis across all 4 database types.
- **Unified structured responses**: All tools return consistent JSON with `elapsedMs` for latency visibility.
- **Zero-deployment**: Single-line `npx` invocation in any MCP client.

[unreleased]: https://github.com/Yukuiii/any-db-mcp/compare/v1.2.2...HEAD
[1.2.2]: https://github.com/Yukuiii/any-db-mcp/compare/v1.2.1...v1.2.2
[1.2.1]: https://github.com/Yukuiii/any-db-mcp/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/Yukuiii/any-db-mcp/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/Yukuiii/any-db-mcp/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Yukuiii/any-db-mcp/releases/tag/v1.0.0
