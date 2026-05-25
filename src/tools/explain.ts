import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { db } from "../db.js";
import { checkSingleStatement } from "../utils/sql-patterns.js";
import { ok, fail, errorMessage } from "../utils/response.js";

/**
 * 只允许这些语句被 EXPLAIN。拒绝 ANALYZE / VACUUM / REINDEX / OPTIMIZE 等
 * 看似分析、实则会写入或重整数据的语句，避免在 readonly 模式下被借助 explain 工具绕过限制。
 */
const EXPLAINABLE_SQL_PATTERN = /^\s*(SELECT|INSERT|UPDATE|DELETE|WITH)\b/i;

/** 拒绝用户自带 EXPLAIN 前缀，由适配器统一拼接 */
const HAS_EXPLAIN_PREFIX = /^\s*EXPLAIN\b/i;

/** explain — 获取 SQL 执行计划（不实际执行原 SQL） */
export function registerExplainTool(server: McpServer): void {
  server.registerTool(
    "explain",
    {
      description:
        "获取 SQL 的执行计划，辅助分析查询性能与优化。所有权限模式下均可调用（EXPLAIN 不实际执行原 SQL）。仅支持 SELECT / INSERT / UPDATE / DELETE / WITH 开头的语句；无需自带 EXPLAIN 前缀，适配器内部统一拼接。",
      inputSchema: {
        sql: z
          .string()
          .min(1)
          .describe("要分析的 SQL（不需要自带 EXPLAIN 前缀）"),
      },
    },
    async ({ sql }) => {
      const startedAt = performance.now();
      try {
        const single = checkSingleStatement(sql);
        if (!single.ok) {
          return fail(single.reason!);
        }
        if (HAS_EXPLAIN_PREFIX.test(sql)) {
          return fail("请不要自带 EXPLAIN 前缀,工具会自动拼接。");
        }
        if (!EXPLAINABLE_SQL_PATTERN.test(sql)) {
          return fail(
            "explain 工具仅支持 SELECT / INSERT / UPDATE / DELETE / WITH 开头的语句。"
          );
        }

        const plan = await db.explain(sql);
        return ok({
          rowCount: plan.length,
          plan,
          elapsedMs: Math.round(performance.now() - startedAt),
        });
      } catch (error) {
        return fail(`获取执行计划失败: ${errorMessage(error)}`);
      }
    }
  );
}
