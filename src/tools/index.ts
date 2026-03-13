import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppConfig } from "../config.js";
import { registerConnectTool } from "./connect.js";
import { registerQueryTool } from "./query.js";
import { registerExecuteTool } from "./execute.js";
import { registerListTablesTool } from "./list-tables.js";
import { registerDescribeTableTool } from "./describe-table.js";
import { registerListDatabasesTool } from "./list-databases.js";

/** 注册所有 MCP Tools 到 Server 实例 */
export function registerTools(server: McpServer, config: AppConfig): void {
  registerConnectTool(server);
  registerQueryTool(server);
  registerExecuteTool(server, config);
  registerListTablesTool(server);
  registerDescribeTableTool(server);
  registerListDatabasesTool(server);
}
