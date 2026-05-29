# any-db-mcp

[English](./README.en.md) | 简体中文

> 让大模型通过 MCP (Model Context Protocol) 安全地操作数据库。支持 **MySQL / PostgreSQL / SQLite / Microsoft SQL Server**。

[![npm version](https://img.shields.io/npm/v/@sakura0v0/any-db-mcp.svg)](https://www.npmjs.com/package/@sakura0v0/any-db-mcp)

## 特性

- **统一适配**：MySQL / PostgreSQL / SQLite / MSSQL 四种数据库共用同一套工具接口
- **双传输模式**:`stdio` 本地子进程 + `Streamable HTTP` 远程,后者带 stateful session 与可选 Bearer Token 鉴权
- **MCP Resources 暴露 schema**:`db://tables` 与 `db://table/{name}` 让客户端主动消化库结构,大幅减少每次对话重复 describe 的 token 开销
- **三档权限模式**：`readonly` / `readwrite` / `full`，启动时由环境变量决定，**运行时不可篡改**（5 层防 LLM 提权设计）
- **事务支持**：单工具批量提交，任一失败自动回滚
- **连接弹性**：TCP keepalive + 连接丢失自动重建并重试 + 健康检查工具
- **一次调研到位**：`describe_table` 一次返回列定义、索引、行数估算、数据采样，减少 LLM 来回试探
- **响应耗时透明**：所有 SQL 类工具返回 `elapsedMs`，便于 LLM 感知性能并调整策略
- **统一 JSON 响应**：所有工具返回结构化 JSON，便于 LLM 解析
- **零部署**：通过 `npx` 一行命令即可在任意 MCP 客户端中使用

## 工具一览

| Tool | 说明 | 受权限模式约束 |
|------|------|----------------|
| `connect` | 动态连接数据库，返回当前数据库的表信息列表与权限模式 | 否 |
| `disconnect` | 主动断开连接并释放连接池（幂等） | 否 |
| `connection_status` | 查看当前连接状态、ping 健康度、表信息列表与权限模式 | 否 |
| `query` | 执行只读查询（`SELECT` / `SHOW` / `DESCRIBE`），响应最多返回前 1000 行 | 否 |
| `execute` | 执行单条写操作（DML，或 `full` 模式下 DDL） | ✓ |
| `transaction` | 在事务中顺序执行多条 SQL，任一失败回滚 | ✓ |
| `list_tables` | 列出当前连接数据库的所有表名与表注释 | 否 |
| `describe_table` | 一次返回指定表的列定义、索引、估算行数与数据采样 | 否 |
| `search_schema` | 按关键词搜索表名、列名和字段类型 | 否 |
| `explain` | 获取 SQL 执行计划（不实际执行原 SQL），辅助优化 | 否 |

## 权限模式（PERMISSION_MODE）

| Mode | `query` | `execute` / `transaction` | DDL | 适用场景 |
|------|---------|----------------------------|-----|----------|
| `readonly` | ✓ | ✗ | ✗ | 生产环境查询、数据探索 |
| `readwrite` ⭐默认 | ✓ | ✓ DML（INSERT/UPDATE/DELETE） | ✗ | 常规业务操作 |
| `full` | ✓ | ✓ DML + DDL | ✓ | 迁移、初始化、Schema 演进 |

> **安全保证**：`PERMISSION_MODE` 只能在 server 启动时通过环境变量设定。`AppConfig` 在加载后被 `Object.freeze` 深冻结，且任何工具的 `inputSchema` 都不暴露权限相关参数，杜绝 LLM 通过"重连提权"等手段绕过限制。

## 快速开始

### 通过 npx 使用（推荐）

在 MCP 客户端配置中添加：

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

### 本地源码运行

```bash
npm install
npm run build
node dist/index.js
```

对应 MCP 客户端配置：

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

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PERMISSION_MODE` | 权限模式：`readonly` / `readwrite` / `full` | `readwrite` |
| `DB_TYPE` | 数据库类型：`mysql` / `postgresql` / `sqlite` / `mssql` | `mysql` |
| `DB_HOST` | 数据库主机 | `localhost` |
| `DB_PORT` | 数据库端口 | `3306`（MySQL）/ `5432`（PG）/ `1433`（MSSQL） |
| `DB_USER` | 数据库用户名 | `root` |
| `DB_PASSWORD` | 数据库密码 | （空） |
| `DB_NAME` | 默认数据库 | （空） |
| `DB_FILEPATH` | SQLite 数据库文件路径 | （空） |
| `DB_ENCRYPT` | 仅 MSSQL：是否启用 TLS 加密 | `true` |
| `DB_TRUST_SERVER_CERTIFICATE` | 仅 MSSQL：是否信任自签证书 | `false` |
| `QUERY_TIMEOUT_MS` | `query` 工具响应超时时间（ms） | `30000` |
| `MCP_TRANSPORT` | 传输方式:`stdio`(默认) / `http` | `stdio` |
| `MCP_HTTP_HOST` | 仅 http:监听主机,公网暴露请显式设 `0.0.0.0` 并配 token | `127.0.0.1` |
| `MCP_HTTP_PORT` | 仅 http:监听端口 | `3000` |
| `MCP_HTTP_PATH` | 仅 http:MCP endpoint 路径 | `/mcp` |
| `MCP_AUTH_TOKEN` | 仅 http:可选 Bearer Token,设置后所有请求需带 `Authorization: Bearer <token>` | （空,不鉴权） |

> 不配置 `DB_*` 时，Server 启动后不自动连接，需 LLM 主动调用 `connect` 工具。

## 数据库连接示例

LLM 调用 `connect` 工具时的入参示例：

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

> 协议兼容数据库可直接复用现有适配器:
>
> - **MariaDB / TiDB / OceanBase** 等 MySQL 协议兼容数据库 → 选 `type: mysql`
> - **CockroachDB / YugabyteDB** 等 PG 协议兼容数据库 → 选 `type: postgresql`

## 传输方式 (Transport)

支持两种 transport,通过 `MCP_TRANSPORT` 切换。

### `stdio` (默认)

最常见的本地集成方式,client 以子进程方式启动 server,通过标准输入输出通信。无需端口/网络,Claude Code、Cursor 等 IDE 默认走这条路径。

### `Streamable HTTP`

按 [MCP spec 2025-03-26](https://modelcontextprotocol.io/specification/2025-03-26) 实现:`POST /mcp` 接收 JSON-RPC,响应可为 JSON 或 SSE 流;`GET /mcp` 用于建立长连接接收 server-initiated 消息;`DELETE /mcp` 关闭 session。每个 session 由服务端生成 `Mcp-Session-Id` 头并返回,客户端后续请求需带回。

```bash
# 本地开发:监听 127.0.0.1,无鉴权
MCP_TRANSPORT=http npx @sakura0v0/any-db-mcp

# 远程访问:绑 0.0.0.0 + Bearer Token + 反向代理 TLS
MCP_TRANSPORT=http \
MCP_HTTP_HOST=0.0.0.0 \
MCP_HTTP_PORT=3000 \
MCP_AUTH_TOKEN="$(openssl rand -hex 32)" \
npx @sakura0v0/any-db-mcp
```

**安全约定**:
- 默认 `MCP_HTTP_HOST=127.0.0.1`,只接受本机回环。生产远程访问务必同时设置 `MCP_AUTH_TOKEN` 并通过反向代理(nginx / caddy)套 TLS。
- 设置 `MCP_AUTH_TOKEN` 后所有请求需带 `Authorization: Bearer <token>`,使用常数时间比较抵御计时攻击。
- HTTP 请求 body 上限 1 MB,防止简单 DoS。
- 多 session 共享 `db` 单例数据库连接池:适合"个人远程访问",多用户场景应每 client 部署独立 server。

## 响应格式

所有工具返回统一的 JSON 结构。

**成功响应**：

```json
{
  "success": true,
  "rowCount": 2,
  "limit": 1000,
  "truncated": false,
  "timeoutMs": 30000,
  "rows": [
    { "id": 1, "name": "Alice" },
    { "id": 2, "name": "Bob" }
  ],
  "elapsedMs": 3
}
```

**失败响应**（MCP 协议层会同时设置 `isError: true`）：

```json
{
  "success": false,
  "error": "当前权限模式为 readonly，禁止任何写操作。"
}
```

### 表信息列表响应

`list_tables`、`connect` 和已连接状态下的 `connection_status` 都会返回 `tableCount` 与
`tables`。`tables` 是结构化表信息数组，不是字符串数组：

```json
{
  "success": true,
  "tableCount": 2,
  "tables": [
    { "name": "users", "comment": "系统用户" },
    { "name": "orders", "comment": null }
  ],
  "elapsedMs": 4
}
```

`comment` 来自数据库原生表注释；无注释或 SQLite 这类无原生表注释的数据库返回 `null`。

## search_schema 快速定位

`search_schema` 可按关键词搜索当前库的表名、列名和字段类型，适合大库中先定位相关表字段再调用 `describe_table`。响应最多返回前 50 个命中项，并带 `failedTables` 说明个别表结构读取失败的情况。

```json
{
  "keyword": "email"
}
```

## describe_table 增强响应

调用 `describe_table` 时可传入 `sampleLimit`（默认 3，0 表示不采样，最大 20）。响应一次性返回结构、索引、行数估算与采样数据：

```json
{
  "success": true,
  "table": "users",
  "columns": [
    { "name": "id", "type": "bigint", "nullable": false, "key": "PRI", "extra": "auto_increment", "defaultValue": null, "comment": "用户 ID" },
    { "name": "email", "type": "varchar(120)", "nullable": false, "key": "UNI", "extra": "", "defaultValue": null, "comment": "邮箱地址" }
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

**行数估算策略**：

| 数据库 | 数据源 | `rowCountIsEstimate` | 备注 |
|--------|--------|----------------------|------|
| MySQL | `information_schema.TABLES.TABLE_ROWS` | `true` | InnoDB 估算，避免 COUNT(*) 全表扫描 |
| PostgreSQL | `pg_class.reltuples` | `true` | 依赖 ANALYZE，从未分析时为 `null` |
| SQLite | `SELECT COUNT(*)` | `false` | 本地文件，精确值 |

## MCP Resources

除工具外,server 还暴露两个 MCP Resource,让客户端可以主动订阅库结构(配合
`notifications/resources/list_changed`,连接切换时自动刷新):

| URI | 类型 | 说明 |
|-----|------|------|
| `db://tables` | 静态 | 当前库的所有表名 + 表注释 + 估算行数,JSON 格式,适合 LLM 一次摸清规模量级 |
| `db://table/{name}` | 动态模板 | 单表的列定义与索引,每张表自动一个 URI(由 server 根据当前库动态生成) |

`connect` / `disconnect` 成功后会发送 `notifications/resources/list_changed`,
支持订阅的客户端会自动刷新可用资源列表。未连接时读 `db://tables` 返回 `connected: false`
的友好提示,读不存在的表返回 `error` 字段。

`db://tables` 返回示例：

```json
{
  "connected": true,
  "databaseType": "mysql",
  "tableCount": 2,
  "tables": [
    {
      "table": "users",
      "comment": "系统用户",
      "rowCount": 12453,
      "rowCountIsEstimate": true
    },
    {
      "table": "orders",
      "comment": null,
      "rowCount": 98210,
      "rowCountIsEstimate": true
    }
  ]
}
```

> 与 `list_tables` / `describe_table` 工具的区别:Resources 是"声明式订阅",由客户端缓存并复用,
> 适合放进每次对话的上下文;Tools 是"命令式调用",适合需要最新数据(如刚做完写入)或需要采样数据时。

## 事务示例

LLM 调用 `transaction` 工具：

```json
{
  "sqls": [
    "UPDATE accounts SET balance = balance - 100 WHERE user_id = 1",
    "UPDATE accounts SET balance = balance + 100 WHERE user_id = 2"
  ]
}
```

任一语句失败，事务自动回滚，所有改动撤销。

## 架构

```
src/
├── index.ts              入口：加载配置 → 注册工具 → 可选自动连接 → 按 transport 启动
├── transport.ts          stdio + Streamable HTTP 启动器(stateful session + Bearer)
├── config.ts             AppConfig 与 PermissionMode（启动后冻结，运行时不可改）
├── db.ts                 DatabaseManager 单例，持有当前 Adapter
├── adapters/
│   ├── types.ts          DatabaseAdapter 统一接口
│   ├── mysql.ts          mysql2/promise 连接池实现
│   ├── postgresql.ts     pg 连接池实现
│   ├── sqlite.ts         better-sqlite3 实现
│   └── mssql.ts          mssql 连接池实现(SHOWPLAN_XML via transaction)
└── tools/
    ├── index.ts          所有 Tools 注册入口
    ├── connect.ts        connect 工具
    ├── disconnect.ts     disconnect 工具
    ├── connection-status.ts connection_status 工具
    ├── query.ts          query 工具
    ├── execute.ts        execute 工具
    ├── transaction.ts    transaction 工具
    ├── list-tables.ts    list_tables 工具
    ├── describe-table.ts describe_table 工具
    ├── search-schema.ts  search_schema 工具
    ├── explain.ts        explain 工具
    ├── resources.ts      MCP Resources(db://tables + db://table/{name})
    ├── permission.ts     权限检查 helper
    ├── response.ts       统一响应工厂 ok() / fail()
    └── sql-patterns.ts   SQL 类型正则 + 多语句拦截
```

## License

MIT
