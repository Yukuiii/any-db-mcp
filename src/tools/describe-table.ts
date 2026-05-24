import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { db } from "../db.js";
import { ok, fail, errorMessage } from "./response.js";

/** describe_table — 查看指定表的详细结构（列定义 + 索引） */
export function registerDescribeTableTool(server: McpServer): void {
  server.registerTool(
    "describe_table",
    {
      description:
        "查看指定表的详细结构，包括所有列的定义（名称、类型、是否可空、默认值、是否主键）和索引信息。LLM 在写 SQL 前可调用此工具获取字段精确信息。",
      inputSchema: {
        table: z.string().min(1).describe("要查看结构的表名"),
      },
    },
    async ({ table }) => {
      try {
        const description = await db.describeTable(table);
        return ok({
          table: description.table,
          columns: description.columns,
          indexes: description.indexes,
        });
      } catch (error) {
        return fail(`获取表结构失败: ${errorMessage(error)}`);
      }
    }
  );
}
