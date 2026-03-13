import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { db } from "../db.js";

/** list_databases — 列出所有数据库 */
export function registerListDatabasesTool(server: McpServer): void {
  server.registerTool(
    "list_databases",
    {
      description: "列出服务器上的所有数据库（PostgreSQL 为数据库列表，SQLite 为已附加数据库）。",
    },
    async () => {
      try {
        const databases = await db.listDatabases();
        return {
          content: [
            {
              type: "text" as const,
              text: `共 ${databases.length} 个数据库:\n${databases.join("\n")}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `❌ 获取数据库列表失败: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
