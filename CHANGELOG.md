# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

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

[unreleased]: https://github.com/Yukuiii/any-db-mcp/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Yukuiii/any-db-mcp/releases/tag/v1.0.0
