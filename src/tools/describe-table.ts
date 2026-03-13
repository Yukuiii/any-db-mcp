import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { db } from "../db.js";

/** describe_table — 查看表结构（列、索引） */
export function registerDescribeTableTool(server: McpServer): void {
  server.registerTool(
    "describe_table",
    {
      description: "查看指定表的结构，包括列定义和索引信息。",
      inputSchema: {
        table: z.string().describe("表名"),
      },
    },
    async ({ table }) => {
      try {
        const result = await db.describeTable(table);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `❌ 获取表结构失败: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
