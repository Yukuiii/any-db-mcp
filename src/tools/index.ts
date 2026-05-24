import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppConfig } from "../config.js";
import { registerConnectTool } from "./connect.js";
import { registerDisconnectTool } from "./disconnect.js";
import { registerConnectionStatusTool } from "./connection-status.js";
import { registerQueryTool } from "./query.js";
import { registerExecuteTool } from "./execute.js";
import { registerTransactionTool } from "./transaction.js";
import { registerListTablesTool } from "./list-tables.js";
import { registerDescribeTableTool } from "./describe-table.js";
import { registerExplainTool } from "./explain.js";
import { registerResources } from "./resources.js";

/** 注册所有 MCP Tools 与 Resources 到 Server 实例 */
export function registerTools(server: McpServer, config: AppConfig): void {
  registerConnectTool(server, config);
  registerDisconnectTool(server);
  registerConnectionStatusTool(server, config);
  registerQueryTool(server);
  registerExecuteTool(server, config);
  registerTransactionTool(server, config);
  registerListTablesTool(server);
  registerDescribeTableTool(server);
  registerExplainTool(server);
  registerResources(server);
}
