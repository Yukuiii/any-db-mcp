/** 数据库类型 */
export type DatabaseType = "mysql" | "mariadb" | "postgresql" | "sqlite" | "mssql" | "oracle";

/** 表清单条目:可选 schema + 表名 + 表注释(无注释或 SQLite 无原生概念时为 null) */
export interface TableInfo {
  schema: string | null;
  name: string;
  comment: string | null;
}

/** 表信息 */
export interface TableColumn {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue: string | null;
  key: string;
  extra: string;
  /** 列注释(MySQL/MariaDB COLUMN_COMMENT / PG col_description / MSSQL MS_Description / Oracle COMMENTS;无注释或 SQLite 为 null) */
  comment: string | null;
}

/** 索引信息 */
export interface TableIndex {
  name: string;
  columns: string[];
  unique: boolean;
}

/** 外键信息 */
export interface ForeignKey {
  column: string;
  referencedTable: string;
  referencedColumn: string;
  constraintName: string;
}

/** 表结构描述 */
export interface TableDescription {
  schema: string | null;
  table: string;
  columns: TableColumn[];
  indexes: TableIndex[];
  foreignKeys: ForeignKey[];
}

/**
 * 表行数信息。
 * - 估算值（MySQL/MariaDB information_schema / PG pg_class.reltuples / Oracle ALL_TABLES.NUM_ROWS）速度快但可能不准；
 * - SQLite 用真实 COUNT(*),isEstimate = false；
 * - 元数据缺失时 value 为 null。
 */
export interface TableRowCount {
  value: number | null;
  isEstimate: boolean;
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

/** 数据库适配器接口，统一多种数据库的操作契约 */
export interface DatabaseAdapter {
  /** 数据库类型标识 */
  readonly type: DatabaseType;

  /** 建立连接 */
  connect(): Promise<void>;

  /** 断开连接 */
  disconnect(): Promise<void>;

  /** 健康检查（发送轻量 SQL 探测连接是否可用） */
  ping(): Promise<void>;

  /** 执行只读查询 */
  query(sql: string): Promise<Record<string, unknown>[]>;

  /** 获取 SQL 的执行计划（适配器内部负责拼接 EXPLAIN/EXPLAIN QUERY PLAN 前缀） */
  explain(sql: string): Promise<Record<string, unknown>[]>;

  /** 执行数据修改语句 */
  execute(sql: string): Promise<ExecuteResult>;

  /** 在事务中顺序执行多条 SQL；任一失败则回滚 */
  transaction(sqls: string[]): Promise<TransactionResult>;

  /** 列出当前连接数据库的所有表(含表注释) */
  listTables(): Promise<TableInfo[]>;

  /** 查看表结构;支持 PostgreSQL/MSSQL/Oracle 传入 schema 精确定位 */
  describeTable(table: string, schema?: string): Promise<TableDescription>;

  /** 采样表中前 N 行数据,用于让 LLM 直观了解字段值 */
  sampleData(table: string, limit: number, schema?: string): Promise<Record<string, unknown>[]>;

  /** 获取表行数(优先使用元数据估算,SQLite 直接 COUNT) */
  estimateRowCount(table: string, schema?: string): Promise<TableRowCount>;
}
