import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { db } from "../db.js";
import { READONLY_SQL_PATTERN } from "./sql-patterns.js";

/** query — 执行只读 SQL 查询 */
export function registerQueryTool(server: McpServer): void {
  server.registerTool(
    "query",
    {
      description: "执行只读 SQL 查询（SELECT / SHOW / DESCRIBE / EXPLAIN）。返回查询结果集。",
      inputSchema: {
        sql: z.string().describe("要执行的 SQL 查询语句"),
      },
    },
    async ({ sql }) => {
      try {
        // 安全校验：仅允许只读语句
        if (!READONLY_SQL_PATTERN.test(sql)) {
          return {
            content: [
              {
                type: "text" as const,
                text: "❌ query 工具仅支持 SELECT / SHOW / DESCRIBE / EXPLAIN 语句。如需执行写操作，请使用 execute 工具。",
              },
            ],
            isError: true,
          };
        }

        const rows = await db.query(sql);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(rows, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `❌ 查询失败: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
