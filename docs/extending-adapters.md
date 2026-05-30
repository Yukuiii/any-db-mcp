# 适配器扩展指南

要支持新的数据库类型，需要新建一个实现 `DatabaseAdapter` 接口的适配器文件，并在类型、默认端口和 connect 工厂中注册。

## 接口完整定义

```typescript
// src/adapters/types.ts

interface DatabaseAdapter {
  readonly type: DatabaseType; // 新增类型需先在此联合类型中注册
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  ping(): Promise<void>;
  query(sql: string): Promise<Record<string, unknown>[]>;
  explain(sql: string): Promise<Record<string, unknown>[]>;
  execute(sql: string): Promise<ExecuteResult>;
  transaction(sqls: string[]): Promise<TransactionResult>;
  listTables(): Promise<TableInfo[]>;
  describeTable(table: string, schema?: string): Promise<TableDescription>;
  sampleData(table: string, limit: number, schema?: string): Promise<Record<string, unknown>[]>;
  estimateRowCount(table: string, schema?: string): Promise<TableRowCount>;
}
```

## 关联类型

```typescript
type DatabaseType = "mysql" | "mariadb" | "postgresql" | "sqlite" | "mssql" | "oracle"; // 扩展这里

interface TableColumn {
  name: string; type: string; nullable: boolean;
  defaultValue: string | null; key: string; extra: string;
  comment: string | null;
}

interface TableInfo {
  schema: string | null; name: string; comment: string | null;
}

interface TableIndex {
  name: string; columns: string[]; unique: boolean;
}

interface ForeignKey {
  column: string; referencedTable: string;
  referencedColumn: string; constraintName: string;
}

interface TableDescription {
  schema: string | null; table: string; columns: TableColumn[];
  indexes: TableIndex[]; foreignKeys: ForeignKey[];
}

interface TableRowCount {
  value: number | null; // null 表示元数据缺失
  isEstimate: boolean;  // SQLite 用真实 COUNT(*) 时为 false
}

interface ExecuteResult {
  affectedRows: number; insertId: number;
}

interface TransactionResult {
  committed: boolean;
  steps: TransactionStepResult[];
  failedAt: number | null;  // 失败时 0-based 索引，成功为 null
  error: string | null;
}

interface TransactionStepResult {
  index: number; sql: string; affectedRows: number; insertId: number;
}
```

## 实现步骤

以添加 **ClickHouse** 适配器为例：

### 1. 注册类型

在 `src/adapters/types.ts` 中扩展 `DatabaseType`：

```typescript
export type DatabaseType = "mysql" | "mariadb" | "postgresql" | "sqlite" | "mssql" | "oracle" | "clickhouse";
```

### 2. 创建适配器文件

新建 `src/adapters/clickhouse.ts`：

```typescript
import type { DatabaseAdapter, DatabaseType, ExecuteResult, TableDescription,
  TableRowCount, TransactionResult } from "./types.js";

interface ClickHouseConfig {
  host: string; port: number; user: string; password: string; database: string; schema?: string;
}

export class ClickHouseAdapter implements DatabaseAdapter {
  readonly type: DatabaseType = "clickhouse";
  private client: any; // ClickHouse 客户端

  constructor(private config: ClickHouseConfig) {}

  async connect(): Promise<void> {
    // 初始化连接池
  }

  async disconnect(): Promise<void> {
    // 释放连接池
  }

  async ping(): Promise<void> {
    // SELECT 1
  }

  async query(sql: string): Promise<Record<string, unknown>[]> {
    // 绑定变量、返回结果集
  }

  async explain(sql: string): Promise<Record<string, unknown>[]> {
    // EXPLAIN {sql}
  }

  async execute(sql: string): Promise<ExecuteResult> {
    // DML 执行，返回 affectedRows / insertId
  }

  async transaction(sqls: string[]): Promise<TransactionResult> {
    // ClickHouse 不支持传统事务时应返回明确错误
  }

  async listTables(): Promise<TableInfo[]> {
    // 查 system.tables
  }

  async describeTable(table: string, schema?: string): Promise<TableDescription> {
    // 查 system.columns 与相关元数据
  }

  async sampleData(table: string, limit: number, schema?: string): Promise<Record<string, unknown>[]> {
    // SELECT * FROM {table} LIMIT {limit}
  }

  async estimateRowCount(table: string, schema?: string): Promise<TableRowCount> {
    // 查 system.tables.total_rows 或返回 null
  }
}
```

### 3. 注册 connect 工厂

在 `src/tools/connect.ts` 的 `createAdapter` 函数中添加分支：

```typescript
case "clickhouse":
  return new ClickHouseAdapter({
    host: params.host, port: resolvedPort,
    user: params.user, password: params.password,
    database: params.database,
    schema: params.schema,
  });
```

同时更新 `DEFAULT_PORTS` 添加 ClickHouse 默认端口 8123。

### 4. 更新 connect 工具 schema

- 在 `type` 枚举中添加 `"oracle"`
- 如有新参数,添加对应的 `inputSchema` 字段

### 5. 安装依赖

```bash
npm install <driver-package>
npm install -D <driver-types-package>
```

## 设计要点

**连接池**：使用各驱动的原生连接池能力（`mysql2/promise`、`pg`、`mssql`、`oracledb` 都是 Pool，`better-sqlite3` 同步无连接池）。保持与现有适配器一致的连接池模式。

**explain 前缀**：适配器内部自行拼接 EXPLAIN 前缀，不同数据库语法不同：
- MySQL：`EXPLAIN {sql}`
- PostgreSQL：`EXPLAIN (FORMAT JSON) {sql}`
- SQLite：`EXPLAIN QUERY PLAN {sql}`
- MSSQL：`SET SHOWPLAN_XML ON; {sql}; SET SHOWPLAN_XML OFF`（在事务中执行）
- Oracle：`EXPLAIN PLAN FOR {sql}` + `DBMS_XPLAN.DISPLAY`

**错误处理**：connect 失败应抛异常，disconnect 应容错（连接池可能已关闭）。ping 用于健康检查，失败应抛异常。

**表不存在的处理**：`describeTable` 在各驱动行为不一致（MySQL 抛错，SQLite/PG 静默返回空），上层 `resources.ts` 通过检查返回的列和索引是否为空来统一判断。
