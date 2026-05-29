#!/usr/bin/env node

import { loadConfig } from "./config.js";
import { db } from "./db.js";
import { MySQLAdapter } from "./adapters/mysql.js";
import { PostgreSQLAdapter } from "./adapters/postgresql.js";
import { SQLiteAdapter } from "./adapters/sqlite.js";
import { MSSQLAdapter } from "./adapters/mssql.js";
import type { DbConfig } from "./config.js";
import { startStdio, startHttp } from "./transport.js";

/** MCP Server 主入口 */
async function main(): Promise<void> {
  const config = loadConfig();
  console.error(`[any-db-mcp] 权限模式: ${config.permissionMode}`);
  console.error(`[any-db-mcp] 传输方式: ${config.transport}`);

  // 自动连接数据库:db 单例为所有 session 共享
  if (config.db) {
    try {
      const adapter = createAdapterFromConfig(config.db);
      await db.connectWith(adapter);
      const label =
        config.db.type === "sqlite"
          ? `SQLite (${config.db.filepath})`
          : `${config.db.type} ${config.db.host}:${config.db.port}${formatSchemaInfo(config.db)}`;
      console.error(`[any-db-mcp] 已通过环境变量连接到 ${label}`);

      try {
        const tables = await db.listTables();
        console.error(`[any-db-mcp] 当前数据库共 ${tables.length} 张表`);
      } catch (error) {
        console.error(
          `[any-db-mcp] 表列表获取失败(不影响连接): ${error instanceof Error ? error.message : String(error)}`
        );
      }
    } catch (error) {
      console.error(
        `[any-db-mcp] 环境变量数据库连接失败: ${error instanceof Error ? error.message : String(error)}`
      );
      console.error("[any-db-mcp] 可通过 connect 工具手动连接数据库");
    }
  } else {
    console.error("[any-db-mcp] 未配置数据库连接信息,请通过 connect 工具连接数据库");
  }

  // 根据传输方式启动
  if (config.transport === "http") {
    await startHttp(config);
  } else {
    await startStdio(config);
  }

  // 优雅退出:销毁数据库连接池
  const shutdown = async () => {
    await db.disconnect();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

/** 根据环境变量配置创建对应适配器 */
function createAdapterFromConfig(config: DbConfig) {
  switch (config.type) {
    case "mysql":
      return new MySQLAdapter({
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        database: config.database,
      });
    case "postgresql":
      return new PostgreSQLAdapter({
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        database: config.database,
        schema: config.schema,
      });
    case "sqlite":
      return new SQLiteAdapter({ filepath: config.filepath });
    case "mssql":
      return new MSSQLAdapter({
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        database: config.database,
        schema: config.schema,
        encrypt: config.encrypt,
        trustServerCertificate: config.trustServerCertificate,
      });
    default:
      throw new Error(`不支持的数据库类型: ${config.type}`);
  }
}

/** 格式化 PostgreSQL/MSSQL schema 信息用于启动日志。 */
function formatSchemaInfo(config: DbConfig): string {
  const defaultSchema = config.type === "postgresql" ? "public" : config.type === "mssql" ? "dbo" : "";
  return defaultSchema ? ` schema=${config.schema || defaultSchema}` : "";
}

main().catch((error) => {
  console.error("[any-db-mcp] 启动失败:", error);
  process.exit(1);
});
