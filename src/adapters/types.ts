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

  /** 执行数据修改语句 */
  execute(sql: string): Promise<ExecuteResult>;

  /** 列出所有表 */
  listTables(database?: string): Promise<string[]>;

  /** 查看表结构 */
  describeTable(table: string): Promise<TableDescription>;

  /** 列出所有数据库/schema */
  listDatabases(): Promise<string[]>;
}
