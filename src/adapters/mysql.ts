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
      maxIdle: 5,
      idleTimeout: 60000,
      queueLimit: 0,
      connectTimeout: 30000,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000,
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

  /** 健康检查：发送一条轻量 SQL 探测连接 */
  async ping(): Promise<void> {
    this.ensureConnected();
    await this.pool!.query("SELECT 1");
  }

  /** 执行只读查询 */
  async query(sql: string): Promise<Record<string, unknown>[]> {
    return this.withRetry(async () => {
      this.ensureConnected();
      const [rows] = await this.pool!.query(sql);
      return rows as Record<string, unknown>[];
    });
  }

  /** 获取执行计划（MySQL EXPLAIN，不实际执行 SQL） */
  async explain(sql: string): Promise<Record<string, unknown>[]> {
    return this.withRetry(async () => {
      this.ensureConnected();
      const [rows] = await this.pool!.query(`EXPLAIN ${sql}`);
      return rows as Record<string, unknown>[];
    });
  }

  /** 执行修改语句 */
  async execute(sql: string): Promise<ExecuteResult> {
    return this.withRetry(async () => {
      this.ensureConnected();
      const [result] = await this.pool!.execute(sql);
      const res = result as mysql.ResultSetHeader;
      return { affectedRows: res.affectedRows, insertId: res.insertId };
    });
  }

  /**
   * 在事务中顺序执行多条 SQL。
   * 不应用 withRetry：事务跨连接续接是不安全的，连接丢失则整体失败。
   */
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
    return this.withRetry(async () => {
      this.ensureConnected();
      const [rows] = await this.pool!.query("SHOW TABLES");
      return (rows as Record<string, unknown>[]).map((row) => Object.values(row)[0] as string);
    });
  }

  /** 查看表结构 */
  async describeTable(table: string): Promise<TableDescription> {
    return this.withRetry(async () => {
      this.ensureConnected();

      // 列信息
      const [colRowsRaw] = await this.pool!.query(`DESCRIBE \`${table}\``);
      const colRows = colRowsRaw as Record<string, unknown>[];
      const columns: TableColumn[] = colRows.map((row) => ({
        name: row["Field"] as string,
        type: row["Type"] as string,
        nullable: row["Null"] === "YES",
        defaultValue: (row["Default"] as string | null) ?? null,
        key: (row["Key"] as string) || "",
        extra: (row["Extra"] as string) || "",
      }));

      // 索引信息
      const [idxRowsRaw] = await this.pool!.query(`SHOW INDEX FROM \`${table}\``);
      const idxRows = idxRowsRaw as Record<string, unknown>[];
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
    });
  }

  /**
   * 操作包装：捕获连接级错误自动重建连接池并重试一次。
   * 业务级错误（SQL 语法、约束冲突等）原样抛出。
   */
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (!isMysqlConnectionLost(err)) throw err;
      console.error(
        `[any-db-mcp] MySQL 连接丢失（${(err as Error).message}），重建连接池后重试一次...`
      );
      await this.rebuildPool();
      return await fn();
    }
  }

  /** 销毁并重建连接池（容错：旧 pool 销毁失败也继续） */
  private async rebuildPool(): Promise<void> {
    if (this.pool) {
      try {
        await this.pool.end();
      } catch {
        // 忽略旧 pool 销毁错误，重要的是建新的
      }
      this.pool = null;
    }
    await this.connect();
  }

  private ensureConnected(): void {
    if (!this.pool) {
      throw new Error("MySQL 未连接");
    }
  }
}

/** 判定是否为 MySQL 连接级错误（值得重连重试） */
function isMysqlConnectionLost(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; message?: string; fatal?: boolean };
  const code = e.code ?? "";
  const msg = (e.message ?? "").toLowerCase();
  return (
    code === "PROTOCOL_CONNECTION_LOST" ||
    code === "ECONNRESET" ||
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    code === "EPIPE" ||
    code === "ENOTFOUND" ||
    e.fatal === true ||
    msg.includes("connection lost") ||
    msg.includes("connection closed") ||
    msg.includes("server has gone away") ||
    msg.includes("can't add new command when connection is in closed state")
  );
}
