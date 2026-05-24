import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { db } from "../db.js";
import { ok, fail, errorMessage } from "./response.js";

/** disconnect — 主动断开当前数据库连接 */
export function registerDisconnectTool(server: McpServer): void {
  server.registerTool(
    "disconnect",
    {
      description:
        "主动断开当前数据库连接并释放连接池。断开后再次执行 query / execute 等操作前需调用 connect 工具重新连接。未连接时调用也安全(幂等)。",
    },
    async () => {
      try {
        const wasConnected = db.isConnected();
        await db.disconnect();
        if (wasConnected) {
          // 通知客户端 db://table/{name} 列表已清空
          try {
            server.sendResourceListChanged();
          } catch {
            // resource 通知失败不影响 disconnect 结果
          }
        }
        return ok({
          wasConnected,
          message: wasConnected ? "已断开数据库连接" : "本就未连接,无需操作",
        });
      } catch (error) {
        return fail(`断开连接失败: ${errorMessage(error)}`);
      }
    }
  );
}
