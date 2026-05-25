import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../dist/db.js";
import { registerQueryTool } from "../dist/tools/query.js";

/** 解析 ToolResponse 第一段文本内容为 JSON 对象。 */
function parseToolJson(response) {
  assert.equal(response.content.length, 1);
  assert.equal(response.content[0].type, "text");
  return JSON.parse(response.content[0].text);
}

/** 创建只实现 query 路径所需行为的内存数据库适配器。 */
function createQueryOnlyAdapter(rows) {
  return {
    type: "sqlite",
    async connect() {},
    async disconnect() {},
    async ping() {},
    async query() {
      return rows;
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
      return [];
    },
    async describeTable() {
      return { table: "", columns: [], indexes: [], foreignKeys: [] };
    },
    async sampleData() {
      return [];
    },
    async estimateRowCount() {
      return { value: null, isEstimate: true };
    },
  };
}

/** 捕获 registerTool 注册出的 query handler。 */
function createRegisteredQueryHandler() {
  let handler;
  const server = {
    registerTool(name, _definition, registeredHandler) {
      if (name === "query") handler = registeredHandler;
    },
  };

  registerQueryTool(server);
  assert.equal(typeof handler, "function");
  return handler;
}

afterEach(async () => {
  await db.disconnect();
});

describe("query tool", () => {
  test("响应最多返回 1000 行并显式暴露 limit", async () => {
    const rows = Array.from({ length: 1001 }, (_, id) => ({ id }));
    await db.connectWith(createQueryOnlyAdapter(rows));
    const handler = createRegisteredQueryHandler();

    const response = await handler({ sql: "SELECT * FROM users" });
    const body = parseToolJson(response);

    assert.equal(body.success, true);
    assert.equal(body.rowCount, 1000);
    assert.equal(body.limit, 1000);
    assert.equal(body.truncated, true);
    assert.equal(body.rows.length, 1000);
    assert.deepEqual(body.rows[0], { id: 0 });
    assert.deepEqual(body.rows.at(-1), { id: 999 });
  });

  test("未超过上限时不标记截断", async () => {
    await db.connectWith(createQueryOnlyAdapter([{ id: 1 }, { id: 2 }]));
    const handler = createRegisteredQueryHandler();

    const response = await handler({ sql: "SELECT * FROM users LIMIT 2" });
    const body = parseToolJson(response);

    assert.equal(body.rowCount, 2);
    assert.equal(body.limit, 1000);
    assert.equal(body.truncated, false);
    assert.deepEqual(body.rows, [{ id: 1 }, { id: 2 }]);
  });
});
