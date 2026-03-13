import type { DatabaseType } from "./adapters/types.js";

/** 数据库连接配置（支持多种数据库类型） */
export interface DbConfig {
  type: DatabaseType;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  /** SQLite 文件路径 */
  filepath: string;
}

export interface AppConfig {
  db: DbConfig | null;
  readonlyMode: boolean;
}

/** 各数据库类型的默认端口 */
const DEFAULT_PORTS: Record<DatabaseType, number> = {
  mysql: 3306,
  postgresql: 5432,
  sqlite: 0,
};

/** 从环境变量加载应用配置，数据库连接信息可选 */
export function loadConfig(): AppConfig {
  const hasDbConfig = process.env.DB_HOST || process.env.DB_USER || process.env.DB_FILEPATH;
  const dbType = (process.env.DB_TYPE as DatabaseType) || "mysql";
  const defaultPort = DEFAULT_PORTS[dbType] || 3306;

  return {
    db: hasDbConfig
      ? {
          type: dbType,
          host: process.env.DB_HOST || "localhost",
          port: parseInt(process.env.DB_PORT || String(defaultPort), 10),
          user: process.env.DB_USER || "root",
          password: process.env.DB_PASSWORD || "",
          database: process.env.DB_NAME || "",
          filepath: process.env.DB_FILEPATH || "",
        }
      : null,
    readonlyMode: process.env.READONLY_MODE === "true",
  };
}
