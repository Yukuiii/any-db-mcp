/** 数据库类型 */
export type DatabaseType = "mysql" | "postgresql" | "sqlite";

/** 表信息 */
export interface TableColumn {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue: string | null;
  key: string;
  extra: string;
}

/** 索引信息 */
export interface TableIndex {
  name: string;
  columns: string[];
  unique: boolean;
}

/** 表结构描述 */
export interface TableDescription {
  table: string;
  columns: TableColumn[];
  indexes: TableIndex[];
}

/** SQL 执行结果 */
export interface ExecuteResult {
  affectedRows: number;
  insertId: number;
}

/** 事务中单条语句的执行结果 */
export interface TransactionStepResult {
  index: number;
  sql: string;
  affectedRows: number;
  insertId: number;
}

/** 事务整体执行结果。失败时 committed=false，failedAt/error 给出诊断信息。 */
export interface TransactionResult {
  committed: boolean;
  steps: TransactionStepResult[];
  /** 失败时第几条 SQL 出错（0-based），成功为 null */
  failedAt: number | null;
  /** 失败原因，成功为 null */
  error: string | null;
}

/** 数据库适配器接口，统一三种数据库的操作契约 */
export interface DatabaseAdapter {
  /** 数据库类型标识 */
  readonly type: DatabaseType;

  /** 建立连接 */
  connect(): Promise<void>;

  /** 断开连接 */
  disconnect(): Promise<void>;

  /** 执行只读查询 */
  query(sql: string): Promise<Record<string, unknown>[]>;

  /** 获取 SQL 的执行计划（适配器内部负责拼接 EXPLAIN/EXPLAIN QUERY PLAN 前缀） */
  explain(sql: string): Promise<Record<string, unknown>[]>;

  /** 执行数据修改语句 */
  execute(sql: string): Promise<ExecuteResult>;

  /** 在事务中顺序执行多条 SQL；任一失败则回滚 */
  transaction(sqls: string[]): Promise<TransactionResult>;

  /** 列出当前连接数据库的所有表 */
  listTables(): Promise<string[]>;

  /** 查看表结构 */
  describeTable(table: string): Promise<TableDescription>;
}
