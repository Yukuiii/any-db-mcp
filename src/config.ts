import type { DatabaseType } from "./adapters/types.js";

/**
 * SECURITY: PermissionMode 是权限信任的源头，遵守以下不可逾越的规则：
 *  1. 只能通过环境变量 PERMISSION_MODE 在 server 启动时一次性设定；
 *  2. 加载完成后 AppConfig 被 Object.freeze 冻结，运行时任何 MCP 工具都无法修改；
 *  3. 禁止在 connect/disconnect 或任何工具的 inputSchema 中暴露权限相关字段，
 *     防止 LLM 在操作被拒后通过"提权式重连"绕过限制。
 */
export type PermissionMode = "readonly" | "readwrite" | "full";

/** 合法 mode 集合，用于环境变量校验 */
export const PERMISSION_MODES: readonly PermissionMode[] = ["readonly", "readwrite", "full"] as const;

/** Server 传输方式 */
export type TransportType = "stdio" | "http";
export const TRANSPORT_TYPES: readonly TransportType[] = ["stdio", "http"] as const;

/** HTTP 传输配置(仅当 transport=http 时生效) */
export interface HttpConfig {
  /** 监听主机,默认 127.0.0.1。远程访问设为 0.0.0.0 时务必配置 authToken */
  readonly host: string;
  /** 监听端口,默认 3000 */
  readonly port: number;
  /** MCP endpoint path,默认 /mcp */
  readonly path: string;
  /** 可选 Bearer Token,设置后所有 HTTP 请求需带 Authorization: Bearer <token>;为空则不鉴权 */
  readonly authToken: string;
}

/** 数据库连接配置（支持多种数据库类型，启动后不可变） */
export interface DbConfig {
  readonly type: DatabaseType;
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly database: string;
  /** PostgreSQL/MSSQL 专属:schema 名称,空值由适配器使用默认 schema */
  readonly schema: string;
  /** SQLite 文件路径 */
  readonly filepath: string;
  /** MSSQL 专属:是否启用 TLS 加密(SQL Server 2019+ 默认要求) */
  readonly encrypt: boolean;
  /** MSSQL 专属:是否信任自签证书(开发/局域网常用) */
  readonly trustServerCertificate: boolean;
}

/** 应用配置，启动后不可变 */
export interface AppConfig {
  readonly db: DbConfig | null;
  readonly permissionMode: PermissionMode;
  readonly transport: TransportType;
  readonly http: HttpConfig;
  /** query 工具超时时间,单位 ms */
  readonly queryTimeoutMs: number;
}

/** 各数据库类型的默认端口 */
const DEFAULT_PORTS: Record<DatabaseType, number> = {
  mysql: 3306,
  postgresql: 5432,
  sqlite: 0,
  mssql: 1433,
};

/**
 * 从环境变量加载应用配置。数据库连接信息可选。
 * 返回的对象被 Object.freeze 深冻结，任何修改都会在严格模式下抛错，
 * 防止运行时被 MCP 工具或其它代码改写 permissionMode 等关键字段。
 */
export function loadConfig(): AppConfig {
  const hasDbConfig = process.env.DB_HOST || process.env.DB_USER || process.env.DB_FILEPATH;
  const dbType = (process.env.DB_TYPE as DatabaseType) || "mysql";
  const defaultPort = DEFAULT_PORTS[dbType] || 3306;

  const config: AppConfig = {
    db: hasDbConfig
      ? Object.freeze({
          type: dbType,
          host: process.env.DB_HOST || "localhost",
          port: parseInt(process.env.DB_PORT || String(defaultPort), 10),
          user: process.env.DB_USER || "root",
          password: process.env.DB_PASSWORD || "",
          database: process.env.DB_NAME || "",
          schema: process.env.DB_SCHEMA || "",
          filepath: process.env.DB_FILEPATH || "",
          encrypt: parseBool(process.env.DB_ENCRYPT, true),
          trustServerCertificate: parseBool(process.env.DB_TRUST_SERVER_CERTIFICATE, false),
        })
      : null,
    permissionMode: parsePermissionMode(process.env.PERMISSION_MODE),
    transport: parseTransport(process.env.MCP_TRANSPORT),
    http: Object.freeze({
      host: process.env.MCP_HTTP_HOST || "127.0.0.1",
      port: parseInt(process.env.MCP_HTTP_PORT || "3000", 10),
      path: process.env.MCP_HTTP_PATH || "/mcp",
      authToken: process.env.MCP_AUTH_TOKEN || "",
    }),
    queryTimeoutMs: parsePositiveInt(process.env.QUERY_TIMEOUT_MS, 30000, "QUERY_TIMEOUT_MS"),
  };

  return Object.freeze(config);
}

/** 解析 MCP_TRANSPORT,非法值降级 stdio 并打 warning */
function parseTransport(value: string | undefined): TransportType {
  if (!value) return "stdio";
  const normalized = value.toLowerCase() as TransportType;
  if (TRANSPORT_TYPES.includes(normalized)) {
    return normalized;
  }
  console.error(
    `[any-db-mcp] 非法的 MCP_TRANSPORT="${value}",已降级到默认值 "stdio"。合法值:${TRANSPORT_TYPES.join(" | ")}`
  );
  return "stdio";
}

/** 解析布尔环境变量,接受 "1"/"true"/"yes" 为真,空值用默认 */
function parseBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === "") return defaultValue;
  const v = value.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return defaultValue;
}

/** 解析正整数环境变量,非法值降级为默认值并打 warning */
function parsePositiveInt(value: string | undefined, defaultValue: number, name: string): number {
  if (value === undefined || value === "") return defaultValue;
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }
  console.error(`[any-db-mcp] 非法的 ${name}="${value}",已降级到默认值 ${defaultValue}。`);
  return defaultValue;
}

/** 解析权限模式，非法值降级到 readwrite 并打 warning */
function parsePermissionMode(value: string | undefined): PermissionMode {
  if (!value) return "readwrite";
  const normalized = value.toLowerCase() as PermissionMode;
  if (PERMISSION_MODES.includes(normalized)) {
    return normalized;
  }
  console.error(
    `[any-db-mcp] 非法的 PERMISSION_MODE="${value}"，已降级到默认值 "readwrite"。合法值：${PERMISSION_MODES.join(" | ")}`
  );
  return "readwrite";
}
