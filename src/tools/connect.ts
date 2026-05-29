import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { db } from "../db.js";
import { MySQLAdapter } from "../adapters/mysql.js";
import { PostgreSQLAdapter } from "../adapters/postgresql.js";
import { SQLiteAdapter } from "../adapters/sqlite.js";
import { MSSQLAdapter } from "../adapters/mssql.js";
import type { DatabaseType } from "../adapters/types.js";
import type { AppConfig } from "../config.js";
import { ok, fail, errorMessage } from "../utils/response.js";
import { safeListTablesPayload } from "./shared/table-list-payload.js";

/**
 * SECURITY: 严禁在此工具的 inputSchema 中加入任何与权限模式相关的字段
 * （如 mode / permission / readonly / allowDdl 等）。
 * 权限模式只能由 server 启动时的环境变量 PERMISSION_MODE 决定，
 * 加入运行时入参会让 LLM 在操作被拒后通过重连绕过限制，构成提权漏洞。
 *
 * connect — 动态连接数据库
 */
export function registerConnectTool(server: McpServer, config: AppConfig): void {
  server.registerTool(
    "connect",
    {
      description:
        "连接到数据库。支持 MySQL、PostgreSQL、SQLite、MSSQL 四种类型。传入连接参数后会建立新连接,之前的连接会被自动关闭。SQLite 只需要传 filepath 参数;MSSQL 在 SQL Server 2019+ 默认要求加密,自签证书环境需将 trustServerCertificate 设为 true。连接成功后返回当前数据库的表信息列表与当前权限模式(权限模式仅由 server 启动配置决定,无法通过此工具修改)。",
      inputSchema: {
        type: z.enum(["mysql", "postgresql", "sqlite", "mssql"]).describe("数据库类型"),
        host: z.string().default("localhost").describe("数据库主机地址(SQLite 不需要)"),
        port: z.number().default(0).describe("数据库端口(0 表示使用默认端口:MySQL 3306,PostgreSQL 5432,MSSQL 1433)"),
        user: z.string().default("").describe("数据库用户名(SQLite 不需要)"),
        password: z.string().default("").describe("数据库密码(SQLite 不需要)"),
        database: z.string().default("").describe("数据库名(SQLite 不需要)"),
        filepath: z.string().default("").describe("SQLite 数据库文件路径(仅 SQLite 使用)"),
        encrypt: z
          .boolean()
          .default(true)
          .describe("仅 MSSQL 使用:是否启用 TLS 加密(SQL Server 2019+ 默认要求),默认 true"),
        trustServerCertificate: z
          .boolean()
          .default(false)
          .describe("仅 MSSQL 使用:是否信任自签证书(开发/局域网常用),默认 false"),
      },
    },
    async ({ type, host, port, user, password, database, filepath, encrypt, trustServerCertificate }) => {
      try {
        const adapter = createAdapter(type, {
          host,
          port,
          user,
          password,
          database,
          filepath,
          encrypt,
          trustServerCertificate,
        });
        await db.connectWith(adapter);

        const connection = formatConnectionInfo(type, { host, port, database, filepath });
        const tablesPayload = await safeListTablesPayload();

        // 通知客户端 db://table/{name} 资源列表已变化(原库的表名不再适用)
        notifyResourceListChanged(server);

        return ok({
          message: `已成功连接到 ${connection}`,
          type,
          connection,
          permissionMode: config.permissionMode,
          ...tablesPayload,
          hint: "调用 describe_table 工具并传入表名可查看该表的列定义、索引、行数与采样数据;调用 list_tables 可重新拉取表信息列表。权限模式由 server 启动配置决定,重连不会改变。",
        });
      } catch (error) {
        return fail(`连接失败: ${errorMessage(error)}`);
      }
    }
  );
}

/**
 * 触发客户端刷新 resources/list。如果 server 未声明 resources 能力(理论不会发生),
 * 调用会抛错,这里吞掉避免影响 connect 本身。
 */
function notifyResourceListChanged(server: McpServer): void {
  try {
    server.sendResourceListChanged();
  } catch {
    // resource 通知不是关键路径,失败不应影响 connect 结果
  }
}

/** 各数据库默认端口 */
const DEFAULT_PORTS: Record<DatabaseType, number> = {
  mysql: 3306,
  postgresql: 5432,
  sqlite: 0,
  mssql: 1433,
};

/** 根据类型创建对应数据库适配器 */
function createAdapter(
  type: DatabaseType,
  params: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
    filepath: string;
    encrypt: boolean;
    trustServerCertificate: boolean;
  }
) {
  const resolvedPort = params.port === 0 ? DEFAULT_PORTS[type] : params.port;

  switch (type) {
    case "mysql":
      return new MySQLAdapter({
        host: params.host,
        port: resolvedPort,
        user: params.user,
        password: params.password,
        database: params.database,
      });
    case "postgresql":
      return new PostgreSQLAdapter({
        host: params.host,
        port: resolvedPort,
        user: params.user,
        password: params.password,
        database: params.database,
      });
    case "sqlite":
      if (!params.filepath) {
        throw new Error("SQLite 需要提供 filepath 参数");
      }
      return new SQLiteAdapter({ filepath: params.filepath });
    case "mssql":
      return new MSSQLAdapter({
        host: params.host,
        port: resolvedPort,
        user: params.user,
        password: params.password,
        database: params.database,
        encrypt: params.encrypt,
        trustServerCertificate: params.trustServerCertificate,
      });
    default:
      throw new Error(`不支持的数据库类型: ${type}`);
  }
}

/** 格式化连接信息用于显示 */
function formatConnectionInfo(
  type: DatabaseType,
  params: { host: string; port: number; database: string; filepath: string }
): string {
  if (type === "sqlite") {
    return `SQLite (${params.filepath})`;
  }
  const resolvedPort = params.port === 0 ? DEFAULT_PORTS[type] : params.port;
  const label = type === "mysql" ? "MySQL" : type === "postgresql" ? "PostgreSQL" : "MSSQL";
  const dbInfo = params.database ? `/${params.database}` : "";
  return `${label} ${params.host}:${resolvedPort}${dbInfo}`;
}
