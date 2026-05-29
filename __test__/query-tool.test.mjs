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
  const state = { queryCount: 0 };
  return {
    type: "sqlite",
    state,
    async connect() {},
    async disconnect() {},
    async ping() {},
    async query() {
      state.queryCount += 1;
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
      return { schema: null, table: "", columns: [], indexes: [], foreignKeys: [] };
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
function createRegisteredQueryHandler(config = { queryTimeoutMs: 1000 }) {
  let handler;
  const server = {
    registerTool(name, _definition, registeredHandler) {
      if (name === "query") handler = registeredHandler;
    },
  };

  registerQueryTool(server, config);
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
    assert.equal(body.timeoutMs, 1000);
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

  test("超过 queryTimeoutMs 时返回超时错误", async () => {
    const pendingRows = new Promise((resolve) => {
      setTimeout(() => resolve([{ id: 1 }]), 50);
    });
    await db.connectWith(createQueryOnlyAdapter(pendingRows));
    const handler = createRegisteredQueryHandler({ queryTimeoutMs: 5 });

    const response = await handler({ sql: "SELECT * FROM slow_table" });
    const body = parseToolJson(response);

    assert.equal(response.isError, true);
    assert.equal(body.success, false);
    assert.match(body.error, /超时/);
  });

  test("拒绝 EXPLAIN 并引导使用 explain 工具", async () => {
    const adapter = createQueryOnlyAdapter([]);
    await db.connectWith(adapter);
    const handler = createRegisteredQueryHandler();

    const response = await handler({ sql: "EXPLAIN SELECT * FROM users" });
    const body = parseToolJson(response);

    assert.equal(response.isError, true);
    assert.equal(body.success, false);
    assert.match(body.error, /explain 工具/);
    assert.equal(adapter.state.queryCount, 0);
  });
});
