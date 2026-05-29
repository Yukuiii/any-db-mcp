import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../dist/db.js";
import { registerDescribeTableTool } from "../dist/tools/describe-table.js";
import { registerSearchSchemaTool } from "../dist/tools/search-schema.js";

/** 解析 ToolResponse 第一段文本内容为 JSON 对象。 */
function parseToolJson(response) {
  assert.equal(response.content.length, 1);
  assert.equal(response.content[0].type, "text");
  return JSON.parse(response.content[0].text);
}

/** 创建包含用户、订单和审计表的 schema 测试适配器。 */
function createSchemaAdapter(overrides = {}) {
  const descriptions = {
    users: {
      schema: null,
      table: "users",
      columns: [
        { name: "id", type: "integer", nullable: false, defaultValue: null, key: "PRI", extra: "", comment: null },
        { name: "email", type: "varchar(255)", nullable: false, defaultValue: null, key: "UNI", extra: "", comment: null },
      ],
      indexes: [{ name: "users_email_key", columns: ["email"], unique: true }],
      foreignKeys: [],
    },
    orders: {
      schema: null,
      table: "orders",
      columns: [
        { name: "id", type: "integer", nullable: false, defaultValue: null, key: "PRI", extra: "", comment: null },
        { name: "user_id", type: "integer", nullable: false, defaultValue: null, key: "MUL", extra: "", comment: null },
      ],
      indexes: [],
      foreignKeys: [
        {
          column: "user_id",
          referencedTable: "users",
          referencedColumn: "id",
          constraintName: "orders_user_id_fkey",
        },
      ],
    },
    audit_log: {
      schema: null,
      table: "audit_log",
      columns: [
        { name: "id", type: "integer", nullable: false, defaultValue: null, key: "PRI", extra: "", comment: null },
        { name: "payload", type: "json", nullable: true, defaultValue: null, key: "", extra: "", comment: null },
      ],
      indexes: [],
      foreignKeys: [],
    },
  };

  return {
    type: "sqlite",
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
      return [
        { schema: null, name: "users", comment: null },
        { schema: null, name: "orders", comment: null },
        { schema: null, name: "audit_log", comment: null },
      ];
    },
    async describeTable(table) {
      if (overrides.failTable === table) {
        throw new Error(`describe failed: ${table}`);
      }
      return descriptions[table] ?? { schema: null, table, columns: [], indexes: [], foreignKeys: [] };
    },
    async sampleData(table, limit) {
      if (overrides.sampleFails) {
        throw new Error("sample failed");
      }
      if (limit === 0) return [];
      return table === "users" ? [{ id: 1, email: "a@example.com" }] : [];
    },
    async estimateRowCount() {
      if (overrides.rowCountFails) {
        throw new Error("row count failed");
      }
      return { value: 3, isEstimate: true };
    },
  };
}

/** 捕获指定工具注册出的 handler。 */
function captureToolHandler(register) {
  let handler;
  const server = {
    registerTool(_name, _definition, registeredHandler) {
      handler = registeredHandler;
    },
  };

  register(server);
  assert.equal(typeof handler, "function");
  return handler;
}

afterEach(async () => {
  await db.disconnect();
});

describe("describe_table tool", () => {
  test("返回结构、行数和采样数据", async () => {
    await db.connectWith(createSchemaAdapter());
    const handler = captureToolHandler(registerDescribeTableTool);

    const response = await handler({ table: "users", sampleLimit: 1 });
    const body = parseToolJson(response);

    assert.equal(body.success, true);
    assert.equal(body.table, "users");
    assert.equal(body.rowCount, 3);
    assert.equal(body.rowCountIsEstimate, true);
    assert.equal(body.sampleCount, 1);
    assert.equal(body.columns.length, 2);
    assert.deepEqual(body.sample, [{ id: 1, email: "a@example.com" }]);
  });

  test("行数和采样失败不影响表结构返回", async () => {
    await db.connectWith(createSchemaAdapter({ rowCountFails: true, sampleFails: true }));
    const handler = captureToolHandler(registerDescribeTableTool);

    const response = await handler({ table: "users" });
    const body = parseToolJson(response);

    assert.equal(body.success, true);
    assert.equal(body.rowCount, null);
    assert.equal(body.rowCountIsEstimate, true);
    assert.equal(body.sampleCount, 0);
    assert.deepEqual(body.sample, []);
  });
});

describe("search_schema tool", () => {
  test("按表名、列名和字段类型搜索 schema", async () => {
    await db.connectWith(createSchemaAdapter());
    const handler = captureToolHandler(registerSearchSchemaTool);

    const byColumn = parseToolJson(await handler({ keyword: "email" }));
    const byType = parseToolJson(await handler({ keyword: "json" }));
    const byTable = parseToolJson(await handler({ keyword: "order" }));

    assert.equal(byColumn.success, true);
    assert.equal(byColumn.scannedTableCount, 3);
    assert.deepEqual(byColumn.matches.map((match) => match.column), ["email"]);
    assert.deepEqual(byType.matches.map((match) => match.type), ["json"]);
    assert.deepEqual(byTable.matches[0], { kind: "table", matchedBy: "table", schema: null, table: "orders" });
  });

  test("单表 describe 失败时返回 failedTables 并继续搜索其它表", async () => {
    await db.connectWith(createSchemaAdapter({ failTable: "orders" }));
    const handler = captureToolHandler(registerSearchSchemaTool);

    const response = await handler({ keyword: "email" });
    const body = parseToolJson(response);

    assert.equal(body.success, true);
    assert.equal(body.failedTableCount, 1);
    assert.equal(body.failedTables[0].table, "orders");
    assert.deepEqual(body.matches.map((match) => match.column), ["email"]);
  });

  test("空关键词返回失败响应", async () => {
    await db.connectWith(createSchemaAdapter());
    const handler = captureToolHandler(registerSearchSchemaTool);

    const response = await handler({ keyword: "   " });
    const body = parseToolJson(response);

    assert.equal(response.isError, true);
    assert.equal(body.success, false);
    assert.match(body.error, /不能为空/);
  });
});
