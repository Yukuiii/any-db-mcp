import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { db } from "../db.js";
import type { AppConfig } from "../config.js";
import { ok, fail, errorMessage } from "../utils/response.js";
import { safeListTablesPayload } from "./shared/table-list-payload.js";

/** connection_status — 查看当前数据库连接状态与健康度 */
export function registerConnectionStatusTool(server: McpServer, config: AppConfig): void {
  server.registerTool(
    "connection_status",
    {
      description:
        "查看当前数据库连接的状态，返回是否已连接、数据库类型、ping 健康度（实测耗时）、表名列表以及权限模式。LLM 在长时间未操作后或捕获到执行失败时可调用此工具确认连接可用性。",
    },
    async () => {
      try {
        if (!db.isConnected()) {
          return ok({
            connected: false,
            permissionMode: config.permissionMode,
            message: "未连接到任何数据库。请先调用 connect 工具。",
          });
        }

        const type = db.getType();
        const start = Date.now();
        let healthy = true;
        let pingError: string | null = null;
        try {
          await db.ping();
        } catch (err) {
          healthy = false;
          pingError = errorMessage(err);
        }
        const pingMs = Date.now() - start;
        const tablesPayload = await safeListTablesPayload();

        return ok({
          connected: true,
          type,
          healthy,
          pingMs,
          pingError,
          permissionMode: config.permissionMode,
          ...tablesPayload,
        });
      } catch (error) {
        return fail(`获取连接状态失败: ${errorMessage(error)}`);
      }
    }
  );
}
