import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { OracleAdapter } from "../dist/adapters/oracle.js";

/** 创建带 fake pool 的 Oracle adapter,用于捕获 SQL 和 bind 参数。 */
function createOracleAdapter(schema = "") {
  const calls = [];
  const adapter = new OracleAdapter({
    host: "localhost",
    port: 1521,
    user: "app",
    password: "",
    database: "FREEPDB1",
    schema,
  });
  adapter.pool = {
    async getConnection() {
      return {
        async execute(sql, binds = {}, options = {}) {
          calls.push({ sql, binds, options });
          return { rows: [] };
        },
        async close() {},
        async ping() {},
        async commit() {},
        async rollback() {},
      };
    },
    async close() {},
  };
  return { adapter, calls };
}

describe("OracleAdapter", () => {
  test("未配置 schema 时列出所有非系统 schema", async () => {
    const { adapter, calls } = createOracleAdapter("");

    await adapter.listTables();

    assert.equal(calls.at(-1).binds.schema, null);
    assert.match(calls.at(-1).sql, /owner NOT IN \('SYS', 'SYSTEM'/);
    assert.match(calls.at(-1).sql, /owner NOT LIKE 'APEX!_%' ESCAPE '!'/);
  });

  test("配置 schema 时保留原值并大小写兼容地限定表清单", async () => {
    const { adapter, calls } = createOracleAdapter("billing");

    await adapter.listTables();

    assert.equal(calls.at(-1).binds.schema, "billing");
    assert.match(calls.at(-1).sql, /t\.owner = UPPER\(:schema\)/);
  });

  test("未配置 schema 时唯一匹配表会自动解析 schema 并读取结构", async () => {
    const { adapter, calls } = createOracleAdapter("");
    adapter.pool = {
      async getConnection() {
        return {
          async execute(sql, binds = {}, options = {}) {
            calls.push({ sql, binds, options });
            if (sql.includes("FROM all_tables") && sql.includes('owner AS "schema"')) {
              return { rows: [{ schema: "BILLING", table: "ORDERS" }] };
            }
            if (sql.includes("FROM all_tab_columns")) {
              return {
                rows: [
                  {
                    name: "ID",
                    dataType: "NUMBER",
                    nullable: "N",
                    defaultValue: null,
                    dataLength: 22,
                    charLength: null,
                    precision: 10,
                    scale: 0,
                    comment: "主键",
                  },
                  {
                    name: "EMAIL",
                    dataType: "VARCHAR2",
                    nullable: "Y",
                    defaultValue: null,
                    dataLength: 120,
                    charLength: 120,
                    precision: null,
                    scale: null,
                    comment: null,
                  },
                ],
              };
            }
            if (sql.includes("FROM all_indexes")) {
              return { rows: [{ name: "ORDERS_PK", column: "ID", uniqueness: "UNIQUE" }] };
            }
            if (sql.includes("constraint_type = 'P'")) {
              return { rows: [{ column: "ID" }] };
            }
            return { rows: [] };
          },
          async close() {},
          async ping() {},
          async commit() {},
          async rollback() {},
        };
      },
      async close() {},
    };

    const description = await adapter.describeTable("orders");

    assert.equal(description.schema, "BILLING");
    assert.equal(description.table, "ORDERS");
    assert.equal(description.columns[0].key, "PRI");
    assert.equal(description.columns[0].type, "NUMBER(10)");
    assert.equal(description.columns[1].type, "VARCHAR2(120)");
    assert.deepEqual(calls[0].binds, { table: "orders", schema: null });
    assert.deepEqual(calls[1].binds, { schema: "BILLING", table: "ORDERS" });
  });

  test("未配置 schema 且表名歧义时要求显式 schema", async () => {
    const { adapter } = createOracleAdapter("");
    adapter.pool = {
      async getConnection() {
        return {
          async execute() {
            return {
              rows: [
                { schema: "BILLING", table: "ORDERS" },
                { schema: "SALES", table: "ORDERS" },
              ],
            };
          },
          async close() {},
          async ping() {},
          async commit() {},
          async rollback() {},
        };
      },
      async close() {},
    };

    await assert.rejects(() => adapter.describeTable("orders"), /候选:BILLING\.ORDERS, SALES\.ORDERS/);
  });

  test("采样使用解析出的 schema-qualified 表名", async () => {
    const { adapter, calls } = createOracleAdapter("");
    adapter.pool = {
      async getConnection() {
        return {
          async execute(sql, binds = {}, options = {}) {
            calls.push({ sql, binds, options });
            if (sql.includes("FROM all_tables")) {
              return { rows: [{ schema: "BILLING", table: "ORDERS" }] };
            }
            return { rows: [{ ID: 1 }] };
          },
          async close() {},
          async ping() {},
          async commit() {},
          async rollback() {},
        };
      },
      async close() {},
    };

    const rows = await adapter.sampleData("orders", 1);

    assert.deepEqual(rows, [{ ID: 1 }]);
    assert.match(calls.at(-1).sql, /SELECT \* FROM "BILLING"\."ORDERS" WHERE ROWNUM <= 1/);
  });
});
