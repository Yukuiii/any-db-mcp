# any-db-mcp

[English](./README.en.md) | 简体中文

> 让大模型通过 MCP (Model Context Protocol) 安全地操作数据库。支持 **MySQL / PostgreSQL / SQLite**。

[![npm version](https://img.shields.io/npm/v/@sakura0v0/any-db-mcp.svg)](https://www.npmjs.com/package/@sakura0v0/any-db-mcp)

## 特性

- **统一适配**：MySQL / PostgreSQL / SQLite 三种数据库共用同一套工具接口
- **三档权限模式**：`readonly` / `readwrite` / `full`，启动时由环境变量决定，**运行时不可篡改**（5 层防 LLM 提权设计）
- **事务支持**：单工具批量提交，任一失败自动回滚
- **连接弹性**：TCP keepalive + 连接丢失自动重建并重试 + 健康检查工具
- **统一 JSON 响应**：所有工具返回结构化 JSON，便于 LLM 解析
- **零部署**：通过 `npx` 一行命令即可在任意 MCP 客户端中使用

## 工具一览

| Tool | 说明 | 受权限模式约束 |
|------|------|----------------|
| `connect` | 动态连接数据库，返回当前数据库的表名列表与权限模式 | 否 |
| `disconnect` | 主动断开连接并释放连接池（幂等） | 否 |
| `connection_status` | 查看当前连接状态、ping 健康度与权限模式 | 否 |
| `query` | 执行只读查询（`SELECT` / `SHOW` / `DESCRIBE` / `EXPLAIN`） | 否 |
| `execute` | 执行单条写操作（DML，或 `full` 模式下 DDL） | ✓ |
| `transaction` | 在事务中顺序执行多条 SQL，任一失败回滚 | ✓ |
| `list_tables` | 列出当前连接数据库的所有表名 | 否 |
| `describe_table` | 查看指定表的列定义与索引详情 | 否 |
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
| `DB_TYPE` | 数据库类型：`mysql` / `postgresql` / `sqlite` | `mysql` |
| `DB_HOST` | 数据库主机 | `localhost` |
| `DB_PORT` | 数据库端口 | `3306`（MySQL）/ `5432`（PG） |
| `DB_USER` | 数据库用户名 | `root` |
| `DB_PASSWORD` | 数据库密码 | （空） |
| `DB_NAME` | 默认数据库 | （空） |
| `DB_FILEPATH` | SQLite 数据库文件路径 | （空） |

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

## 响应格式

所有工具返回统一的 JSON 结构。

**成功响应**：

```json
{
  "success": true,
  "rowCount": 2,
  "rows": [
    { "id": 1, "name": "Alice" },
    { "id": 2, "name": "Bob" }
  ]
}
```

**失败响应**（MCP 协议层会同时设置 `isError: true`）：

```json
{
  "success": false,
  "error": "当前权限模式为 readonly，禁止任何写操作。"
}
```

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
├── index.ts              入口：加载配置 → 注册工具 → 可选自动连接 → stdio 启动
├── config.ts             AppConfig 与 PermissionMode（启动后冻结，运行时不可改）
├── db.ts                 DatabaseManager 单例，持有当前 Adapter
├── adapters/
│   ├── types.ts          DatabaseAdapter 统一接口
│   ├── mysql.ts          mysql2/promise 连接池实现
│   ├── postgresql.ts     pg 连接池实现
│   └── sqlite.ts         better-sqlite3 实现
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
    ├── explain.ts        explain 工具
    ├── permission.ts     权限检查 helper
    ├── response.ts       统一响应工厂 ok() / fail()
    └── sql-patterns.ts   SQL 类型正则
```

## License

MIT
