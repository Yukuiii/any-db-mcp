import Database from "better-sqlite3";
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

/** SQLite 连接配置 */
export interface SQLiteConfig {
  filepath: string;
}

/** SQLite 数据库适配器 */
export class SQLiteAdapter implements DatabaseAdapter {
  readonly type = "sqlite" as const;
  private db: Database.Database | null = null;
  private config: SQLiteConfig;

  constructor(config: SQLiteConfig) {
    this.config = config;
  }

  /** 打开数据库文件 */
  async connect(): Promise<void> {
    this.db = new Database(this.config.filepath);
    // 开启 WAL 模式提升并发性能
    this.db.pragma("journal_mode = WAL");
  }

  /** 关闭数据库 */
  async disconnect(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  /** 健康检查：SQLite 是本地文件，跑一条最简单的 pragma 即可 */
  async ping(): Promise<void> {
    this.ensureConnected();
    this.db!.prepare("SELECT 1").get();
  }

  /** 执行只读查询 */
  async query(sql: string): Promise<Record<string, unknown>[]> {
    this.ensureConnected();
    return this.db!.prepare(sql).all() as Record<string, unknown>[];
  }

  /** 获取执行计划（SQLite 用 EXPLAIN QUERY PLAN，比 EXPLAIN 输出更易读） */
  async explain(sql: string): Promise<Record<string, unknown>[]> {
    this.ensureConnected();
    return this.db!.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as Record<string, unknown>[];
  }

  /** 执行修改语句 */
  async execute(sql: string): Promise<ExecuteResult> {
    this.ensureConnected();
    const result = this.db!.prepare(sql).run();
    return {
      affectedRows: result.changes,
      insertId: Number(result.lastInsertRowid),
    };
  }

  /** 在事务中顺序执行多条 SQL（手动 BEGIN/COMMIT/ROLLBACK，统一错误结构） */
  async transaction(sqls: string[]): Promise<TransactionResult> {
    this.ensureConnected();
    const steps: TransactionStepResult[] = [];
    this.db!.exec("BEGIN");
    for (let i = 0; i < sqls.length; i++) {
      const sql = sqls[i];
      try {
        const result = this.db!.prepare(sql).run();
        steps.push({
          index: i,
          sql,
          affectedRows: result.changes,
          insertId: Number(result.lastInsertRowid),
        });
      } catch (err) {
        try {
          this.db!.exec("ROLLBACK");
        } catch {
          // 回滚失败也吞掉，原始错误更重要
        }
        return {
          committed: false,
          steps,
          failedAt: i,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
    this.db!.exec("COMMIT");
    return { committed: true, steps, failedAt: null, error: null };
  }

  /** 列出所有表(SQLite 无原生表注释,comment 恒为 null) */
  async listTables(): Promise<TableInfo[]> {
    this.ensureConnected();
    const rows = this.db!.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).all() as { name: string }[];
    return rows.map((r) => ({ schema: null, name: r.name, comment: null }));
  }

  /** 查看表结构 */
  async describeTable(table: string): Promise<TableDescription> {
    this.ensureConnected();

    // PRAGMA 不支持参数化,改用 quote 后的字符串字面值;同时校验合法标识符避免注入
    const safeTable = sqliteSafeIdent(table);

    // 列信息
    const colRows = this.db!.prepare(`PRAGMA table_info('${safeTable}')`).all() as {
      cid: number;
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }[];

    const columns: TableColumn[] = colRows.map((row) => ({
      name: row.name,
      type: row.type,
      nullable: row.notnull === 0,
      defaultValue: row.dflt_value,
      key: row.pk > 0 ? "PRI" : "",
      extra: "",
      comment: null, // SQLite 无原生列注释
    }));

    // 索引信息
    const idxListRows = this.db!.prepare(`PRAGMA index_list('${safeTable}')`).all() as {
      seq: number;
      name: string;
      unique: number;
    }[];

    const indexes: TableIndex[] = [];
    for (const idx of idxListRows) {
      const safeIdxName = sqliteSafeIdent(idx.name);
      const idxInfoRows = this.db!.prepare(`PRAGMA index_info('${safeIdxName}')`).all() as {
        seqno: number;
        cid: number;
        name: string;
      }[];
      indexes.push({
        name: idx.name,
        columns: idxInfoRows.map((r) => r.name),
        unique: idx.unique === 1,
      });
    }

    // 外键信息
    const fkRows = this.db!.prepare(`PRAGMA foreign_key_list('${safeTable}')`).all() as {
      id: number;
      seq: number;
      table: string;
      from: string;
      to: string;
    }[];
    const foreignKeys: ForeignKey[] = fkRows.map((row) => ({
      column: row.from,
      referencedTable: row.table,
      referencedColumn: row.to,
      constraintName: `fk_${table}_${row.from}`,
    }));

    return { schema: null, table, columns, indexes, foreignKeys };
  }

  /** 采样前 N 行数据 */
  async sampleData(table: string, limit: number): Promise<Record<string, unknown>[]> {
    this.ensureConnected();
    const ident = quoteSqliteIdent(table);
    const safeLimit = clampLimit(limit);
    return this.db!.prepare(`SELECT * FROM ${ident} LIMIT ${safeLimit}`).all() as Record<
      string,
      unknown
    >[];
  }

  /** SQLite 没有元数据估算,本地文件 COUNT(*) 很快,返回精确值 */
  async estimateRowCount(table: string): Promise<TableRowCount> {
    this.ensureConnected();
    const ident = quoteSqliteIdent(table);
    const row = this.db!.prepare(`SELECT COUNT(*) AS n FROM ${ident}`).get() as { n: number };
    return { value: Number(row.n), isEstimate: false };
  }

  private ensureConnected(): void {
    if (!this.db) {
      throw new Error("SQLite 未连接");
    }
  }
}

/** SQLite 标识符 quote:双引号包裹,内部双引号双写 */
function quoteSqliteIdent(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"';
}

/**
 * PRAGMA 既不支持 ? 参数化,也不接受 quoted 标识符(只接受字符串字面值),
 * 因此用白名单校验法兜底:仅允许常见标识符字符,且 ' 必须双写。
 */
function sqliteSafeIdent(name: string): string {
  if (!/^[A-Za-z0-9_][A-Za-z0-9_\-$]*$/.test(name)) {
    throw new Error(`非法的 SQLite 标识符: ${name}`);
  }
  return name.replace(/'/g, "''");
}

/** 采样行数夹紧到 [0, 20] */
function clampLimit(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const i = Math.trunc(n);
  if (i < 0) return 0;
  if (i > 20) return 20;
  return i;
}
