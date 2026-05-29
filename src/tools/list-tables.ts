import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { db } from "../db.js";
import { ok, fail, errorMessage } from "../utils/response.js";

/** list_tables — 列出当前连接数据库的所有表名与表注释 */
export function registerListTablesTool(server: McpServer): void {
  server.registerTool(
    "list_tables",
    {
      description:
        "列出当前连接数据库的所有表名与表注释。tables 字段为包含 schema/name/comment 的结构化列表。PostgreSQL/MSSQL 未配置 schema 时返回所有非系统 schema 的表,已配置 schema 时只返回该 schema 的表。",
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
