import Database from "better-sqlite3";
import type {
  DatabaseAdapter,
  ExecuteResult,
  TableDescription,
  TableColumn,
  TableIndex,
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

  /** 执行只读查询 */
  async query(sql: string): Promise<Record<string, unknown>[]> {
    this.ensureConnected();
    return this.db!.prepare(sql).all() as Record<string, unknown>[];
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

  /** 列出已附加的数据库 */
  async listDatabases(): Promise<string[]> {
    this.ensureConnected();
    const rows = this.db!.prepare("PRAGMA database_list").all() as { name: string }[];
    return rows.map((r) => r.name);
  }

  private ensureConnected(): void {
    if (!this.db) {
      throw new Error("SQLite 未连接");
    }
  }
}
