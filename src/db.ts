import type { DatabaseAdapter, ExecuteResult, TableDescription } from "./adapters/types.js";

/** 数据库管理器，持有当前 Adapter 实例，支持动态切换 */
class DatabaseManager {
  private adapter: DatabaseAdapter | null = null;

  /** 设置并连接新的数据库适配器，断开旧连接 */
  async connectWith(adapter: DatabaseAdapter): Promise<void> {
    await this.disconnect();
    await adapter.connect();
    this.adapter = adapter;
  }

  /** 断开当前连接 */
  async disconnect(): Promise<void> {
    if (this.adapter) {
      await this.adapter.disconnect();
      this.adapter = null;
    }
  }

  /** 获取当前适配器（供 Tools 直接调用适配器方法） */
  getAdapter(): DatabaseAdapter {
    if (!this.adapter) {
      throw new Error(
        "数据库未连接。请先通过 connect 工具连接数据库，或在环境变量中配置连接信息。"
      );
    }
    return this.adapter;
  }

  /** 执行只读查询 */
  async query(sql: string): Promise<Record<string, unknown>[]> {
    return this.getAdapter().query(sql);
  }

  /** 执行数据修改 */
  async execute(sql: string): Promise<ExecuteResult> {
    return this.getAdapter().execute(sql);
  }

  /** 列出所有表 */
  async listTables(database?: string): Promise<string[]> {
    return this.getAdapter().listTables(database);
  }

  /** 查看表结构 */
  async describeTable(table: string): Promise<TableDescription> {
    return this.getAdapter().describeTable(table);
  }

  /** 列出所有数据库 */
  async listDatabases(): Promise<string[]> {
    return this.getAdapter().listDatabases();
  }

  /** 检查是否已连接 */
  isConnected(): boolean {
    return this.adapter !== null;
  }

  /** 获取当前数据库类型 */
  getType(): string | null {
    return this.adapter?.type ?? null;
  }
}

// 单例导出
export const db = new DatabaseManager();
