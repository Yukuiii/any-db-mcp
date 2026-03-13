import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { db } from "../db.js";
import { MySQLAdapter } from "../adapters/mysql.js";
import { PostgreSQLAdapter } from "../adapters/postgresql.js";
import { SQLiteAdapter } from "../adapters/sqlite.js";
import type { DatabaseType } from "../adapters/types.js";

/** connect — 动态连接数据库 */
export function registerConnectTool(server: McpServer): void {
  server.registerTool(
    "connect",
    {
      description:
        "连接到数据库。支持 MySQL、PostgreSQL、SQLite 三种类型。传入连接参数后会建立新连接，之前的连接会被自动关闭。SQLite 只需要传 filepath 参数。",
      inputSchema: {
        type: z.enum(["mysql", "postgresql", "sqlite"]).describe("数据库类型"),
        host: z.string().default("localhost").describe("数据库主机地址（SQLite 不需要）"),
        port: z.number().default(0).describe("数据库端口（0 表示使用默认端口：MySQL 3306，PostgreSQL 5432）"),
        user: z.string().default("").describe("数据库用户名（SQLite 不需要）"),
        password: z.string().default("").describe("数据库密码（SQLite 不需要）"),
        database: z.string().default("").describe("数据库名（SQLite 不需要）"),
        filepath: z.string().default("").describe("SQLite 数据库文件路径（仅 SQLite 使用）"),
      },
    },
    async ({ type, host, port, user, password, database, filepath }) => {
      try {
        const adapter = createAdapter(type, { host, port, user, password, database, filepath });
        await db.connectWith(adapter);

        const info = formatConnectionInfo(type, { host, port, database, filepath });
        return {
          content: [
            {
              type: "text" as const,
              text: `✅ 已成功连接到 ${info}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `❌ 连接失败: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

/** 各数据库默认端口 */
const DEFAULT_PORTS: Record<DatabaseType, number> = {
  mysql: 3306,
  postgresql: 5432,
  sqlite: 0,
};

/** 根据类型创建对应数据库适配器 */
function createAdapter(
  type: DatabaseType,
  params: { host: string; port: number; user: string; password: string; database: string; filepath: string }
) {
  const resolvedPort = params.port === 0 ? DEFAULT_PORTS[type] : params.port;

  switch (type) {
    case "mysql":
      return new MySQLAdapter({
        host: params.host,
        port: resolvedPort,
        user: params.user,
        password: params.password,
        database: params.database,
      });
    case "postgresql":
      return new PostgreSQLAdapter({
        host: params.host,
        port: resolvedPort,
        user: params.user,
        password: params.password,
        database: params.database,
      });
    case "sqlite":
      if (!params.filepath) {
        throw new Error("SQLite 需要提供 filepath 参数");
      }
      return new SQLiteAdapter({ filepath: params.filepath });
    default:
      throw new Error(`不支持的数据库类型: ${type}`);
  }
}

/** 格式化连接信息用于显示 */
function formatConnectionInfo(
  type: DatabaseType,
  params: { host: string; port: number; database: string; filepath: string }
): string {
  if (type === "sqlite") {
    return `SQLite (${params.filepath})`;
  }
  const resolvedPort = params.port === 0 ? DEFAULT_PORTS[type] : params.port;
  const label = type === "mysql" ? "MySQL" : "PostgreSQL";
  const dbInfo = params.database ? `/${params.database}` : "";
  return `${label} ${params.host}:${resolvedPort}${dbInfo}`;
}
