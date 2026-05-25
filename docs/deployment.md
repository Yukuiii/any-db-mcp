# 部署配置

## 环境变量总览

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PERMISSION_MODE` | 权限模式 | `readwrite` |
| `DB_TYPE` | 数据库类型 | `mysql` |
| `DB_HOST` | 数据库主机 | `localhost` |
| `DB_PORT` | 数据库端口 | 按类型自动选择 |
| `DB_USER` | 用户名 | `root` |
| `DB_PASSWORD` | 密码 | 空 |
| `DB_NAME` | 数据库名 | 空 |
| `DB_FILEPATH` | SQLite 文件路径 | 空 |
| `DB_ENCRYPT` | MSSQL TLS 加密 | `true` |
| `DB_TRUST_SERVER_CERTIFICATE` | MSSQL 信任自签证书 | `false` |
| `MCP_TRANSPORT` | 传输方式 | `stdio` |
| `MCP_HTTP_HOST` | HTTP 监听主机 | `127.0.0.1` |
| `MCP_HTTP_PORT` | HTTP 监听端口 | `3000` |
| `MCP_HTTP_PATH` | MCP endpoint 路径 | `/mcp` |
| `MCP_AUTH_TOKEN` | Bearer Token | 空（不鉴权） |

不配置 `DB_*` 变量时，server 启动后不自动连接，需 LLM 调用 `connect` 工具手动连接。

## 传输方式

### stdio（默认）

本地 IDE 的最常见集成方式，client 以子进程启动 server，通过标准输入输出通信。

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

### Streamable HTTP

适用于远程访问场景。

**本地开发（无鉴权）：**

```bash
MCP_TRANSPORT=http npx @sakura0v0/any-db-mcp
```

**生产远程访问：**

```bash
MCP_TRANSPORT=http \
MCP_HTTP_HOST=0.0.0.0 \
MCP_HTTP_PORT=3000 \
MCP_AUTH_TOKEN="$(openssl rand -hex 32)" \
npx @sakura0v0/any-db-mcp
```

客户端配置示例：

```json
{
  "mcpServers": {
    "any-db-mcp": {
      "url": "https://your-server.example.com/mcp",
      "headers": {
        "Authorization": "Bearer <your-token>"
      }
    }
  }
}
```

**安全约定：**

- 默认 `MCP_HTTP_HOST=127.0.0.1`，仅本机回环
- 绑 `0.0.0.0` 时务必设置 `MCP_AUTH_TOKEN`
- 生产环境通过反向代理（nginx/caddy）套 TLS
- HTTP body 上限 1MB 防简单 DoS
- Token 比较使用常数时间算法防计时攻击

**Session 管理：**

- 每个 MCP session 对应独立的 `StreamableHTTPServerTransport` + `McpServer` 实例
- 数据库连接池通过 `db` 单例共享（适合单用户远程访问；多用户场景建议每 client 部署独立 server）
- sessionId 由服务端生成，通过 `Mcp-Session-Id` 头返回，客户端后续请求需携带

## 权限模式最佳实践

| 场景 | 推荐模式 |
|------|----------|
| 生产环境数据查询、BI 分析 | `readonly` |
| 日常开发、业务操作（增删改查） | `readwrite` |
| 数据库迁移、Schema 变更 | `full` |

**不可在运行时切换权限模式**，这是刻意设计的安全约束。

## 本地源码部署

```bash
git clone https://github.com/Yukuiii/any-db-mcp.git
cd any-db-mcp
npm install
npm run build
node dist/index.js
```

对应客户端配置：

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

## npx 零部署

无需克隆仓库，直接在客户端配置中使用 npx：

```json
{
  "mcpServers": {
    "any-db-mcp": {
      "command": "npx",
      "args": ["-y", "@sakura0v0/any-db-mcp"],
      "env": {
        "PERMISSION_MODE": "readwrite",
        "DB_TYPE": "postgresql",
        "DB_HOST": "localhost",
        "DB_PORT": "5432",
        "DB_USER": "postgres",
        "DB_PASSWORD": "your_password",
        "DB_NAME": "your_database"
      }
    }
  }
}
```
