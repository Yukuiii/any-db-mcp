# any-db-mcp

English | [简体中文](./README.md)

> An MCP (Model Context Protocol) server that lets LLMs safely operate on databases. Supports **MySQL / PostgreSQL / SQLite / Microsoft SQL Server**.

[![npm version](https://img.shields.io/npm/v/@sakura0v0/any-db-mcp.svg)](https://www.npmjs.com/package/@sakura0v0/any-db-mcp)

## Features

- **Unified adapter**: One tool surface for MySQL, PostgreSQL, SQLite, and MSSQL
- **MCP Resources for schema**: `db://tables` and `db://table/{name}` let clients subscribe to live schema metadata, cutting the per-conversation token cost of repeated describe calls
- **Three permission modes**: `readonly` / `readwrite` / `full`, fixed at startup via env var, **tamper-proof at runtime** (5-layer anti-privilege-escalation design)
- **Transactions**: Batch multi-statement commit in a single tool call, auto-rollback on any failure
- **Connection resilience**: TCP keepalive + automatic pool rebuild & retry on connection loss + health-check tool
- **One-shot table discovery**: `describe_table` returns columns, indexes, estimated row count, and sample rows in a single call — fewer round-trips for the LLM
- **Latency visibility**: every SQL tool returns `elapsedMs` so the LLM can sense performance and adapt
- **Unified JSON responses**: Every tool returns structured JSON for easy LLM parsing
- **Zero deployment**: Single-line `npx` invocation in any MCP client

## Tools Overview

| Tool | Description | Subject to permission mode |
|------|-------------|----------------------------|
| `connect` | Connect to a database; returns table list and current permission mode | No |
| `disconnect` | Close current connection and release the pool (idempotent) | No |
| `connection_status` | Show connection state, ping health, and permission mode | No |
| `query` | Run read-only queries (`SELECT` / `SHOW` / `DESCRIBE` / `EXPLAIN`) | No |
| `execute` | Run a single write statement (DML, or DDL in `full` mode) | Yes |
| `transaction` | Run multiple SQLs in a transaction; any failure triggers rollback | Yes |
| `list_tables` | List all table names in the current connected database | No |
| `describe_table` | Returns columns, indexes, estimated row count, and sample rows in one call | No |
| `explain` | Get a SQL execution plan (does not run the original SQL) | No |

## Permission Modes (PERMISSION_MODE)

| Mode | `query` | `execute` / `transaction` | DDL | Use case |
|------|---------|----------------------------|-----|----------|
| `readonly` | ✓ | ✗ | ✗ | Production queries, data exploration |
| `readwrite` ⭐default | ✓ | ✓ DML (INSERT/UPDATE/DELETE) | ✗ | Regular business operations |
| `full` | ✓ | ✓ DML + DDL | ✓ | Migrations, initialization, schema evolution |

> **Security guarantee**: `PERMISSION_MODE` can only be set via environment variable at server startup. `AppConfig` is deep-frozen with `Object.freeze` after loading, and no tool's `inputSchema` exposes any permission-related fields. This prevents the LLM from escalating privileges via reconnection or any runtime path.

## Quick Start

### Via npx (recommended)

Add to your MCP client configuration:

```json
{
  "mcpServers": {
    "any-db-mcp": {
      "command": "npx",
      "args": ["-y", "@sakura0v0/any-db-mcp"],
      "env": {
        "PERMISSION_MODE": "readwrite",
        "DB_TYPE": "mysql",
        "DB_HOST": "localhost",
        "DB_PORT": "3306",
        "DB_USER": "root",
        "DB_PASSWORD": "your_password",
        "DB_NAME": "your_database"
      }
    }
  }
}
```

### Build from source

```bash
npm install
npm run build
node dist/index.js
```

Corresponding MCP client config:

```json
{
  "mcpServers": {
    "any-db-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/any-db-mcp/dist/index.js"],
      "env": {
        "PERMISSION_MODE": "readwrite"
      }
    }
  }
}
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PERMISSION_MODE` | Permission mode: `readonly` / `readwrite` / `full` | `readwrite` |
| `DB_TYPE` | Database type: `mysql` / `postgresql` / `sqlite` / `mssql` | `mysql` |
| `DB_HOST` | Database host | `localhost` |
| `DB_PORT` | Database port | `3306` (MySQL) / `5432` (PG) / `1433` (MSSQL) |
| `DB_USER` | Database user | `root` |
| `DB_PASSWORD` | Database password | (empty) |
| `DB_NAME` | Default database | (empty) |
| `DB_FILEPATH` | SQLite database file path | (empty) |
| `DB_ENCRYPT` | MSSQL only: enable TLS encryption | `true` |
| `DB_TRUST_SERVER_CERTIFICATE` | MSSQL only: trust self-signed certificate | `false` |

> When no `DB_*` vars are set, the server starts without connecting. The LLM must call the `connect` tool explicitly.

## Connection Examples

Example inputs the LLM passes to the `connect` tool:

### MySQL

```json
{
  "type": "mysql",
  "host": "localhost",
  "port": 3306,
  "user": "root",
  "password": "xxx",
  "database": "mydb"
}
```

### PostgreSQL

```json
{
  "type": "postgresql",
  "host": "localhost",
  "port": 5432,
  "user": "postgres",
  "password": "xxx",
  "database": "mydb"
}
```

### SQLite

```json
{
  "type": "sqlite",
  "filepath": "/path/to/database.db"
}
```

### Microsoft SQL Server

```json
{
  "type": "mssql",
  "host": "localhost",
  "port": 1433,
  "user": "sa",
  "password": "xxx",
  "database": "mydb",
  "encrypt": true,
  "trustServerCertificate": false
}
```

> Wire-compatible databases reuse existing adapters:
>
> - **MariaDB / TiDB / OceanBase** (MySQL wire protocol) → use `type: mysql`
> - **CockroachDB / YugabyteDB** (PostgreSQL wire protocol) → use `type: postgresql`

## Response Format

Every tool returns a unified JSON structure.

**Success**:

```json
{
  "success": true,
  "rowCount": 2,
  "rows": [
    { "id": 1, "name": "Alice" },
    { "id": 2, "name": "Bob" }
  ],
  "elapsedMs": 3
}
```

**Failure** (MCP also sets `isError: true` at the protocol layer):

```json
{
  "success": false,
  "error": "Permission mode is readonly; write operations are not allowed."
}
```

## describe_table Enriched Response

`describe_table` accepts an optional `sampleLimit` (default `3`, `0` disables sampling, max `20`). It returns structure, indexes, estimated row count, and sample rows in one shot:

```json
{
  "success": true,
  "table": "users",
  "columns": [
    { "name": "id", "type": "bigint", "nullable": false, "key": "PRI", "extra": "auto_increment", "defaultValue": null },
    { "name": "email", "type": "varchar(120)", "nullable": false, "key": "UNI", "extra": "", "defaultValue": null }
  ],
  "indexes": [
    { "name": "PRIMARY", "columns": ["id"], "unique": true },
    { "name": "uk_email", "columns": ["email"], "unique": true }
  ],
  "rowCount": 12453,
  "rowCountIsEstimate": true,
  "sampleCount": 3,
  "sample": [
    { "id": 1, "email": "alice@example.com" },
    { "id": 2, "email": "bob@example.com" },
    { "id": 3, "email": "carol@example.com" }
  ],
  "elapsedMs": 12
}
```

**Row-count strategy**:

| Database | Source | `rowCountIsEstimate` | Notes |
|----------|--------|----------------------|-------|
| MySQL | `information_schema.TABLES.TABLE_ROWS` | `true` | InnoDB estimate; avoids a full-table COUNT(*) |
| PostgreSQL | `pg_class.reltuples` | `true` | Depends on ANALYZE; `null` if never analyzed |
| SQLite | `SELECT COUNT(*)` | `false` | Local file, exact value |

## MCP Resources

In addition to tools, the server exposes two MCP Resources so clients can
subscribe to live schema metadata (with `notifications/resources/list_changed`
firing on connect/disconnect):

| URI | Kind | Description |
|-----|------|-------------|
| `db://tables` | Static | All table names + estimated row counts as JSON; lets the LLM size up the database in one read |
| `db://table/{name}` | Dynamic template | Column and index definitions per table; one URI per table, generated from the live connection |

Successful `connect` / `disconnect` calls emit
`notifications/resources/list_changed`; subscribing clients refresh
automatically. Reading `db://tables` while disconnected returns a friendly
`connected: false`; reading a non-existent table returns an `error` field.

> **Resources vs. `list_tables` / `describe_table`**: Resources are
> declarative — clients cache them and reuse across turns, ideal for
> populating context. The tools are imperative — use them when you need the
> very latest state (right after a write) or sample data.

## Transaction Example

LLM calls the `transaction` tool:

```json
{
  "sqls": [
    "UPDATE accounts SET balance = balance - 100 WHERE user_id = 1",
    "UPDATE accounts SET balance = balance + 100 WHERE user_id = 2"
  ]
}
```

If any statement fails, the transaction auto-rolls back and all changes are undone.

## Architecture

```
src/
├── index.ts              Entry: load config → register tools → optional auto-connect → start stdio
├── config.ts             AppConfig and PermissionMode (frozen at load, immutable at runtime)
├── db.ts                 DatabaseManager singleton holding the active Adapter
├── adapters/
│   ├── types.ts          Unified DatabaseAdapter interface
│   ├── mysql.ts          mysql2/promise pool implementation
│   ├── postgresql.ts     pg pool implementation
│   ├── sqlite.ts         better-sqlite3 implementation
│   └── mssql.ts          mssql pool implementation (SHOWPLAN_XML via transaction)
└── tools/
    ├── index.ts          Tool registration entrypoint
    ├── connect.ts        connect tool
    ├── disconnect.ts     disconnect tool
    ├── connection-status.ts connection_status tool
    ├── query.ts          query tool
    ├── execute.ts        execute tool
    ├── transaction.ts    transaction tool
    ├── list-tables.ts    list_tables tool
    ├── describe-table.ts describe_table tool
    ├── explain.ts        explain tool
    ├── resources.ts      MCP Resources (db://tables + db://table/{name})
    ├── permission.ts     Permission check helper
    ├── response.ts       Unified response factory: ok() / fail()
    └── sql-patterns.ts   SQL-type regexes + multi-statement guard
```

## License

MIT
