import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { db } from "../db.js";
import type { AppConfig } from "../config.js";
import { READONLY_SQL_PATTERN, checkSingleStatement } from "../utils/sql-patterns.js";
import { ok, fail, errorMessage } from "../utils/response.js";

const QUERY_RESULT_LIMIT = 1000;

/** query — 执行只读 SQL 查询 */
export function registerQueryTool(server: McpServer, config: AppConfig): void {
  server.registerTool(
    "query",
    {
      description:
        "执行只读 SQL 查询(SELECT / SHOW / DESCRIBE)。响应最多返回前 1000 行,并通过 limit 字段告知本次返回上限;超过 QUERY_TIMEOUT_MS 会失败。执行计划请使用 explain 工具。",
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
            "query 工具仅支持 SELECT / SHOW / DESCRIBE 语句。执行计划请使用 explain 工具;如需执行写操作,请使用 execute 工具。"
          );
        }

        const rows = await withTimeout(db.query(sql), config.queryTimeoutMs);
        const limitedRows = rows.slice(0, QUERY_RESULT_LIMIT);
        return ok({
          rowCount: limitedRows.length,
          limit: QUERY_RESULT_LIMIT,
          truncated: rows.length > QUERY_RESULT_LIMIT,
          timeoutMs: config.queryTimeoutMs,
          rows: limitedRows,
          elapsedMs: Math.round(performance.now() - startedAt),
        });
      } catch (error) {
        return fail(`查询失败: ${errorMessage(error)}`);
      }
    }
  );
}

/** 给查询 Promise 套一层响应超时,避免 MCP 请求无限等待。 */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`查询超过 ${timeoutMs}ms 超时`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
