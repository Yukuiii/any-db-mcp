import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { db } from "../db.js";
import type { AppConfig } from "../config.js";
import { WRITE_SQL_PATTERN, DANGEROUS_SQL_PATTERN } from "./sql-patterns.js";

/** execute — 执行数据修改语句 */
export function registerExecuteTool(server: McpServer, config: AppConfig): void {
  server.registerTool(
    "execute",
    {
      description: "执行数据修改语句（INSERT / UPDATE / DELETE）。只读模式下此工具不可用。",
      inputSchema: {
        sql: z.string().describe("要执行的 SQL 修改语句"),
      },
    },
    async ({ sql }) => {
      try {
        // 只读模式检查
        if (config.readonlyMode) {
          return {
            content: [
              {
                type: "text" as const,
                text: "❌ 当前为只读模式，禁止执行写操作。请在配置中关闭 READONLY_MODE。",
              },
            ],
            isError: true,
          };
        }

        // 安全校验：禁止 DDL 等危险操作
        if (DANGEROUS_SQL_PATTERN.test(sql)) {
          return {
            content: [
              {
                type: "text" as const,
                text: "❌ 禁止执行 DROP / TRUNCATE / ALTER / CREATE / GRANT / REVOKE 等危险操作。",
              },
            ],
            isError: true,
          };
        }

        // 安全校验：仅允许 DML 语句
        if (!WRITE_SQL_PATTERN.test(sql)) {
          return {
            content: [
              {
                type: "text" as const,
                text: "❌ execute 工具仅支持 INSERT / UPDATE / DELETE 语句。如需查询数据，请使用 query 工具。",
              },
            ],
            isError: true,
          };
        }

        const result = await db.execute(sql);
        return {
          content: [
            {
              type: "text" as const,
              text: `✅ 执行成功。影响行数: ${result.affectedRows}${result.insertId ? `，插入 ID: ${result.insertId}` : ""}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `❌ 执行失败: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
