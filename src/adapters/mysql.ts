import mysql from "mysql2/promise";
import type {
  DatabaseAdapter,
  ExecuteResult,
  TableDescription,
  TableColumn,
  TableIndex,
  TransactionResult,
  TransactionStepResult,
} from "./types.js";

/** MySQL 连接配置 */
export interface MySQLConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

/** MySQL 数据库适配器 */
export class MySQLAdapter implements DatabaseAdapter {
  readonly type = "mysql" as const;
  private pool: mysql.Pool | null = null;
  private config: MySQLConfig;

  constructor(config: MySQLConfig) {
    this.config = config;
  }

  /** 创建连接池并验证可用性 */
  async connect(): Promise<void> {
    this.pool = mysql.createPool({
      host: this.config.host,
      port: this.config.port,
      user: this.config.user,
      password: this.config.password,
      database: this.config.database,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      connectTimeout: 30000,
    });
    // 验证连接
    const conn = await this.pool.getConnection();
    conn.release();
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
    const [rows] = await this.pool!.query(sql);
    return rows as Record<string, unknown>[];
  }

  /** 获取执行计划（MySQL EXPLAIN，不实际执行 SQL） */
  async explain(sql: string): Promise<Record<string, unknown>[]> {
    this.ensureConnected();
    const [rows] = await this.pool!.query(`EXPLAIN ${sql}`);
    return rows as Record<string, unknown>[];
  }

  /** 执行修改语句 */
  async execute(sql: string): Promise<ExecuteResult> {
    this.ensureConnected();
    const [result] = await this.pool!.execute(sql);
    const res = result as mysql.ResultSetHeader;
    return { affectedRows: res.affectedRows, insertId: res.insertId };
  }

  /** 在事务中顺序执行多条 SQL */
  async transaction(sqls: string[]): Promise<TransactionResult> {
    this.ensureConnected();
    const conn = await this.pool!.getConnection();
    const steps: TransactionStepResult[] = [];
    try {
      await conn.beginTransaction();
      for (let i = 0; i < sqls.length; i++) {
        const sql = sqls[i];
        try {
          const [result] = await conn.query(sql);
          const res = result as mysql.ResultSetHeader;
          steps.push({
            index: i,
            sql,
            affectedRows: res.affectedRows ?? 0,
            insertId: res.insertId ?? 0,
          });
        } catch (err) {
          await conn.rollback();
          return {
            committed: false,
            steps,
            failedAt: i,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }
      await conn.commit();
      return { committed: true, steps, failedAt: null, error: null };
    } finally {
      conn.release();
    }
  }

  /** 列出当前连接数据库的所有表 */
  async listTables(): Promise<string[]> {
    this.ensureConnected();
    const rows = await this.query("SHOW TABLES");
    return rows.map((row) => Object.values(row)[0] as string);
  }

  /** 查看表结构 */
  async describeTable(table: string): Promise<TableDescription> {
    this.ensureConnected();

    // 列信息
    const colRows = await this.query(`DESCRIBE \`${table}\``);
    const columns: TableColumn[] = colRows.map((row) => ({
      name: row["Field"] as string,
      type: row["Type"] as string,
      nullable: row["Null"] === "YES",
      defaultValue: (row["Default"] as string | null) ?? null,
      key: (row["Key"] as string) || "",
      extra: (row["Extra"] as string) || "",
    }));

    // 索引信息
    const idxRows = await this.query(`SHOW INDEX FROM \`${table}\``);
    const indexMap = new Map<string, TableIndex>();
    for (const row of idxRows) {
      const name = row["Key_name"] as string;
      if (!indexMap.has(name)) {
        indexMap.set(name, {
          name,
          columns: [],
          unique: (row["Non_unique"] as number) === 0,
        });
      }
      indexMap.get(name)!.columns.push(row["Column_name"] as string);
    }

    return { table, columns, indexes: Array.from(indexMap.values()) };
  }

  private ensureConnected(): void {
    if (!this.pool) {
      throw new Error("MySQL 未连接");
    }
  }
}
