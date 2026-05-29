import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../dist/db.js";
import { registerResources } from "../dist/resources.js";

/** 解析 ResourceResponse 第一段 JSON 内容。 */
function parseResourceJson(response) {
  assert.equal(response.contents.length, 1);
  assert.equal(response.contents[0].mimeType, "application/json");
  return JSON.parse(response.contents[0].text);
}

/** 创建只实现 resource 路径所需行为的内存数据库适配器。 */
function createResourceAdapter() {
  const calls = {
    descriptions: [],
    rowCounts: [],
  };
  const tables = [
    { schema: "billing", name: "orders", comment: "订单" },
    { schema: "public", name: "users", comment: null },
  ];

  return {
    calls,
    adapter: {
      type: "postgresql",
      async connect() {},
      async disconnect() {},
      async ping() {},
      async query() {
        return [];
      },
      async explain() {
        return [];
      },
      async execute() {
        return { affectedRows: 0, insertId: 0 };
      },
      async transaction() {
        return { committed: true, steps: [], failedAt: null, error: null };
      },
      async listTables() {
        return tables;
      },
      async describeTable(table, schema) {
        calls.descriptions.push({ table, schema });
        return {
          schema: schema ?? null,
          table,
          columns: [
            { name: "id", type: "integer", nullable: false, defaultValue: null, key: "PRI", extra: "", comment: null },
          ],
          indexes: [{ name: `${table}_pkey`, columns: ["id"], unique: true }],
          foreignKeys: [],
        };
      },
      async sampleData() {
        return [];
      },
      async estimateRowCount(table, schema) {
        calls.rowCounts.push({ table, schema });
        return { value: table === "orders" ? 10 : 5, isEstimate: true };
      },
    },
  };
}

/** 捕获 registerResources 注册出的 resource 定义。 */
function captureResources() {
  const resources = new Map();
  const server = {
    registerResource(name, template, metadata, handler) {
      resources.set(name, { template, metadata, handler });
    },
  };

  registerResources(server);
  return resources;
}

afterEach(async () => {
  await db.disconnect();
});

describe("MCP resources", () => {
  test("db://tables 返回 schema 并按 schema 估算行数", async () => {
    const { adapter, calls } = createResourceAdapter();
    await db.connectWith(adapter);
    const resources = captureResources();

    const response = await resources.get("tables").handler(new URL("db://tables"));
    const body = parseResourceJson(response);

    assert.equal(body.connected, true);
    assert.equal(body.databaseType, "postgresql");
    assert.deepEqual(body.tables.map((table) => [table.schema, table.table, table.rowCount]), [
      ["billing", "orders", 10],
      ["public", "users", 5],
    ]);
    assert.deepEqual(calls.rowCounts, [
      { table: "orders", schema: "billing" },
      { table: "users", schema: "public" },
    ]);
  });

  test("db://table/{schema}/{name} 列表和读取都携带 schema", async () => {
    const { adapter, calls } = createResourceAdapter();
    await db.connectWith(adapter);
    const resources = captureResources();

    const listed = await resources.get("table-with-schema").template._callbacks.list();
    assert.deepEqual(
      listed.resources.map((resource) => resource.uri),
      ["db://table/billing/orders", "db://table/public/users"]
    );

    const response = await resources
      .get("table-with-schema")
      .handler(new URL("db://table/billing/orders"), { schema: "billing", name: "orders" });
    const body = parseResourceJson(response);

    assert.equal(body.schema, "billing");
    assert.equal(body.table, "orders");
    assert.deepEqual(calls.descriptions, [{ table: "orders", schema: "billing" }]);
  });
});
