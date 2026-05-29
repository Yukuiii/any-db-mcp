import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { PostgreSQLAdapter } from "../dist/adapters/postgresql.js";
import { MSSQLAdapter } from "../dist/adapters/mssql.js";

/** 创建带 fake pool 的 PostgreSQL adapter,用于捕获 SQL 和参数。 */
function createPostgresAdapter(schema = "tenant_app") {
  const calls = [];
  const adapter = new PostgreSQLAdapter({
    host: "localhost",
    port: 5432,
    user: "postgres",
    password: "",
    database: "app",
    schema,
  });
  adapter.pool = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      return { rows: [] };
    },
  };
  return { adapter, calls };
}

/** 创建带 fake request 链的 MSSQL adapter,用于捕获 SQL 和参数。 */
function createMssqlAdapter(schema = "sales") {
  const calls = [];
  const adapter = new MSSQLAdapter({
    host: "localhost",
    port: 1433,
    user: "sa",
    password: "",
    database: "app",
    schema,
    encrypt: true,
    trustServerCertificate: false,
  });
  adapter.pool = {
    connected: true,
    request() {
      const inputs = {};
      return {
        input(name, _type, value) {
          inputs[name] = value;
          return this;
        },
        async query(sqlText) {
          calls.push({ sql: sqlText, inputs: { ...inputs } });
          return { recordset: [] };
        },
      };
    },
  };
  return { adapter, calls };
}

describe("schema-qualified adapters", () => {
  test("PostgreSQLAdapter 在表清单、结构和采样中使用配置 schema", async () => {
    const { adapter, calls } = createPostgresAdapter("tenant-app");

    await adapter.listTables();
    assert.deepEqual(calls.at(-1).params, ["tenant-app"]);

    await adapter.describeTable("users");
    assert.deepEqual(calls.slice(1, 5).map((call) => call.params), [
      ["users", "tenant-app"],
      ["users", "tenant-app"],
      ["users", "tenant-app"],
      ["users", "tenant-app"],
    ]);

    await adapter.sampleData("users", 1);
    assert.match(calls.at(-1).sql, /"tenant-app"\."users"/);

    await adapter.estimateRowCount("users");
    assert.deepEqual(calls.at(-1).params, ["users", "tenant-app"]);
  });

  test("MSSQLAdapter 在表清单、结构和采样中使用配置 schema", async () => {
    const { adapter, calls } = createMssqlAdapter("sales");

    await adapter.listTables();
    assert.equal(calls.at(-1).inputs.schema, "sales");

    await adapter.describeTable("orders");
    assert.deepEqual(calls.slice(1, 4).map((call) => call.inputs.objectName), [
      "[sales].[orders]",
      "[sales].[orders]",
      "[sales].[orders]",
    ]);

    await adapter.sampleData("orders", 1);
    assert.match(calls.at(-1).sql, /SELECT TOP 1 \* FROM \[sales\]\.\[orders\]/);

    await adapter.estimateRowCount("orders");
    assert.equal(calls.at(-1).inputs.objectName, "[sales].[orders]");
  });
});
