import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { db } from "../db.js";
import type { AppConfig } from "../config.js";
import { checkWritePermission } from "./permission.js";
import { ok, fail, errorMessage } from "./response.js";

/** transaction — 在事务中顺序执行多条 SQL，任一失败则全部回滚 */
export function registerTransactionTool(server: McpServer, config: AppConfig): void {
  server.registerTool(
    "transaction",
    {
      description:
        "在数据库事务中按顺序执行一组 SQL。任一语句失败则整体回滚；全部成功才提交。权限规则与 execute 一致：readonly 禁用；readwrite 仅 DML；full 支持 DML + DDL。常用于多步写操作的原子性保证（如转账、订单创建）。",
      inputSchema: {
        sqls: z
          .array(z.string().min(1))
          .min(1)
          .describe("要按顺序执行的 SQL 语句数组，至少一条"),
      },
    },
    async ({ sqls }) => {
      const startedAt = performance.now();
      try {
        // 启动事务前逐条校验权限,杜绝半执行状态
        for (let i = 0; i < sqls.length; i++) {
          const check = checkWritePermission(sqls[i], config.permissionMode);
          if (!check.allowed) {
            return fail(`第 ${i + 1} 条 SQL 被拒绝:${check.reason} 事务未启动。`);
          }
        }

        const result = await db.transaction(sqls);

        if (result.committed) {
          return ok({
            committed: true,
            mode: config.permissionMode,
            stepCount: result.steps.length,
            steps: result.steps,
            elapsedMs: Math.round(performance.now() - startedAt),
          });
        }

        return fail(
          `事务在第 ${(result.failedAt ?? 0) + 1} 条 SQL 失败并已回滚: ${result.error}`
        );
      } catch (error) {
        return fail(`事务执行异常: ${errorMessage(error)}`);
      }
    }
  );
}
