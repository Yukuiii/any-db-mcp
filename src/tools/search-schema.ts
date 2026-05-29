import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { db } from "../db.js";
import type { TableColumn } from "../adapters/types.js";
import { ok, fail, errorMessage } from "../utils/response.js";

const SEARCH_SCHEMA_RESULT_LIMIT = 50;

/** Schema 搜索命中项,用于告诉 LLM 命中了表名、列名还是字段类型。 */
interface SchemaSearchMatch {
  kind: "table" | "column";
  matchedBy: "table" | "column" | "type";
  table: string;
  column?: string;
  type?: string;
  nullable?: boolean;
  key?: string;
  extra?: string;
}

/** search_schema — 按关键词搜索表名、列名和字段类型 */
export function registerSearchSchemaTool(server: McpServer): void {
  server.registerTool(
    "search_schema",
    {
      description:
        "按关键词搜索当前数据库 schema,匹配表名、列名和字段类型。适合在大库中快速定位相关表或字段,响应最多返回前 50 个命中项。",
      inputSchema: {
        keyword: z.string().min(1).describe("搜索关键词,会与表名、列名、字段类型做大小写不敏感匹配"),
      },
    },
    async ({ keyword }) => {
      const startedAt = performance.now();
      const normalizedKeyword = keyword.trim().toLowerCase();
      if (!normalizedKeyword) {
        return fail("搜索关键词不能为空。");
      }

      try {
        const tables = await db.listTables();

        // 并行 describe 各表:串行往返在大库下很慢,改为并发由连接池自动限流。
        // 按 listTables 顺序聚合,保证 matches / failedTables 输出顺序确定。
        const perTable = await Promise.all(
          tables.map(async ({ name: table }) => {
            const tableMatches: SchemaSearchMatch[] = [];
            if (includesKeyword(table, normalizedKeyword)) {
              tableMatches.push({ kind: "table", matchedBy: "table", table });
            }
            try {
              const description = await db.describeTable(table);
              for (const column of description.columns) {
                const match = matchColumn(table, column, normalizedKeyword);
                if (match) tableMatches.push(match);
              }
              return { matches: tableMatches, failed: null as { table: string; error: string } | null };
            } catch (error) {
              return { matches: tableMatches, failed: { table, error: errorMessage(error) } };
            }
          })
        );

        const matches: SchemaSearchMatch[] = perTable.flatMap((r) => r.matches);
        const failedTables = perTable
          .map((r) => r.failed)
          .filter((f): f is { table: string; error: string } => f !== null);

        const limitedMatches = matches.slice(0, SEARCH_SCHEMA_RESULT_LIMIT);
        return ok({
          keyword: keyword.trim(),
          scannedTableCount: tables.length,
          matchCount: limitedMatches.length,
          totalMatchCount: matches.length,
          limit: SEARCH_SCHEMA_RESULT_LIMIT,
          truncated: matches.length > SEARCH_SCHEMA_RESULT_LIMIT,
          matches: limitedMatches,
          failedTableCount: failedTables.length,
          failedTables,
          elapsedMs: Math.round(performance.now() - startedAt),
        });
      } catch (error) {
        return fail(`搜索 schema 失败: ${errorMessage(error)}`);
      }
    }
  );
}

/** 检查文本是否包含归一化后的关键词。 */
function includesKeyword(value: string, normalizedKeyword: string): boolean {
  return value.toLowerCase().includes(normalizedKeyword);
}

/** 将列名或字段类型命中转换为统一响应结构。 */
function matchColumn(
  table: string,
  column: TableColumn,
  normalizedKeyword: string
): SchemaSearchMatch | null {
  const matchedBy = includesKeyword(column.name, normalizedKeyword)
    ? "column"
    : includesKeyword(column.type, normalizedKeyword)
      ? "type"
      : null;

  if (!matchedBy) return null;
  return {
    kind: "column",
    matchedBy,
    table,
    column: column.name,
    type: column.type,
    nullable: column.nullable,
    key: column.key,
    extra: column.extra,
  };
}
