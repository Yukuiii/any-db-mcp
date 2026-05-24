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
      idleTimeoutMillis: 60000,
      connectionTimeoutMillis: 30000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
    });
    // pg.Pool 的 'error' 事件不监听会让 idle 连接异常时进程崩溃
    this.pool.on("error", (err) => {
      console.error(`[any-db-mcp] PostgreSQL 池中 idle 客户端错误（已被池捕获）: ${err.message}`);
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

  /** 健康检查：发送一条轻量 SQL 探测连接 */
  async ping(): Promise<void> {
    this.ensureConnected();
    await this.pool!.query("SELECT 1");
  }

  /** 执行只读查询 */
  async query(sql: string): Promise<Record<string, unknown>[]> {
    return this.withRetry(async () => {
      this.ensureConnected();
      const result = await this.pool!.query(sql);
      return result.rows;
    });
  }

  /** 获取执行计划（不带 ANALYZE，不实际执行 SQL） */
  async explain(sql: string): Promise<Record<string, unknown>[]> {
    return this.withRetry(async () => {
      this.ensureConnected();
      const result = await this.pool!.query(`EXPLAIN ${sql}`);
      return result.rows;
    });
  }

  /** 执行修改语句 */
  async execute(sql: string): Promise<ExecuteResult> {
    return this.withRetry(async () => {
      this.ensureConnected();
      const result = await this.pool!.query(sql);
      return { affectedRows: result.rowCount ?? 0, insertId: 0 };
    });
  }

  /**
   * 在事务中顺序执行多条 SQL。
   * 不应用 withRetry：事务跨连接续接不安全。
   */
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
    return this.withRetry(async () => {
      this.ensureConnected();
      const sql = `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name
      `;
      const result = await this.pool!.query(sql);
      return result.rows.map((row) => row.table_name as string);
    });
  }

  /** 查看表结构 */
  async describeTable(table: string): Promise<TableDescription> {
    return this.withRetry(async () => {
      this.ensureConnected();

      // 列信息
      const colSql = `
        SELECT column_name, data_type, is_nullable, column_default,
               character_maximum_length, numeric_precision
        FROM information_schema.columns
        WHERE table_name = '${table}' AND table_schema = 'public'
        ORDER BY ordinal_position
      `;
      const colResult = await this.pool!.query(colSql);
      const columns: TableColumn[] = colResult.rows.map((row) => ({
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
      const idxResult = await this.pool!.query(idxSql);
      const indexMap = new Map<string, TableIndex>();
      for (const row of idxResult.rows) {
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
      const pkResult = await this.pool!.query(pkSql);
      const pkColumns = new Set(pkResult.rows.map((r) => r.column_name as string));
      for (const col of columns) {
        if (pkColumns.has(col.name)) col.key = "PRI";
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
      if (!isPgConnectionLost(err)) throw err;
      console.error(
        `[any-db-mcp] PostgreSQL 连接丢失（${(err as Error).message}），重建连接池后重试一次...`
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
        // 忽略旧 pool 销毁错误
      }
      this.pool = null;
    }
    await this.connect();
  }

  private ensureConnected(): void {
    if (!this.pool) {
      throw new Error("PostgreSQL 未连接");
    }
  }
}

/** 判定是否为 PostgreSQL 连接级错误（值得重连重试） */
function isPgConnectionLost(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; message?: string };
  const code = e.code ?? "";
  const msg = (e.message ?? "").toLowerCase();
  return (
    code === "ECONNRESET" ||
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    code === "EPIPE" ||
    code === "ENOTFOUND" ||
    code === "57P01" /* admin_shutdown */ ||
    code === "57P02" /* crash_shutdown */ ||
    code === "57P03" /* cannot_connect_now */ ||
    msg.includes("connection terminated") ||
    msg.includes("connection ended") ||
    msg.includes("server closed the connection") ||
    msg.includes("client has encountered a connection error") ||
    msg.includes("connection refused")
  );
}
