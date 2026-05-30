import oracledb from "oracledb";
import type {
  DatabaseAdapter,
  ExecuteResult,
  ForeignKey,
  TableColumn,
  TableDescription,
  TableIndex,
  TableInfo,
  TableRowCount,
  TransactionResult,
  TransactionStepResult,
} from "./types.js";

/** Oracle 连接配置 */
export interface OracleConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  /** Oracle service name 或 TNS connect string。 */
  database: string;
  /** 空值表示所有非系统 schema,有值时限定 list/describe/sample/rowCount 的 schema */
  schema?: string;
}

interface OracleTableTarget {
  schema: string;
  table: string;
}

type OracleBinds = oracledb.BindParameters;

const ORACLE_SYSTEM_SCHEMAS = [
  "SYS",
  "SYSTEM",
  "OUTLN",
  "DBSNMP",
  "APPQOSSYS",
  "AUDSYS",
  "CTXSYS",
  "DVSYS",
  "GSMADMIN_INTERNAL",
  "MDSYS",
  "OJVMSYS",
  "ORDDATA",
  "ORDSYS",
  "WMSYS",
  "XDB",
  "LBACSYS",
  "OLAPSYS",
  "SI_INFORMTN_SCHEMA",
  "ANONYMOUS",
  "APEX_PUBLIC_USER",
  "FLOWS_FILES",
  "ORDPLUGINS",
  "MDDATA",
  "REMOTE_SCHEDULER_AGENT",
  "SYSBACKUP",
  "SYSDG",
  "SYSKM",
  "SYSRAC",
];

const ORACLE_SYSTEM_SCHEMA_LIST = ORACLE_SYSTEM_SCHEMAS.map((schema) => `'${schema}'`).join(", ");

/** Oracle Database 适配器 */
export class OracleAdapter implements DatabaseAdapter {
  readonly type = "oracle" as const;
  private pool: oracledb.Pool | null = null;
  private config: OracleConfig;
  private schema: string | null;

  constructor(config: OracleConfig) {
    this.config = config;
    this.schema = normalizeOracleName(config.schema);
  }

  /** 创建连接池并验证可用性 */
  async connect(): Promise<void> {
    this.pool = await oracledb.createPool({
      user: this.config.user,
      password: this.config.password,
      connectString: buildConnectString(this.config),
      poolMin: 0,
      poolMax: 10,
      poolIncrement: 1,
      queueTimeout: 30_000,
    });
    await this.ping();
  }

  /** 销毁连接池 */
  async disconnect(): Promise<void> {
    if (this.pool) {
      try {
        await this.pool.close(0);
      } finally {
        this.pool = null;
      }
    }
  }

  /** 健康检查:借出连接并调用 Oracle 原生 ping。 */
  async ping(): Promise<void> {
    await this.withConnection(async (connection) => {
      await connection.ping();
    });
  }

  /** 执行只读查询 */
  async query(sql: string): Promise<Record<string, unknown>[]> {
    return this.withRetry(async () => this.executeRows(sql));
  }

  /** 获取执行计划:使用 EXPLAIN PLAN + DBMS_XPLAN,不执行原 SQL。 */
  async explain(sql: string): Promise<Record<string, unknown>[]> {
    return this.withRetry(async () =>
      this.withConnection(async (connection) => {
        const statementId = createStatementId();
        await connection.execute(`EXPLAIN PLAN SET STATEMENT_ID = '${statementId}' FOR ${sql}`);
        const result = await connection.execute<{ plan: string }>(
          `SELECT plan_table_output AS "plan"
           FROM TABLE(DBMS_XPLAN.DISPLAY(NULL, :statementId, 'BASIC +PREDICATE +COST'))`,
          { statementId },
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        await connection.rollback().catch(() => undefined);
        return (result.rows ?? []).map((row) => ({ plan: row.plan }));
      })
    );
  }

  /** 执行修改语句 */
  async execute(sql: string): Promise<ExecuteResult> {
    return this.withRetry(async () =>
      this.withConnection(async (connection) => {
        const result = await connection.execute(sql, {}, { autoCommit: true });
        return { affectedRows: result.rowsAffected ?? 0, insertId: 0 };
      })
    );
  }

  /**
   * 在事务中顺序执行多条 SQL。
   * Oracle DDL 会隐式提交,调用方仍需通过权限模式控制 DDL 使用。
   */
  async transaction(sqls: string[]): Promise<TransactionResult> {
    this.ensureConnected();
    const connection = await this.pool!.getConnection();
    const steps: TransactionStepResult[] = [];
    try {
      for (let i = 0; i < sqls.length; i++) {
        const sql = sqls[i];
        try {
          const result = await connection.execute(sql);
          steps.push({
            index: i,
            sql,
            affectedRows: result.rowsAffected ?? 0,
            insertId: 0,
          });
        } catch (err) {
          await connection.rollback().catch(() => undefined);
          const baseError = err instanceof Error ? err.message : String(err);
          // Oracle DDL 会隐式提交:若前序步骤含 DDL,它们已落库且无法随本次 rollback 撤销,需如实告知调用方
          const priorDDL = steps.some((step) => isOracleDDL(step.sql));
          return {
            committed: false,
            steps,
            failedAt: i,
            error: priorDDL
              ? `${baseError}(注意:前序 DDL 语句在 Oracle 中已隐式提交,无法随本次失败回滚)`
              : baseError,
          };
        }
      }
      await connection.commit();
      return { committed: true, steps, failedAt: null, error: null };
    } finally {
      await connection.close().catch(() => undefined);
    }
  }

  /** 列出当前用户可见的指定 schema 或所有非系统 schema 下的表(含表注释) */
  async listTables(): Promise<TableInfo[]> {
    return this.withRetry(async () => {
      const rows = await this.executeRows<{ schema: string; name: string; comment: string | null }>(
        `SELECT t.owner AS "schema", t.table_name AS "name", c.comments AS "comment"
         FROM all_tables t
         LEFT JOIN all_tab_comments c ON c.owner = t.owner AND c.table_name = t.table_name
         WHERE (
           (:schema IS NULL AND ${nonSystemOwnerCondition("t.owner")})
           OR t.owner = :schema
           OR t.owner = UPPER(:schema)
         )
         ORDER BY t.owner, t.table_name`,
        { schema: this.schema }
      );
      return rows.map((row) => ({
        schema: row.schema,
        name: row.name,
        comment: normalizeComment(row.comment),
      }));
    });
  }

  /** 查看表结构 */
  async describeTable(table: string, schema?: string): Promise<TableDescription> {
    return this.withRetry(async () => {
      const target = await this.resolveTableTarget(table, schema);
      if (!target) {
        return { schema: null, table, columns: [], indexes: [], foreignKeys: [] };
      }

      const colRows = await this.executeRows<{
        name: string;
        dataType: string;
        nullable: string;
        defaultValue: string | null;
        dataLength: number | null;
        charLength: number | null;
        precision: number | null;
        scale: number | null;
        comment: string | null;
      }>(
        `SELECT c.column_name AS "name",
                c.data_type AS "dataType",
                c.nullable AS "nullable",
                c.data_default AS "defaultValue",
                c.data_length AS "dataLength",
                c.char_length AS "charLength",
                c.data_precision AS "precision",
                c.data_scale AS "scale",
                cc.comments AS "comment"
         FROM all_tab_columns c
         LEFT JOIN all_col_comments cc
           ON cc.owner = c.owner AND cc.table_name = c.table_name AND cc.column_name = c.column_name
         WHERE c.owner = :schema AND c.table_name = :table
         ORDER BY c.column_id`,
        tableTargetBinds(target)
      );
      const columns: TableColumn[] = colRows.map((row) => ({
        name: row.name,
        type: formatOracleType(row),
        nullable: row.nullable === "Y",
        defaultValue: normalizeString(row.defaultValue),
        key: "",
        extra: "",
        comment: normalizeComment(row.comment),
      }));

      const indexRows = await this.executeRows<{
        name: string;
        column: string;
        uniqueness: string;
      }>(
        `SELECT i.index_name AS "name", c.column_name AS "column", i.uniqueness AS "uniqueness"
         FROM all_indexes i
         JOIN all_ind_columns c ON c.index_owner = i.owner AND c.index_name = i.index_name
         WHERE i.owner = :schema AND i.table_name = :table
         ORDER BY i.index_name, c.column_position`,
        tableTargetBinds(target)
      );
      const indexMap = new Map<string, TableIndex>();
      for (const row of indexRows) {
        if (!indexMap.has(row.name)) {
          indexMap.set(row.name, {
            name: row.name,
            columns: [],
            unique: row.uniqueness === "UNIQUE",
          });
        }
        indexMap.get(row.name)!.columns.push(row.column);
      }

      const pkRows = await this.executeRows<{ column: string }>(
        `SELECT cc.column_name AS "column"
         FROM all_constraints c
         JOIN all_cons_columns cc ON cc.owner = c.owner AND cc.constraint_name = c.constraint_name
         WHERE c.owner = :schema AND c.table_name = :table AND c.constraint_type = 'P'`,
        tableTargetBinds(target)
      );
      const pkColumns = new Set(pkRows.map((row) => row.column));
      for (const column of columns) {
        if (pkColumns.has(column.name)) column.key = "PRI";
      }

      const fkRows = await this.executeRows<{
        column: string;
        referencedSchema: string;
        referencedTable: string;
        referencedColumn: string;
        constraintName: string;
      }>(
        `SELECT child_cols.column_name AS "column",
                parent.owner AS "referencedSchema",
                parent.table_name AS "referencedTable",
                parent_cols.column_name AS "referencedColumn",
                child.constraint_name AS "constraintName"
         FROM all_constraints child
         JOIN all_cons_columns child_cols
           ON child_cols.owner = child.owner AND child_cols.constraint_name = child.constraint_name
         JOIN all_constraints parent
           ON parent.owner = child.r_owner AND parent.constraint_name = child.r_constraint_name
         JOIN all_cons_columns parent_cols
           ON parent_cols.owner = parent.owner
          AND parent_cols.constraint_name = parent.constraint_name
          AND parent_cols.position = child_cols.position
         WHERE child.owner = :schema AND child.table_name = :table AND child.constraint_type = 'R'
         ORDER BY child.constraint_name, child_cols.position`,
        tableTargetBinds(target)
      );
      const foreignKeys: ForeignKey[] = fkRows.map((row) => ({
        column: row.column,
        referencedTable: `${row.referencedSchema}.${row.referencedTable}`,
        referencedColumn: row.referencedColumn,
        constraintName: row.constraintName,
      }));

      return {
        schema: target.schema,
        table: target.table,
        columns,
        indexes: Array.from(indexMap.values()),
        foreignKeys,
      };
    });
  }

  /** 采样前 N 行数据 */
  async sampleData(table: string, limit: number, schema?: string): Promise<Record<string, unknown>[]> {
    return this.withRetry(async () => {
      const target = await this.resolveTableTarget(table, schema);
      if (!target) return [];
      const safeLimit = clampLimit(limit);
      return this.executeRows(`SELECT * FROM ${quoteOracleQualifiedIdent(target)} WHERE ROWNUM <= ${safeLimit}`);
    });
  }

  /** 使用 ALL_TABLES.NUM_ROWS 估算行数,未收集统计信息时返回 null。 */
  async estimateRowCount(table: string, schema?: string): Promise<TableRowCount> {
    return this.withRetry(async () => {
      const target = await this.resolveTableTarget(table, schema);
      if (!target) return { value: null, isEstimate: true };
      const rows = await this.executeRows<{ rows: number | string | null }>(
        `SELECT num_rows AS "rows"
         FROM all_tables
         WHERE owner = :schema AND table_name = :table`,
        tableTargetBinds(target)
      );
      const raw = rows[0]?.rows;
      const value = raw == null ? null : Number(raw);
      return { value: Number.isFinite(value as number) ? (value as number) : null, isEstimate: true };
    });
  }

  /** 操作包装:捕获连接级错误自动重建连接池并重试一次。 */
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (!isOracleConnectionLost(err)) throw err;
      console.error(`[any-db-mcp] Oracle 连接丢失(${(err as Error).message}),重建连接池后重试一次...`);
      await this.rebuildPool();
      return await fn();
    }
  }

  /** 借出连接执行操作,结束后归还连接池。 */
  private async withConnection<T>(fn: (connection: oracledb.Connection) => Promise<T>): Promise<T> {
    this.ensureConnected();
    const connection = await this.pool!.getConnection();
    try {
      return await fn(connection);
    } finally {
      await connection.close().catch(() => undefined);
    }
  }

  /** 执行查询并以对象数组返回行。 */
  private async executeRows<T = Record<string, unknown>>(
    sql: string,
    binds: OracleBinds = {}
  ): Promise<T[]> {
    return this.withConnection(async (connection) => {
      const result = await connection.execute<T>(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      return (result.rows ?? []) as T[];
    });
  }

  /** 销毁并重建连接池。 */
  private async rebuildPool(): Promise<void> {
    if (this.pool) {
      try {
        await this.pool.close(0);
      } catch {
        // 忽略旧 pool 销毁错误
      }
      this.pool = null;
    }
    await this.connect();
  }

  private ensureConnected(): void {
    if (!this.pool) {
      throw new Error("Oracle 未连接");
    }
  }

  /** 解析表所属 schema 和真实表名;未指定时只允许唯一匹配,避免跨 schema 同名表误查。 */
  private async resolveTableTarget(table: string, requestedSchema?: string): Promise<OracleTableTarget | null> {
    const explicitSchema = normalizeOracleName(requestedSchema) ?? this.schema;
    const rows = await this.findTableTargets(table, explicitSchema);
    if (explicitSchema) return rows[0] ?? null;
    if (rows.length === 0) return null;
    if (rows.length === 1) return rows[0];

    const candidates = rows.map((row) => `${row.schema}.${row.table}`).join(", ");
    throw new Error(`表 ${table} 在多个 schema 中存在,请指定 schema。候选:${candidates}`);
  }

  /** 按表名查找可访问的真实 owner/table 组合。 */
  private async findTableTargets(table: string, schema: string | null): Promise<OracleTableTarget[]> {
    const rows = await this.executeRows<OracleTableTarget>(
      `SELECT owner AS "schema", table_name AS "table"
       FROM all_tables
       WHERE (table_name = :table OR table_name = UPPER(:table))
         AND (
           (:schema IS NOT NULL AND (owner = :schema OR owner = UPPER(:schema)))
           OR (:schema IS NULL AND ${nonSystemOwnerCondition("owner")})
         )
       ORDER BY CASE WHEN table_name = :table THEN 0 ELSE 1 END, owner`,
      { table, schema }
    );
    const seen = new Set<string>();
    return rows.filter((row) => {
      const key = `${row.schema}.${row.table}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}

/** 将表定位信息转换为 Oracle bind 参数对象。 */
function tableTargetBinds(target: OracleTableTarget): OracleBinds {
  return { schema: target.schema, table: target.table };
}

/** 判定是否为 Oracle 连接级错误(值得重连重试)。 */
function isOracleConnectionLost(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { errorNum?: number; code?: string; message?: string };
  const code = e.code ?? "";
  const msg = (e.message ?? "").toUpperCase();
  return (
    e.errorNum === 1012 ||
    e.errorNum === 3113 ||
    e.errorNum === 3114 ||
    e.errorNum === 3135 ||
    e.errorNum === 12170 ||
    e.errorNum === 12514 ||
    e.errorNum === 12541 ||
    e.errorNum === 12543 ||
    code === "DPI-1010" ||
    code === "DPI-1080" ||
    code === "DPI-1083" ||
    code === "NJS-003" ||
    code === "NJS-040" ||
    code === "NJS-500" ||
    code === "NJS-501" ||
    msg.includes("ORA-03113") ||
    msg.includes("ORA-03114") ||
    msg.includes("ORA-03135")
  );
}

/** 粗判是否为 Oracle DDL 语句(会触发隐式提交,无法回滚)。 */
function isOracleDDL(sql: string): boolean {
  return /^\s*(CREATE|ALTER|DROP|TRUNCATE|RENAME|GRANT|REVOKE|COMMENT|FLASHBACK|PURGE|ANALYZE|AUDIT)\b/i.test(sql);
}

/** 构造 Oracle Thin connect string。 */
function buildConnectString(config: OracleConfig): string {
  const database = config.database.trim();
  if (!database) {
    throw new Error("Oracle 需要提供 database 参数作为 service name 或 TNS connect string");
  }
  if (database.includes("/") || database.includes(":") || database.includes("(")) {
    return database;
  }
  return `${config.host}:${config.port}/${database}`;
}

/** Oracle owner 过滤条件,排除系统 schema 与 APEX 内部 schema。 */
function nonSystemOwnerCondition(ownerExpr: string): string {
  return `${ownerExpr} NOT IN (${ORACLE_SYSTEM_SCHEMA_LIST}) AND ${ownerExpr} NOT LIKE 'APEX!_%' ESCAPE '!'`;
}

/** Oracle 标识符 quote:双引号包裹,内部双引号双写。 */
function quoteOracleIdent(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"';
}

/** Oracle 二段式对象名 quote:schema 与 table 分别双引号包裹。 */
function quoteOracleQualifiedIdent(target: OracleTableTarget): string {
  return `${quoteOracleIdent(target.schema)}.${quoteOracleIdent(target.table)}`;
}

/** 归一化 Oracle schema/对象名称,空值表示不限定;保留原大小写以兼容带引号创建的小写/混合大小写对象。 */
function normalizeOracleName(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

/** Oracle 无注释时返回空串,统一归一化为 null。 */
function normalizeComment(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  return raw.length > 0 ? raw : null;
}

/** 将可空字符串归一化为 null。 */
function normalizeString(raw: unknown): string | null {
  if (typeof raw !== "string") return raw == null ? null : String(raw);
  return raw.length > 0 ? raw : null;
}

/** 格式化 Oracle 字段类型,补充常见长度、精度和 scale。 */
function formatOracleType(row: {
  dataType: string;
  dataLength: number | null;
  charLength: number | null;
  precision: number | null;
  scale: number | null;
}): string {
  const type = row.dataType;
  if (["CHAR", "NCHAR", "VARCHAR2", "NVARCHAR2"].includes(type)) {
    return `${type}(${row.charLength ?? row.dataLength ?? ""})`;
  }
  if (type === "NUMBER") {
    if (row.precision != null) {
      return row.scale != null && row.scale > 0 ? `${type}(${row.precision},${row.scale})` : `${type}(${row.precision})`;
    }
    // NUMBER(*,s):精度取最大值时 data_precision 为 null,但仍有 scale 需保留
    if (row.scale != null && row.scale > 0) {
      return `${type}(*,${row.scale})`;
    }
  }
  if (type.startsWith("TIMESTAMP") && !type.includes("(") && row.scale != null) {
    return `${type}(${row.scale})`;
  }
  return type;
}

/** 采样行数夹紧到 [0, 20]。 */
function clampLimit(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const i = Math.trunc(n);
  if (i < 0) return 0;
  if (i > 20) return 20;
  return i;
}

/** 创建短 statement id,用于隔离 Oracle EXPLAIN PLAN 输出。 */
function createStatementId(): string {
  return `ADM${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`.slice(0, 30);
}
