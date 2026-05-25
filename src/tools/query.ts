import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { db } from "../db.js";
import { READONLY_SQL_PATTERN, checkSingleStatement } from "../utils/sql-patterns.js";
import { ok, fail, errorMessage } from "../utils/response.js";

const QUERY_RESULT_LIMIT = 1000;

/** query — 执行只读 SQL 查询 */
export function registerQueryTool(server: McpServer): void {
  server.registerTool(
    "query",
    {
      description:
        "执行只读 SQL 查询(SELECT / SHOW / DESCRIBE / EXPLAIN)。响应最多返回前 1000 行,并通过 limit 字段告知本次返回上限。",
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
        const limitedRows = rows.slice(0, QUERY_RESULT_LIMIT);
        return ok({
          rowCount: limitedRows.length,
          limit: QUERY_RESULT_LIMIT,
          truncated: rows.length > QUERY_RESULT_LIMIT,
          rows: limitedRows,
          elapsedMs: Math.round(performance.now() - startedAt),
        });
      } catch (error) {
        return fail(`查询失败: ${errorMessage(error)}`);
      }
    }
  );
}
