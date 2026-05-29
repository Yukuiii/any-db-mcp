# 适配器扩展指南

要支持新的数据库类型，只需新建一个实现 `DatabaseAdapter` 接口的适配器文件，无需修改任何上层代码。

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
  describeTable(table: string): Promise<TableDescription>;
  sampleData(table: string, limit: number): Promise<Record<string, unknown>[]>;
  estimateRowCount(table: string): Promise<TableRowCount>;
}
```

## 关联类型

```typescript
type DatabaseType = "mysql" | "postgresql" | "sqlite" | "mssql"; // 扩展这里

interface TableColumn {
  name: string; type: string; nullable: boolean;
  defaultValue: string | null; key: string; extra: string;
  comment: string | null;
}

interface TableInfo {
  name: string; comment: string | null;
}

interface TableIndex {
  name: string; columns: string[]; unique: boolean;
}

interface ForeignKey {
  column: string; referencedTable: string;
  referencedColumn: string; constraintName: string;
}

interface TableDescription {
  table: string; columns: TableColumn[];
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

以添加 **Oracle** 适配器为例：

### 1. 注册类型

在 `src/adapters/types.ts` 中扩展 `DatabaseType`：

```typescript
export type DatabaseType = "mysql" | "postgresql" | "sqlite" | "mssql" | "oracle";
```

### 2. 创建适配器文件

新建 `src/adapters/oracle.ts`：

```typescript
import type { DatabaseAdapter, DatabaseType, ExecuteResult, TableDescription,
  TableRowCount, TransactionResult } from "./types.js";

interface OracleConfig {
  host: string; port: number; user: string; password: string; database: string;
}

export class OracleAdapter implements DatabaseAdapter {
  readonly type: DatabaseType = "oracle";
  private pool: any; // oracledb 连接池

  constructor(private config: OracleConfig) {}

  async connect(): Promise<void> {
    // 初始化连接池
  }

  async disconnect(): Promise<void> {
    // 释放连接池
  }

  async ping(): Promise<void> {
    // SELECT 1 FROM DUAL
  }

  async query(sql: string): Promise<Record<string, unknown>[]> {
    // 绑定变量、返回结果集
  }

  async explain(sql: string): Promise<Record<string, unknown>[]> {
    // EXPLAIN PLAN FOR + SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY)
  }

  async execute(sql: string): Promise<ExecuteResult> {
    // DML 执行，返回 affectedRows / insertId
  }

  async transaction(sqls: string[]): Promise<TransactionResult> {
    // BEGIN ... SAVEPOINT ... COMMIT / ROLLBACK
  }

  async listTables(): Promise<TableInfo[]> {
    // SELECT table_name FROM user_tables
  }

  async describeTable(table: string): Promise<TableDescription> {
    // 查 ALL_TAB_COLUMNS, ALL_INDEXES, ALL_IND_COLUMNS, ALL_CONSTRAINTS
  }

  async sampleData(table: string, limit: number): Promise<Record<string, unknown>[]> {
    // SELECT * FROM {table} WHERE ROWNUM <= {limit}
  }

  async estimateRowCount(table: string): Promise<TableRowCount> {
    // SELECT num_rows FROM user_tables WHERE table_name = UPPER(:t)
  }
}
```

### 3. 注册 connect 工厂

在 `src/tools/connect.ts` 的 `createAdapter` 函数中添加分支：

```typescript
case "oracle":
  return new OracleAdapter({
    host: params.host, port: resolvedPort,
    user: params.user, password: params.password,
    database: params.database,
  });
```

同时更新 `DEFAULT_PORTS` 添加 Oracle 默认端口 1521。

### 4. 更新 connect 工具 schema

- 在 `type` 枚举中添加 `"oracle"`
- 如有新参数（如 Oracle 的 `serviceName`），添加对应的 `inputSchema` 字段

### 5. 安装依赖

```bash
npm install oracledb
npm install -D @types/oracledb
```

## 设计要点

**连接池**：使用各驱动的原生连接池能力（`mysql2/promise`、`pg`、`mssql` 都是 Pool，`better-sqlite3` 同步无连接池）。保持与现有适配器一致的连接池模式。

**explain 前缀**：适配器内部自行拼接 EXPLAIN 前缀，不同数据库语法不同：
- MySQL：`EXPLAIN {sql}`
- PostgreSQL：`EXPLAIN (FORMAT JSON) {sql}`
- SQLite：`EXPLAIN QUERY PLAN {sql}`
- MSSQL：`SET SHOWPLAN_XML ON; {sql}; SET SHOWPLAN_XML OFF`（在事务中执行）

**错误处理**：connect 失败应抛异常，disconnect 应容错（连接池可能已关闭）。ping 用于健康检查，失败应抛异常。

**表不存在的处理**：`describeTable` 在各驱动行为不一致（MySQL 抛错，SQLite/PG 静默返回空），上层 `resources.ts` 通过检查返回的列和索引是否为空来统一判断。
