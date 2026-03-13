import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { db } from "../db.js";

/** list_tables — 列出指定数据库中的所有表 */
export function registerListTablesTool(server: McpServer): void {
  server.registerTool(
    "list_tables",
    {
      description: "列出数据库中的所有表。可指定数据库名/schema，不指定则使用默认值。",
      inputSchema: {
        database: z.string().optional().describe("数据库名或 schema（可选，默认使用当前数据库）"),
      },
    },
    async ({ database }) => {
      try {
        const tables = await db.listTables(database);
        return {
          content: [
            {
              type: "text" as const,
              text: tables.length > 0
                ? `共 ${tables.length} 张表:\n${tables.join("\n")}`
                : "当前数据库中没有表。",
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `❌ 获取表列表失败: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
