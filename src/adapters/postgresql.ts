import pg from "pg";
import type {
  DatabaseAdapter,
  ExecuteResult,
  ForeignKey,
  TableDescription,
  TableColumn,
  TableIndex,
  TableInfo,
  TableRowCount,
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
  /** 默认 public,用于限定 list/describe/sample/rowCount 的 schema */
  schema?: string;
}

/** PostgreSQL 数据库适配器 */
export class PostgreSQLAdapter implements DatabaseAdapter {
  readonly type = "postgresql" as const;
  private pool: pg.Pool | null = null;
  private config: PostgreSQLConfig;
  private schema: string;

  constructor(config: PostgreSQLConfig) {
    this.config = config;
    this.schema = normalizeSchema(config.schema, "public");
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

  /** 列出当前连接库指定 schema 下的所有表(含表注释) */
  async listTables(): Promise<TableInfo[]> {
    return this.withRetry(async () => {
      this.ensureConnected();
      // 用 pg_class 取 oid 以便 obj_description 拿表注释;普通表和分区表父表都属于 BASE TABLE 语义
      const sql = `
        SELECT c.relname AS name, obj_description(c.oid, 'pg_class') AS comment
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relkind IN ('r', 'p')
        ORDER BY c.relname
      `;
      const result = await this.pool!.query(sql, [this.schema]);
      return result.rows.map((row) => ({
        name: row.name as string,
        comment: (row.comment as string | null) ?? null,
      }));
    });
  }

  /** 查看表结构 */
  async describeTable(table: string): Promise<TableDescription> {
    return this.withRetry(async () => {
      this.ensureConnected();

      // 列信息(参数化,避免注入);col_description 按 schema.table 的 regclass + 列序号取列注释
      const colSql = `
        SELECT column_name, data_type, is_nullable, column_default,
               character_maximum_length, numeric_precision,
               col_description(
                 (quote_ident(table_schema) || '.' || quote_ident(table_name))::regclass,
                 ordinal_position
               ) AS column_comment
        FROM information_schema.columns
        WHERE table_name = $1 AND table_schema = $2
        ORDER BY ordinal_position
      `;
      const colResult = await this.pool!.query(colSql, [table, this.schema]);
      const columns: TableColumn[] = colResult.rows.map((row) => ({
        name: row.column_name as string,
        type: row.data_type as string,
        nullable: row.is_nullable === "YES",
        defaultValue: (row.column_default as string | null) ?? null,
        key: "",
        extra: "",
        comment: (row.column_comment as string | null) ?? null,
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
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE t.relname = $1 AND n.nspname = $2 AND t.relkind IN ('r', 'p')
        ORDER BY i.relname, a.attnum
      `;
      const idxResult = await this.pool!.query(idxSql, [table, this.schema]);
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
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE t.relname = $1 AND n.nspname = $2 AND ix.indisprimary
      `;
      const pkResult = await this.pool!.query(pkSql, [table, this.schema]);
      const pkColumns = new Set(pkResult.rows.map((r) => r.column_name as string));
      for (const col of columns) {
        if (pkColumns.has(col.name)) col.key = "PRI";
      }

      // 外键信息
      const fkSql = `
        SELECT
          kcu.column_name,
          ccu.table_name AS referenced_table,
          ccu.column_name AS referenced_column,
          tc.constraint_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_name = $1 AND tc.table_schema = $2
        ORDER BY tc.constraint_name
      `;
      const fkResult = await this.pool!.query(fkSql, [table, this.schema]);
      const foreignKeys: ForeignKey[] = fkResult.rows.map((row) => ({
        column: row.column_name as string,
        referencedTable: row.referenced_table as string,
        referencedColumn: row.referenced_column as string,
        constraintName: row.constraint_name as string,
      }));

      return { table, columns, indexes: Array.from(indexMap.values()), foreignKeys };
    });
  }

  /** 采样前 N 行数据 */
  async sampleData(table: string, limit: number): Promise<Record<string, unknown>[]> {
    return this.withRetry(async () => {
      this.ensureConnected();
      const ident = `${quotePgIdent(this.schema)}.${quotePgIdent(table)}`;
      const safeLimit = clampLimit(limit);
      const result = await this.pool!.query(`SELECT * FROM ${ident} LIMIT ${safeLimit}`);
      return result.rows;
    });
  }

  /** 用 pg_class.reltuples 估算行数。从未 ANALYZE 时为 -1,返回 null。 */
  async estimateRowCount(table: string): Promise<TableRowCount> {
    return this.withRetry(async () => {
      this.ensureConnected();
      const sql = `
        SELECT c.reltuples::bigint AS rows
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname = $1 AND n.nspname = $2 AND c.relkind IN ('r', 'p')
      `;
      const result = await this.pool!.query(sql, [table, this.schema]);
      if (result.rows.length === 0) {
        return { value: null, isEstimate: true };
      }
      const raw = result.rows[0].rows;
      const value = raw == null ? null : Number(raw);
      if (value == null || !Number.isFinite(value) || value < 0) {
        return { value: null, isEstimate: true };
      }
      return { value, isEstimate: true };
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

/** PG 标识符 quote:双引号包裹,内部双引号双写 */
function quotePgIdent(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"';
}

/** 归一化 schema 名称,空值使用适配器默认 schema。 */
function normalizeSchema(value: string | undefined, defaultSchema: string): string {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : defaultSchema;
}

/** 采样行数夹紧到 [0, 20] */
function clampLimit(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const i = Math.trunc(n);
  if (i < 0) return 0;
  if (i > 20) return 20;
  return i;
}
