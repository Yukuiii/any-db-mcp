#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { db } from "./db.js";
import { registerTools } from "./tools/index.js";
import { MySQLAdapter } from "./adapters/mysql.js";
import { PostgreSQLAdapter } from "./adapters/postgresql.js";
import { SQLiteAdapter } from "./adapters/sqlite.js";
import { MSSQLAdapter } from "./adapters/mssql.js";
import type { DbConfig } from "./config.js";

/** MCP Server 主入口 */
async function main(): Promise<void> {
  const config = loadConfig();

  const server = new McpServer({
    name: "any-db-mcp",
    version: "1.0.0",
  });

  // 注册所有 Tools
  registerTools(server, config);

  console.error(`[any-db-mcp] 权限模式: ${config.permissionMode}`);

  // 如果环境变量中配置了数据库连接信息，自动连接
  if (config.db) {
    try {
      const adapter = createAdapterFromConfig(config.db);
      await db.connectWith(adapter);
      const label = config.db.type === "sqlite"
        ? `SQLite (${config.db.filepath})`
        : `${config.db.type} ${config.db.host}:${config.db.port}`;
      console.error(`[any-db-mcp] 已通过环境变量连接到 ${label}`);

      // 输出表数量概览（失败不影响启动）
      try {
        const tables = await db.listTables();
        console.error(`[any-db-mcp] 当前数据库共 ${tables.length} 张表`);
      } catch (error) {
        console.error(
          `[any-db-mcp] 表列表获取失败（不影响连接）: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    } catch (error) {
      console.error(
        `[any-db-mcp] 环境变量数据库连接失败: ${error instanceof Error ? error.message : String(error)}`
      );
      console.error("[any-db-mcp] 可通过 connect 工具手动连接数据库");
    }
  } else {
    console.error("[any-db-mcp] 未配置数据库连接信息，请通过 connect 工具连接数据库");
  }

  // 使用 stdio 传输协议
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("[any-db-mcp] MCP Server 已启动 (stdio)");

  // 优雅退出：销毁连接池
  process.on("SIGINT", async () => {
    await db.disconnect();
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    await db.disconnect();
    process.exit(0);
  });
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
        encrypt: config.encrypt,
        trustServerCertificate: config.trustServerCertificate,
      });
    default:
      throw new Error(`不支持的数据库类型: ${config.type}`);
  }
}

main().catch((error) => {
  console.error("[any-db-mcp] 启动失败:", error);
  process.exit(1);
});
