import { db } from "../../db.js";
import type { TableInfo } from "../../adapters/types.js";
import { errorMessage } from "../../utils/response.js";

/** 表信息列表响应片段,供连接类工具复用。 */
type TableListPayload = {
  tableCount: number;
  tables: TableInfo[];
  warning?: string;
};

/** 拉取当前库的表信息列表,失败时返回 warning 字段而不抛错。 */
export async function safeListTablesPayload(): Promise<TableListPayload> {
  try {
    const tables = await db.listTables();
    return { tableCount: tables.length, tables };
  } catch (error) {
    return {
      tableCount: 0,
      tables: [],
      warning: `表信息列表获取失败（不影响连接状态）: ${errorMessage(error)}`,
    };
  }
}
