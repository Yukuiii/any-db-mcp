import type { PermissionMode } from "../config.js";
import { WRITE_SQL_PATTERN, DANGEROUS_SQL_PATTERN } from "./sql-patterns.js";

/** 权限校验结果 */
export interface PermissionCheckResult {
  allowed: boolean;
  /** 拒绝原因（allowed=false 时有值） */
  reason?: string;
}

/**
 * 根据权限模式校验一条 SQL 是否可作为写操作执行（用于 execute / transaction）。
 *
 * - readonly: 拒绝任何写操作
 * - readwrite: 仅允许 DML（INSERT/UPDATE/DELETE），禁止 DDL
 * - full: 允许 DML + DDL（DROP/TRUNCATE/ALTER/CREATE/GRANT/REVOKE）
 */
export function checkWritePermission(sql: string, mode: PermissionMode): PermissionCheckResult {
  if (mode === "readonly") {
    return {
      allowed: false,
      reason:
        "当前权限模式为 readonly，禁止任何写操作。如需写入，请重启 server 并设置 PERMISSION_MODE=readwrite 或 full。",
    };
  }

  const isDml = WRITE_SQL_PATTERN.test(sql);
  const isDdl = DANGEROUS_SQL_PATTERN.test(sql);

  if (mode === "readwrite") {
    if (isDdl) {
      return {
        allowed: false,
        reason:
          "当前权限模式为 readwrite，禁止执行 DDL 操作（DROP/TRUNCATE/ALTER/CREATE/GRANT/REVOKE）。如需执行 DDL，请重启 server 并设置 PERMISSION_MODE=full。",
      };
    }
    if (!isDml) {
      return {
        allowed: false,
        reason:
          "SQL 不是合法的写操作。execute / transaction 工具仅支持 INSERT / UPDATE / DELETE。如需查询数据，请使用 query 工具。",
      };
    }
    return { allowed: true };
  }

  // mode === "full"
  if (!isDml && !isDdl) {
    return {
      allowed: false,
      reason:
        "SQL 既不是 DML 也不是 DDL。execute / transaction 工具支持 INSERT/UPDATE/DELETE 以及 DROP/TRUNCATE/ALTER/CREATE/GRANT/REVOKE。如需查询数据，请使用 query 工具。",
    };
  }
  return { allowed: true };
}
