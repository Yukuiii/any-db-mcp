import Database from "better-sqlite3";
import type {
  DatabaseAdapter,
  ExecuteResult,
  TableDescription,
  TableColumn,
  TableIndex,
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

  /** 列出所有表 */
  async listTables(): Promise<string[]> {
    this.ensureConnected();
    const rows = this.db!.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).all() as { name: string }[];
    return rows.map((r) => r.name);
  }

  /** 查看表结构 */
  async describeTable(table: string): Promise<TableDescription> {
    this.ensureConnected();

    // 列信息
    const colRows = this.db!.prepare(`PRAGMA table_info('${table}')`).all() as {
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
    }));

    // 索引信息
    const idxListRows = this.db!.prepare(`PRAGMA index_list('${table}')`).all() as {
      seq: number;
      name: string;
      unique: number;
    }[];

    const indexes: TableIndex[] = [];
    for (const idx of idxListRows) {
      const idxInfoRows = this.db!.prepare(`PRAGMA index_info('${idx.name}')`).all() as {
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

    return { table, columns, indexes };
  }

  private ensureConnected(): void {
    if (!this.db) {
      throw new Error("SQLite 未连接");
    }
  }
}
