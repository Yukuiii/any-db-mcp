import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { db } from "../db.js";
import type { AppConfig } from "../config.js";
import { checkWritePermission } from "./permission.js";
import { ok, fail, errorMessage } from "./response.js";

/** execute — 执行单条写操作（DML，或 full 模式下的 DDL） */
export function registerExecuteTool(server: McpServer, config: AppConfig): void {
  server.registerTool(
    "execute",
    {
      description:
        "执行单条写操作。在 readwrite 模式下仅支持 DML（INSERT / UPDATE / DELETE）；在 full 模式下额外支持 DDL（DROP / TRUNCATE / ALTER / CREATE / GRANT / REVOKE）；readonly 模式禁用此工具。",
      inputSchema: {
        sql: z.string().describe("要执行的 SQL 写操作语句"),
      },
    },
    async ({ sql }) => {
      try {
        const check = checkWritePermission(sql, config.permissionMode);
        if (!check.allowed) {
          return fail(check.reason!);
        }

        const result = await db.execute(sql);
        return ok({
          mode: config.permissionMode,
          affectedRows: result.affectedRows,
          insertId: result.insertId,
        });
      } catch (error) {
        return fail(`执行失败: ${errorMessage(error)}`);
      }
    }
  );
}
