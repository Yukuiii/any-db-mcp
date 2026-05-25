import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { db } from "../db.js";
import { READONLY_SQL_PATTERN, checkSingleStatement } from "../utils/sql-patterns.js";
import { ok, fail, errorMessage } from "../utils/response.js";

/** query — 执行只读 SQL 查询 */
export function registerQueryTool(server: McpServer): void {
  server.registerTool(
    "query",
    {
      description: "执行只读 SQL 查询(SELECT / SHOW / DESCRIBE / EXPLAIN)。返回查询结果集。",
      inputSchema: {
        sql: z.string().describe("要执行的 SQL 查询语句"),
      },
    },
    async ({ sql }) => {
      const startedAt = performance.now();
      try {
        const single = checkSingleStatement(sql);
        if (!single.ok) {
          return fail(single.reason!);
        }
        if (!READONLY_SQL_PATTERN.test(sql)) {
          return fail(
            "query 工具仅支持 SELECT / SHOW / DESCRIBE / EXPLAIN 语句。如需执行写操作,请使用 execute 工具。"
          );
        }

        const rows = await db.query(sql);
        return ok({
          rowCount: rows.length,
          rows,
          elapsedMs: Math.round(performance.now() - startedAt),
        });
      } catch (error) {
        return fail(`查询失败: ${errorMessage(error)}`);
      }
    }
  );
}
