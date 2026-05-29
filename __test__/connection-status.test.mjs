import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../dist/db.js";
import { registerConnectionStatusTool } from "../dist/tools/connection-status.js";

/** 解析 ToolResponse 第一段文本内容为 JSON 对象。 */
function parseToolJson(response) {
  assert.equal(response.content.length, 1);
  assert.equal(response.content[0].type, "text");
  return JSON.parse(response.content[0].text);
}

/** 创建只实现 connection_status 路径所需行为的内存数据库适配器。 */
function createStatusAdapter(overrides = {}) {
  return {
    type: "sqlite",
    async connect() {},
    async disconnect() {},
    async ping() {
      if (overrides.pingFails) {
        throw new Error("ping failed");
      }
    },
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
      if (overrides.listTablesFails) {
        throw new Error("list tables failed");
      }
      return [
        { schema: null, name: "users", comment: null },
        { schema: null, name: "orders", comment: null },
      ];
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

/** 捕获 connection_status 工具注册出的 handler。 */
function createRegisteredConnectionStatusHandler(config = { permissionMode: "readonly" }) {
  let handler;
  const server = {
    registerTool(name, _definition, registeredHandler) {
      if (name === "connection_status") handler = registeredHandler;
    },
  };

  registerConnectionStatusTool(server, config);
  assert.equal(typeof handler, "function");
  return handler;
}

afterEach(async () => {
  await db.disconnect();
});

describe("connection_status tool", () => {
  test("已连接时返回连接状态和表信息列表", async () => {
    await db.connectWith(createStatusAdapter());
    const handler = createRegisteredConnectionStatusHandler({ permissionMode: "readwrite" });

    const response = await handler();
    const body = parseToolJson(response);

    assert.equal(body.success, true);
    assert.equal(body.connected, true);
    assert.equal(body.type, "sqlite");
    assert.equal(body.healthy, true);
    assert.equal(body.pingError, null);
    assert.equal(body.permissionMode, "readwrite");
    assert.equal(body.tableCount, 2);
    assert.deepEqual(body.tables, [
      { schema: null, name: "users", comment: null },
      { schema: null, name: "orders", comment: null },
    ]);
  });

  test("表信息列表获取失败不影响连接状态返回", async () => {
    await db.connectWith(createStatusAdapter({ listTablesFails: true }));
    const handler = createRegisteredConnectionStatusHandler();

    const response = await handler();
    const body = parseToolJson(response);

    assert.equal(body.success, true);
    assert.equal(body.connected, true);
    assert.equal(body.healthy, true);
    assert.equal(body.tableCount, 0);
    assert.deepEqual(body.tables, []);
    assert.match(body.warning, /表信息列表获取失败/);
  });

  test("未连接时保持原有未连接响应", async () => {
    const handler = createRegisteredConnectionStatusHandler({ permissionMode: "full" });

    const response = await handler();
    const body = parseToolJson(response);

    assert.equal(body.success, true);
    assert.equal(body.connected, false);
    assert.equal(body.permissionMode, "full");
    assert.match(body.message, /未连接/);
    assert.equal(Object.hasOwn(body, "tables"), false);
  });
});
