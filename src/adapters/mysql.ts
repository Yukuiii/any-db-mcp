import mysql from "mysql2/promise";
import type {
  DatabaseAdapter,
  ExecuteResult,
  TableDescription,
  TableColumn,
  TableIndex,
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

  /** 执行修改语句 */
  async execute(sql: string): Promise<ExecuteResult> {
    this.ensureConnected();
    const [result] = await this.pool!.execute(sql);
    const res = result as mysql.ResultSetHeader;
    return { affectedRows: res.affectedRows, insertId: res.insertId };
  }

  /** 列出所有表 */
  async listTables(database?: string): Promise<string[]> {
    this.ensureConnected();
    const sql = database
      ? `SHOW TABLES FROM \`${database}\``
      : "SHOW TABLES";
    const rows = await this.query(sql);
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

  /** 列出所有数据库 */
  async listDatabases(): Promise<string[]> {
    this.ensureConnected();
    const rows = await this.query("SHOW DATABASES");
    return rows.map((row) => Object.values(row)[0] as string);
  }

  private ensureConnected(): void {
    if (!this.pool) {
      throw new Error("MySQL 未连接");
    }
  }
}
