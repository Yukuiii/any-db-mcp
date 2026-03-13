# db-mcp

让大模型通过 MCP (Model Context Protocol) 操作数据库。支持 MySQL、PostgreSQL、SQLite。

## 功能

| Tool | 说明 |
|------|------|
| `connect` | 动态连接数据库（支持 mysql / postgresql / sqlite） |
| `query` | 执行只读查询（SELECT / SHOW / DESCRIBE / EXPLAIN） |
| `execute` | 执行数据修改（INSERT / UPDATE / DELETE） |
| `list_tables` | 列出所有表 |
| `describe_table` | 查看表结构（列、索引） |
| `list_databases` | 列出所有数据库 |

## 安全特性

- **只读模式**：设置 `READONLY_MODE=true` 禁止所有写操作
- **SQL 类型校验**：`query` 仅允许只读语句，`execute` 仅允许 DML 语句
- **DDL 拦截**：禁止 DROP / TRUNCATE / ALTER / CREATE 等危险操作

## 快速开始

### 安装与编译

```bash
npm install
npm run build
```

### 在 MCP 客户端中使用

```json
{
  "mcpServers": {
    "db-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/db-mcp/dist/index.js"],
      "env": {
        "READONLY_MODE": "false"
      }
    }
  }
}
```

或通过 npx（发布到 npm 后）：

```json
{
  "mcpServers": {
    "db-mcp": {
      "command": "npx",
      "args": ["-y", "db-mcp"]
    }
  }
}
```

### 环境变量预配置（可选）

复制 `.env.example` 为 `.env` 并填写，Server 启动时会自动连接。不配置时通过 `connect` Tool 动态连接。

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `DB_TYPE` | 数据库类型 (mysql/postgresql/sqlite) | mysql |
| `DB_HOST` | 数据库主机 | localhost |
| `DB_PORT` | 数据库端口 | 3306/5432 |
| `DB_USER` | 数据库用户名 | root |
| `DB_PASSWORD` | 数据库密码 | (空) |
| `DB_NAME` | 默认数据库 | (空) |
| `DB_FILEPATH` | SQLite 文件路径 | (空) |
| `READONLY_MODE` | 只读模式 | false |

## 数据库连接示例

### MySQL
LLM 调用 `connect` 工具：`{ "type": "mysql", "host": "localhost", "port": 3306, "user": "root", "password": "xxx", "database": "mydb" }`

### PostgreSQL
LLM 调用 `connect` 工具：`{ "type": "postgresql", "host": "localhost", "port": 5432, "user": "postgres", "password": "xxx", "database": "mydb" }`

### SQLite
LLM 调用 `connect` 工具：`{ "type": "sqlite", "filepath": "/path/to/database.db" }`
