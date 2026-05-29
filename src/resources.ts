import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { db } from "./db.js";
import type { TableInfo } from "./adapters/types.js";

/**
 * 注册 MCP Resources。
 *
 * Resources 是 server 暴露给客户端的"可订阅静态/半静态数据",
 * 与 Tools 互补:Tools 用于命令式动作,Resources 用于让客户端
 * 主动消化 schema 上下文,减少 LLM 每次对话都调 list_tables / describe_table
 * 的 token 开销。
 *
 * 暴露三类:
 *   - db://tables          表清单 + 估算行数(连接后总览)
 *   - db://table/{name}    无 schema 表或兼容入口的列定义与索引
 *   - db://table/{schema}/{name}  跨 schema 精确单表结构
 *
 * 采样数据不暴露为 resource:采样是时效性数据,resource 语义偏静态。
 */
export function registerResources(server: McpServer): void {
  // ────────── db://tables:库总览 ──────────
  server.registerResource(
    "tables",
    "db://tables",
    {
      title: "数据库表清单",
      description:
        "当前连接数据库的所有表名、表注释与估算行数。Schema 浏览的入口,LLM 可一次拿到所有表的规模量级,辅助决策是否进一步 describe。",
      mimeType: "application/json",
    },
    async (uri) => {
      if (!db.isConnected()) {
        return resourceJson(uri.href, {
          connected: false,
          message: "尚未连接数据库,请先调用 connect 工具",
        });
      }
      const tables = await db.listTables();
      // 行数与表名并行,任一失败不影响整体
      const stats = await Promise.all(
        tables.map(async ({ schema, name, comment }) => {
          const rc = await db
            .estimateRowCount(name, schema ?? undefined)
            .catch(() => ({ value: null, isEstimate: true }));
          return {
            schema,
            table: name,
            comment,
            rowCount: rc.value,
            rowCountIsEstimate: rc.isEstimate,
          };
        })
      );
      return resourceJson(uri.href, {
        connected: true,
        databaseType: db.getType(),
        tableCount: tables.length,
        tables: stats,
      });
    }
  );

  // ────────── db://table/{name}:无 schema 或兼容入口 ──────────
  server.registerResource(
    "table",
    new ResourceTemplate("db://table/{name}", {
      list: async () => {
        if (!db.isConnected()) return { resources: [] };
        const tables = await db.listTables().catch(() => [] as TableInfo[]);
        return {
          resources: tables
            .filter(({ schema }) => schema === null)
            .map(({ name }) => ({
              uri: `db://table/${encodeURIComponent(name)}`,
              name,
              description: `表 ${name} 的列定义与索引`,
              mimeType: "application/json",
            })),
        };
      },
    }),
    {
      title: "数据库表结构",
      description:
        "单张表的列定义、索引与主键信息。不含采样数据(采样有时效性,如需采样请调用 describe_table 工具)。",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      if (!db.isConnected()) {
        return resourceJson(uri.href, {
          connected: false,
          message: "尚未连接数据库,请先调用 connect 工具",
        });
      }
      const raw = Array.isArray(variables.name) ? variables.name[0] : variables.name;
      const tableName = decodeURIComponent(String(raw ?? ""));
      if (!tableName) {
        return resourceJson(uri.href, {
          error: "URI 中缺少表名,期望 db://table/{name}",
        });
      }
      return readTableResource(uri.href, tableName);
    }
  );

  // ────────── db://table/{schema}/{name}:跨 schema 精确表结构 ──────────
  server.registerResource(
    "table-with-schema",
    new ResourceTemplate("db://table/{schema}/{name}", {
      list: async () => {
        if (!db.isConnected()) return { resources: [] };
        const tables = await db.listTables().catch(() => [] as TableInfo[]);
        return {
          resources: tables
            .filter(({ schema }) => schema !== null)
            .map(({ schema, name }) => ({
              uri: `db://table/${encodeURIComponent(schema!)}/${encodeURIComponent(name)}`,
              name: `${schema}.${name}`,
              description: `表 ${schema}.${name} 的列定义与索引`,
              mimeType: "application/json",
            })),
        };
      },
    }),
    {
      title: "数据库表结构",
      description:
        "指定 schema 下单张表的列定义、索引与主键信息。不含采样数据(采样有时效性,如需采样请调用 describe_table 工具)。",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      if (!db.isConnected()) {
        return resourceJson(uri.href, {
          connected: false,
          message: "尚未连接数据库,请先调用 connect 工具",
        });
      }
      const rawSchema = Array.isArray(variables.schema) ? variables.schema[0] : variables.schema;
      const rawName = Array.isArray(variables.name) ? variables.name[0] : variables.name;
      const schema = decodeURIComponent(String(rawSchema ?? ""));
      const tableName = decodeURIComponent(String(rawName ?? ""));
      if (!schema || !tableName) {
        return resourceJson(uri.href, {
          error: "URI 中缺少 schema 或表名,期望 db://table/{schema}/{name}",
        });
      }
      return readTableResource(uri.href, tableName, schema);
    }
  );
}

/** 读取单表 resource,统一处理不存在与跨 schema 歧义错误。 */
async function readTableResource(uri: string, tableName: string, schema?: string) {
  try {
    const desc = await db.describeTable(tableName, schema);
    // 各 driver 对"表不存在"行为不一致:MySQL 抛错,SQLite/PG 静默返回空。
    // 在 resource 层统一:列空且索引空视为不存在,给出明确错误。
    if (desc.columns.length === 0 && desc.indexes.length === 0) {
      return resourceJson(uri, {
        error: `表 ${schema ? `${schema}.` : ""}${tableName} 不存在或当前用户无权访问`,
      });
    }
    return resourceJson(uri, {
      schema: desc.schema,
      table: desc.table,
      columns: desc.columns,
      indexes: desc.indexes,
    });
  } catch (err) {
    return resourceJson(uri, {
      error: `获取表 ${schema ? `${schema}.` : ""}${tableName} 结构失败: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

/** 统一构造 application/json 类型的 ReadResource 响应 */
function resourceJson(uri: string, data: unknown) {
  return {
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}
