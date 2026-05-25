import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { db } from "../db.js";
import { ok, fail, errorMessage } from "../utils/response.js";

/**
 * describe_table — 查看指定表的详细结构 + 行数估算 + 数据采样。
 * 三种信息合并返回,避免 LLM 多次往返;采样和行数对 LLM 写正确 SQL 至关重要。
 */
export function registerDescribeTableTool(server: McpServer): void {
  server.registerTool(
    "describe_table",
    {
      description:
        "查看指定表的详细信息,一次返回:列定义/索引/外键/估算行数/数据采样。LLM 在写 SQL 前调用此工具可同时拿到字段结构、关联关系、表大小量级、字段真实取值示例,大幅减少猜测。",
      inputSchema: {
        table: z.string().min(1).describe("要查看的表名"),
        sampleLimit: z
          .number()
          .int()
          .min(0)
          .max(20)
          .optional()
          .describe("采样数据行数,默认 3,0 表示不采样,最大 20"),
      },
    },
    async ({ table, sampleLimit }) => {
      const startedAt = performance.now();
      const limit = sampleLimit ?? 3;
      try {
        // 并行拉取三类信息,任一失败由整体 catch 处理
        const [description, rowCount, sample] = await Promise.all([
          db.describeTable(table),
          db.estimateRowCount(table).catch(() => ({ value: null, isEstimate: true })),
          limit > 0
            ? db.sampleData(table, limit).catch(() => [])
            : Promise.resolve([] as Record<string, unknown>[]),
        ]);

        return ok({
          table: description.table,
          columns: description.columns,
          indexes: description.indexes,
          foreignKeys: description.foreignKeys,
          rowCount: rowCount.value,
          rowCountIsEstimate: rowCount.isEstimate,
          sampleCount: sample.length,
          sample,
          elapsedMs: Math.round(performance.now() - startedAt),
        });
      } catch (error) {
        return fail(`获取表结构失败: ${errorMessage(error)}`);
      }
    }
  );
}
