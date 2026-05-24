import pg from "pg";
import type {
  DatabaseAdapter,
  ExecuteResult,
  TableDescription,
  TableColumn,
  TableIndex,
  TransactionResult,
  TransactionStepResult,
} from "./types.js";

/** PostgreSQL 连接配置 */
export interface PostgreSQLConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

/** PostgreSQL 数据库适配器 */
export class PostgreSQLAdapter implements DatabaseAdapter {
  readonly type = "postgresql" as const;
  private pool: pg.Pool | null = null;
  private config: PostgreSQLConfig;

  constructor(config: PostgreSQLConfig) {
    this.config = config;
  }

  /** 创建连接池并验证可用性 */
  async connect(): Promise<void> {
    this.pool = new pg.Pool({
      host: this.config.host,
      port: this.config.port,
      user: this.config.user,
      password: this.config.password,
      database: this.config.database,
      max: 10,
      connectionTimeoutMillis: 30000,
    });
    // 验证连接
    const client = await this.pool.connect();
    client.release();
  }

  /** 销毁连接池 */
  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }

  /** 执行只读查询 */
  async query(sql: string): Promise<Record<string, unknown>[]> {
    this.ensureConnected();
    const result = await this.pool!.query(sql);
    return result.rows;
  }

  /** 获取执行计划（不带 ANALYZE，不实际执行 SQL） */
  async explain(sql: string): Promise<Record<string, unknown>[]> {
    this.ensureConnected();
    const result = await this.pool!.query(`EXPLAIN ${sql}`);
    return result.rows;
  }

  /** 执行修改语句 */
  async execute(sql: string): Promise<ExecuteResult> {
    this.ensureConnected();
    const result = await this.pool!.query(sql);
    return { affectedRows: result.rowCount ?? 0, insertId: 0 };
  }

  /** 在事务中顺序执行多条 SQL */
  async transaction(sqls: string[]): Promise<TransactionResult> {
    this.ensureConnected();
    const client = await this.pool!.connect();
    const steps: TransactionStepResult[] = [];
    try {
      await client.query("BEGIN");
      for (let i = 0; i < sqls.length; i++) {
        const sql = sqls[i];
        try {
          const result = await client.query(sql);
          steps.push({
            index: i,
            sql,
            affectedRows: result.rowCount ?? 0,
            insertId: 0,
          });
        } catch (err) {
          await client.query("ROLLBACK");
          return {
            committed: false,
            steps,
            failedAt: i,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }
      await client.query("COMMIT");
      return { committed: true, steps, failedAt: null, error: null };
    } finally {
      client.release();
    }
  }

  /** 列出当前连接库（默认 public schema）下的所有表 */
  async listTables(): Promise<string[]> {
    this.ensureConnected();
    const sql = `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `;
    const rows = await this.query(sql);
    return rows.map((row) => row.table_name as string);
  }

  /** 查看表结构 */
  async describeTable(table: string): Promise<TableDescription> {
    this.ensureConnected();

    // 列信息
    const colSql = `
      SELECT column_name, data_type, is_nullable, column_default,
             character_maximum_length, numeric_precision
      FROM information_schema.columns
      WHERE table_name = '${table}' AND table_schema = 'public'
      ORDER BY ordinal_position
    `;
    const colRows = await this.query(colSql);
    const columns: TableColumn[] = colRows.map((row) => ({
      name: row.column_name as string,
      type: row.data_type as string,
      nullable: row.is_nullable === "YES",
      defaultValue: (row.column_default as string | null) ?? null,
      key: "",
      extra: "",
    }));

    // 索引信息
    const idxSql = `
      SELECT i.relname AS index_name,
             a.attname AS column_name,
             ix.indisunique AS is_unique
      FROM pg_class t
      JOIN pg_index ix ON t.oid = ix.indrelid
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
      WHERE t.relname = '${table}' AND t.relkind = 'r'
      ORDER BY i.relname, a.attnum
    `;
    const idxRows = await this.query(idxSql);
    const indexMap = new Map<string, TableIndex>();
    for (const row of idxRows) {
      const name = row.index_name as string;
      if (!indexMap.has(name)) {
        indexMap.set(name, {
          name,
          columns: [],
          unique: row.is_unique as boolean,
        });
      }
      indexMap.get(name)!.columns.push(row.column_name as string);
    }

    // 标记主键列
    const pkSql = `
      SELECT a.attname AS column_name
      FROM pg_index ix
      JOIN pg_class t ON t.oid = ix.indrelid
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
      WHERE t.relname = '${table}' AND ix.indisprimary
    `;
    const pkRows = await this.query(pkSql);
    const pkColumns = new Set(pkRows.map((r) => r.column_name as string));
    for (const col of columns) {
      if (pkColumns.has(col.name)) col.key = "PRI";
    }

    return { table, columns, indexes: Array.from(indexMap.values()) };
  }

  private ensureConnected(): void {
    if (!this.pool) {
      throw new Error("PostgreSQL 未连接");
    }
  }
}
