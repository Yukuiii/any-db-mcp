import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { db } from "../db.js";
import { ok, fail, errorMessage } from "../utils/response.js";

/** list_tables — 列出当前连接数据库的所有表名与表注释 */
export function registerListTablesTool(server: McpServer): void {
  server.registerTool(
    "list_tables",
    {
      description:
        "列出当前连接数据库的所有表名与表注释。tables 字段为包含 name/comment 的结构化列表。基于 connect 工具建立的连接（MySQL 当前 database / PostgreSQL public schema / SQLite 当前文件）。如需查看其他数据库或 schema，请使用 query 工具直接执行相应 SQL。",
    },
    async () => {
      const startedAt = performance.now();
      try {
        const tables = await db.listTables();
        return ok({
          tableCount: tables.length,
          tables,
          elapsedMs: Math.round(performance.now() - startedAt),
        });
      } catch (error) {
        return fail(`获取表列表失败: ${errorMessage(error)}`);
      }
    }
  );
}
