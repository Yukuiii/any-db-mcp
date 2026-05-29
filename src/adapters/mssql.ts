import sql from "mssql";
import type {
  DatabaseAdapter,
  ExecuteResult,
  ForeignKey,
  TableColumn,
  TableDescription,
  TableIndex,
  TableInfo,
  TableRowCount,
  TransactionResult,
  TransactionStepResult,
} from "./types.js";

/** MSSQL 连接配置 */
export interface MSSQLConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  /** 默认 dbo,用于限定 list/describe/sample/rowCount 的 schema */
  schema?: string;
  /** TLS 加密(SQL Server 2019+ 默认要求),默认 true */
  encrypt: boolean;
  /** 信任自签证书(开发/局域网常用),默认 false */
  trustServerCertificate: boolean;
}

/** Microsoft SQL Server 适配器 */
export class MSSQLAdapter implements DatabaseAdapter {
  readonly type = "mssql" as const;
  private pool: sql.ConnectionPool | null = null;
  private config: MSSQLConfig;
  private schema: string;

  constructor(config: MSSQLConfig) {
    this.config = config;
    this.schema = normalizeSchema(config.schema, "dbo");
  }

  /** 创建连接池并验证可用性 */
  async connect(): Promise<void> {
    this.pool = new sql.ConnectionPool({
      server: this.config.host,
      port: this.config.port,
      user: this.config.user,
      password: this.config.password,
      database: this.config.database || undefined,
      pool: { max: 10, min: 0, idleTimeoutMillis: 60_000 },
      options: {
        encrypt: this.config.encrypt,
        trustServerCertificate: this.config.trustServerCertificate,
      },
      connectionTimeout: 30_000,
      requestTimeout: 60_000,
    });
    // pool 的 error 事件不监听会让进程崩溃
    this.pool.on("error", (err: Error) => {
      console.error(`[any-db-mcp] MSSQL 池错误(已捕获): ${err.message}`);
    });
    await this.pool.connect();
  }

  /** 销毁连接池 */
  async disconnect(): Promise<void> {
    if (this.pool) {
      try {
        await this.pool.close();
      } finally {
        this.pool = null;
      }
    }
  }

  /** 健康检查 */
  async ping(): Promise<void> {
    this.ensureConnected();
    await this.pool!.request().query("SELECT 1");
  }

  /** 执行只读查询 */
  async query(sqlText: string): Promise<Record<string, unknown>[]> {
    return this.withRetry(async () => {
      this.ensureConnected();
      const result = await this.pool!.request().query(sqlText);
      return (result.recordset ?? []) as Record<string, unknown>[];
    });
  }

  /**
   * 获取执行计划。MSSQL 的 SHOWPLAN_XML 必须独占 batch,且 SET 是 connection-sticky 的,
   * 所以走 Transaction 借出一个独占 connection,执行三段:SET ON / 目标 SQL / SET OFF,
   * 最后 rollback(SHOWPLAN 模式下原 SQL 不实际执行,事务空回滚仅释放连接)。
   */
  async explain(sqlText: string): Promise<Record<string, unknown>[]> {
    return this.withRetry(async () => {
      this.ensureConnected();
      const trans = new sql.Transaction(this.pool!);
      await trans.begin();
      try {
        await new sql.Request(trans).batch("SET SHOWPLAN_XML ON");
        const result = await new sql.Request(trans).query(sqlText);
        await new sql.Request(trans).batch("SET SHOWPLAN_XML OFF");
        await trans.rollback();
        return (result.recordset ?? []) as Record<string, unknown>[];
      } catch (err) {
        try {
          await trans.rollback();
        } catch {
          // 回滚失败也吞掉,原始错误更重要
        }
        throw err;
      }
    });
  }

  /** 执行修改语句 */
  async execute(sqlText: string): Promise<ExecuteResult> {
    return this.withRetry(async () => {
      this.ensureConnected();
      const result = await this.pool!.request().query(sqlText);
      const affectedRows = (result.rowsAffected ?? []).reduce((a, b) => a + (b ?? 0), 0);
      return { affectedRows, insertId: 0 };
    });
  }

  /**
   * 在事务中顺序执行多条 SQL。
   * 不应用 withRetry:事务跨连接续接不安全,连接丢失整体失败。
   */
  async transaction(sqls: string[]): Promise<TransactionResult> {
    this.ensureConnected();
    const trans = new sql.Transaction(this.pool!);
    const steps: TransactionStepResult[] = [];
    await trans.begin();
    for (let i = 0; i < sqls.length; i++) {
      const stmt = sqls[i];
      try {
        const r = await new sql.Request(trans).query(stmt);
        const affected = (r.rowsAffected ?? []).reduce((a, b) => a + (b ?? 0), 0);
        steps.push({ index: i, sql: stmt, affectedRows: affected, insertId: 0 });
      } catch (err) {
        try {
          await trans.rollback();
        } catch {
          // 回滚失败也吞掉
        }
        return {
          committed: false,
          steps,
          failedAt: i,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
    await trans.commit();
    return { committed: true, steps, failedAt: null, error: null };
  }

  /** 列出当前数据库指定 schema 下的所有用户表(含表注释) */
  async listTables(): Promise<TableInfo[]> {
    return this.withRetry(async () => {
      this.ensureConnected();
      // LEFT JOIN extended_properties 取表级 MS_Description(minor_id=0);value 为 sql_variant,CAST 成文本
      const r = await this.pool!
        .request()
        .input("schema", sql.NVarChar, this.schema)
        .query(`
        SELECT t.name AS name, CAST(ep.value AS NVARCHAR(MAX)) AS comment
        FROM sys.tables t
        INNER JOIN sys.schemas s ON s.schema_id = t.schema_id
        LEFT JOIN sys.extended_properties ep
          ON ep.major_id = t.object_id AND ep.minor_id = 0 AND ep.name = 'MS_Description'
        WHERE s.name = @schema
        ORDER BY t.name
      `);
      return (r.recordset ?? []).map((row: { name: string; comment: string | null }) => ({
        name: row.name,
        comment: row.comment ?? null,
      }));
    });
  }

  /** 查看表结构 */
  async describeTable(table: string): Promise<TableDescription> {
    return this.withRetry(async () => {
      this.ensureConnected();
      const objectName = quoteMssqlQualifiedIdent(this.schema, table);

      // 列信息(用参数化避免注入);LEFT JOIN extended_properties 取列级 MS_Description
      const colRes = await this.pool!
        .request()
        .input("objectName", sql.NVarChar, objectName)
        .query(`
          SELECT
            c.name AS column_name,
            t.name AS data_type,
            c.max_length AS max_length,
            c.is_nullable AS is_nullable,
            dc.definition AS default_value,
            c.is_identity AS is_identity,
            CAST(ep.value AS NVARCHAR(MAX)) AS column_comment
          FROM sys.columns c
          INNER JOIN sys.types t ON c.user_type_id = t.user_type_id
          LEFT JOIN sys.default_constraints dc ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id
          LEFT JOIN sys.extended_properties ep
            ON ep.major_id = c.object_id AND ep.minor_id = c.column_id AND ep.name = 'MS_Description'
          WHERE c.object_id = OBJECT_ID(@objectName)
          ORDER BY c.column_id
        `);
      const columns: TableColumn[] = (colRes.recordset ?? []).map(
        (row: {
          column_name: string;
          data_type: string;
          max_length: number;
          is_nullable: boolean;
          default_value: string | null;
          is_identity: boolean;
          column_comment: string | null;
        }) => ({
          name: row.column_name,
          type: row.data_type,
          nullable: !!row.is_nullable,
          defaultValue: row.default_value,
          key: "",
          extra: row.is_identity ? "identity" : "",
          comment: row.column_comment ?? null,
        })
      );

      // 索引信息
      const idxRes = await this.pool!
        .request()
        .input("objectName", sql.NVarChar, objectName)
        .query(`
          SELECT
            i.name AS index_name,
            i.is_unique AS is_unique,
            i.is_primary_key AS is_primary_key,
            c.name AS column_name,
            ic.key_ordinal AS key_ordinal
          FROM sys.indexes i
          INNER JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
          INNER JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
          WHERE i.object_id = OBJECT_ID(@objectName) AND i.name IS NOT NULL
          ORDER BY i.name, ic.key_ordinal
        `);
      const indexMap = new Map<string, TableIndex>();
      const pkColumns = new Set<string>();
      for (const row of idxRes.recordset ?? []) {
        const r = row as {
          index_name: string;
          is_unique: boolean;
          is_primary_key: boolean;
          column_name: string;
        };
        if (!indexMap.has(r.index_name)) {
          indexMap.set(r.index_name, {
            name: r.index_name,
            columns: [],
            unique: !!r.is_unique,
          });
        }
        indexMap.get(r.index_name)!.columns.push(r.column_name);
        if (r.is_primary_key) pkColumns.add(r.column_name);
      }
      for (const col of columns) {
        if (pkColumns.has(col.name)) col.key = "PRI";
      }

      // 外键信息
      const fkRes = await this.pool!
        .request()
        .input("objectName", sql.NVarChar, objectName)
        .query(`
          SELECT
            fk.name AS constraint_name,
            c1.name AS column_name,
            t2.name AS referenced_table,
            c2.name AS referenced_column
          FROM sys.foreign_keys fk
          JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
          JOIN sys.columns c1 ON c1.object_id = fkc.parent_object_id AND c1.column_id = fkc.parent_column_id
          JOIN sys.columns c2 ON c2.object_id = fkc.referenced_object_id AND c2.column_id = fkc.referenced_column_id
          JOIN sys.tables t2 ON t2.object_id = fkc.referenced_object_id
          WHERE fk.parent_object_id = OBJECT_ID(@objectName)
          ORDER BY fk.name
        `);
      const foreignKeys: ForeignKey[] = (fkRes.recordset ?? []).map(
        (row: { constraint_name: string; column_name: string; referenced_table: string; referenced_column: string }) => ({
          column: row.column_name,
          referencedTable: row.referenced_table,
          referencedColumn: row.referenced_column,
          constraintName: row.constraint_name,
        })
      );

      return { table, columns, indexes: Array.from(indexMap.values()), foreignKeys };
    });
  }

  /** 采样前 N 行数据(MSSQL 用 TOP 而不是 LIMIT) */
  async sampleData(table: string, limit: number): Promise<Record<string, unknown>[]> {
    return this.withRetry(async () => {
      this.ensureConnected();
      const ident = quoteMssqlQualifiedIdent(this.schema, table);
      const safeLimit = clampLimit(limit);
      const r = await this.pool!.request().query(`SELECT TOP ${safeLimit} * FROM ${ident}`);
      return (r.recordset ?? []) as Record<string, unknown>[];
    });
  }

  /** 用 sys.partitions 估算行数(堆 index_id=0,聚簇 index_id=1) */
  async estimateRowCount(table: string): Promise<TableRowCount> {
    return this.withRetry(async () => {
      this.ensureConnected();
      const r = await this.pool!
        .request()
        .input("objectName", sql.NVarChar, quoteMssqlQualifiedIdent(this.schema, table))
        .query(`
          SELECT SUM(p.rows) AS rows
          FROM sys.partitions p
          WHERE p.object_id = OBJECT_ID(@objectName) AND p.index_id IN (0, 1)
        `);
      const raw = r.recordset?.[0]?.rows;
      if (raw == null) return { value: null, isEstimate: true };
      const value = Number(raw);
      return {
        value: Number.isFinite(value) ? value : null,
        isEstimate: true,
      };
    });
  }

  /**
   * 操作包装:捕获连接级错误自动重建连接池并重试一次。
   * 业务级错误(SQL 语法、约束冲突等)原样抛出。
   */
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (!isMssqlConnectionLost(err)) throw err;
      console.error(
        `[any-db-mcp] MSSQL 连接丢失(${(err as Error).message}),重建连接池后重试一次...`
      );
      await this.rebuildPool();
      return await fn();
    }
  }

  /** 销毁并重建连接池 */
  private async rebuildPool(): Promise<void> {
    if (this.pool) {
      try {
        await this.pool.close();
      } catch {
        // 忽略旧 pool 销毁错误
      }
      this.pool = null;
    }
    await this.connect();
  }

  private ensureConnected(): void {
    if (!this.pool || !this.pool.connected) {
      throw new Error("MSSQL 未连接");
    }
  }
}

/** 判定是否为 MSSQL 连接级错误(值得重连重试) */
function isMssqlConnectionLost(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; name?: string; message?: string };
  const code = e.code ?? "";
  const name = e.name ?? "";
  const msg = (e.message ?? "").toLowerCase();
  return (
    code === "ECONNCLOSED" ||
    code === "ECONNRESET" ||
    code === "ESOCKET" ||
    code === "ETIMEOUT" ||
    code === "ENOTOPEN" ||
    code === "ENOCONN" ||
    name === "ConnectionError" ||
    msg.includes("connection is closed") ||
    msg.includes("connection lost") ||
    msg.includes("socket hang up") ||
    msg.includes("not connected")
  );
}

/** MSSQL 标识符 quote:中括号包裹,内部右中括号双写 */
function quoteMssqlIdent(name: string): string {
  return "[" + name.replace(/]/g, "]]") + "]";
}

/** MSSQL 二段式对象名 quote:schema 与 table 分别中括号包裹。 */
function quoteMssqlQualifiedIdent(schema: string, table: string): string {
  return `${quoteMssqlIdent(schema)}.${quoteMssqlIdent(table)}`;
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
