/** SQL 类型校验正则 */
export const READONLY_SQL_PATTERN = /^\s*(SELECT|SHOW|DESCRIBE|DESC)\b/i;
export const WRITE_SQL_PATTERN = /^\s*(INSERT|UPDATE|DELETE)\b/i;
export const DANGEROUS_SQL_PATTERN = /^\s*(DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE)\b/i;

/** 多语句检测结果 */
export interface SingleStatementCheck {
  ok: boolean;
  reason?: string;
}

/**
 * 检测 SQL 是否只包含单条语句。
 *
 * 必须拦截:权限正则只匹配 SQL 起始关键字,若放任分号多语句,
 * 攻击者可在 readwrite 模式下用 `INSERT INTO x VALUES(1); DROP TABLE y`
 * 绕过 DDL 防御;在 readonly 模式下用 `SELECT 1; DELETE FROM t`
 * 绕过只读防御。PostgreSQL 驱动默认允许 Simple Query 多语句,本检查
 * 在应用层堵死这条路径。MySQL2 默认 multipleStatements=false 与
 * better-sqlite3 单语句编译同样依赖此检查兜底。
 *
 * 实现:词法扫描跳过字符串字面值('...'、"..."、`...`)、行注释(-- 至换行)
 * 与块注释(/* ... *​/),再检测剩余文本中是否存在"分号 + 后续非空字符"。
 * 允许尾部单个 `;`,这是常见手抖,无害。
 */
export function checkSingleStatement(sql: string): SingleStatementCheck {
  const stripped = stripStringsAndComments(sql);
  const idx = stripped.indexOf(";");
  if (idx === -1) return { ok: true };
  // 分号之后是否还有任何非空字符
  if (/\S/.test(stripped.slice(idx + 1))) {
    return {
      ok: false,
      reason:
        "检测到多条 SQL 语句(分号分隔)。每个工具调用只允许单条语句,如需批量执行请使用 transaction 工具(逐条原子提交)。",
    };
  }
  return { ok: true };
}

/**
 * 词法扫描去除字符串字面值、标识符引号与注释,
 * 保留结构性字符(尤其是分号)供上层判断。
 */
function stripStringsAndComments(sql: string): string {
  let out = "";
  const n = sql.length;
  let i = 0;
  while (i < n) {
    const c = sql[i];
    const c2 = i + 1 < n ? sql[i + 1] : "";

    // 行注释 -- 直到换行
    if (c === "-" && c2 === "-") {
      while (i < n && sql[i] !== "\n") i++;
      continue;
    }
    // 块注释 /* ... */
    if (c === "/" && c2 === "*") {
      i += 2;
      while (i + 1 < n && !(sql[i] === "*" && sql[i + 1] === "/")) i++;
      i = Math.min(i + 2, n);
      continue;
    }
    // 单引号字符串
    if (c === "'") {
      i = skipQuoted(sql, i, "'");
      continue;
    }
    // 双引号标识符(PG/SQLite/MySQL ANSI_QUOTES)
    if (c === '"') {
      i = skipQuoted(sql, i, '"');
      continue;
    }
    // MySQL 反引号标识符
    if (c === "`") {
      i = skipBacktick(sql, i);
      continue;
    }

    out += c;
    i++;
  }
  return out;
}

/**
 * 跳过单引号或双引号包裹的内容,同时兼容两类转义:
 *  - SQL 标准的双字符转义('' / "")
 *  - MySQL 风格的反斜杠转义(\\' 等),宁可保守跳过,避免误判
 */
function skipQuoted(sql: string, start: number, q: string): number {
  const n = sql.length;
  let i = start + 1;
  while (i < n) {
    const c = sql[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === q) {
      if (sql[i + 1] === q) {
        i += 2;
        continue;
      }
      return i + 1;
    }
    i++;
  }
  return n;
}

/** 反引号:MySQL 标识符;内部双反引号转义 */
function skipBacktick(sql: string, start: number): number {
  const n = sql.length;
  let i = start + 1;
  while (i < n) {
    if (sql[i] === "`") {
      if (sql[i + 1] === "`") {
        i += 2;
        continue;
      }
      return i + 1;
    }
    i++;
  }
  return n;
}
