# 架构设计

## 分层架构

```
MCP Client (LLM)
    │  [MCP Protocol - JSON-RPC]
    v
src/transport.ts          ← 传输层：stdio / Streamable HTTP
    │
    v
src/tools/index.ts        ← 工具注册与分发
    │
    v
src/tools/{tool}.ts       ← 各工具实现
    │
    ├── src/utils/permission.ts   ← 权限校验
    └── src/utils/sql-patterns.ts ← SQL 类型检测 + 多语句拦截
    │
    v
src/db.ts                 ← DatabaseManager 单例
    │
    v
src/adapters/{type}.ts    ← 数据库适配器
    │
    v
Target Database
```

## 核心模块

### 配置模块 (`config.ts`)

`AppConfig` 从环境变量加载，加载后通过 `Object.freeze` 深冻结。关键设计：

- 权限模式 `PermissionMode` 只能在启动时通过 `PERMISSION_MODE` 环境变量设定
- 配置对象冻结后运行时任何修改尝试在严格模式下会抛错
- 工具的 `inputSchema` 不暴露权限相关参数，LLM 无法通过重连提权

### 数据库管理器 (`db.ts`)

`DatabaseManager` 是单例，持有当前 `DatabaseAdapter` 实例。职责：

- 代理所有数据库操作到当前适配器
- `connectWith` 方法切换适配器时自动断开旧连接
- 提供 `isConnected` / `getType` 查询连接状态

### 传输层 (`transport.ts`)

提供两种 MCP 传输方式，通过 `MCP_TRANSPORT` 环境变量切换：

- **stdio**：标准输入输出，适用于本地 IDE 子进程场景
- **Streamable HTTP**：按 MCP spec 2025-03-26 实现
  - `POST /mcp` 接收 JSON-RPC，响应为 JSON 或 SSE 流
  - `GET /mcp` 建立长连接接收 server-initiated 消息
  - `DELETE /mcp` 关闭 session
  - 支持可选 Bearer Token 鉴权（常数时间比较防计时攻击）
  - HTTP body 上限 1MB 防 DoS
  - 多 session 共享 `db` 单例

### 适配器模式 (`adapters/`)

```typescript
interface DatabaseAdapter {
  readonly type: DatabaseType;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  ping(): Promise<void>;
  query(sql: string): Promise<Record<string, unknown>[]>;
  explain(sql: string): Promise<Record<string, unknown>[]>;
  execute(sql: string): Promise<ExecuteResult>;
  transaction(sqls: string[]): Promise<TransactionResult>;
  listTables(): Promise<string[]>;
  describeTable(table: string): Promise<TableDescription>;
  sampleData(table: string, limit: number): Promise<Record<string, unknown>[]>;
  estimateRowCount(table: string): Promise<TableRowCount>;
}
```

所有数据库驱动实现此接口。新增数据库类型只需新建适配器文件实现该接口即可，上层工具无需修改。

### 权限系统 (`utils/permission.ts`)

三档权限模式：

| 模式 | query | execute/transaction (DML) | DDL |
|------|:-----:|:--------------------------:|:---:|
| readonly | 允许 | 禁止 | 禁止 |
| readwrite | 允许 | 允许 | 禁止 |
| full | 允许 | 允许 | 允许 |

权限校验流程：

1. `readonly` 模式直接拒绝所有写操作
2. `readwrite` 模式用正则匹配 DML（`INSERT|UPDATE|DELETE`），拒绝 DDL（`DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE`）
3. `full` 模式允许 DML + DDL

### SQL 安全 (`utils/sql-patterns.ts`)

**多语句拦截**：通过词法扫描分离字符串字面量和注释，再检测分号后的非空字符。允许尾部单分号（常见手抖），拦截 `INSERT; DROP` 类分号多语句。

**类型校验正则**：
- `READONLY_SQL_PATTERN`：`SELECT|SHOW|DESCRIBE|DESC|EXPLAIN`
- `WRITE_SQL_PATTERN`：`INSERT|UPDATE|DELETE`
- `DANGEROUS_SQL_PATTERN`：`DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE`

### 响应格式 (`utils/response.ts`)

所有工具统一使用 `ok(data)` 和 `fail(message)` 构造响应：

```json
// 成功
{ "success": true, "rowCount": 2, "rows": [...], "elapsedMs": 3 }

// 失败（MCP 层同时设置 isError: true）
{ "success": false, "error": "错误描述" }
```

### MCP Resources (`resources.ts`)

暴露两个资源端点，与 Tools 互补：

- `db://tables` — 当前库所有表名 + 估算行数
- `db://table/{name}` — 单表列定义与索引（动态模板，每表一个 URI）

Resources 是"声明式订阅"，由客户端缓存复用；Tools 是"命令式调用"，适合需要最新数据时。

## 数据流

以 `query` 工具为例：

1. LLM 调用 `query` 工具，传入 SQL
2. `transport.ts` 将 JSON-RPC 请求路由到注册的工具处理器
3. 工具处理器调用 `checkSingleStatement` 拦截多语句
4. 工具处理器调用 `READONLY_SQL_PATTERN` 校验 SQL 类型
5. 通过 `db.query(sql)` 委托到当前数据库适配器
6. 适配器执行 SQL，返回结果集
7. 工具处理器用 `ok()` 包装为统一 JSON 响应
8. 响应通过传输层返回给 LLM
