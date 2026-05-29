import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../dist/db.js";
import { registerExecuteTool } from "../dist/tools/execute.js";
import { registerTransactionTool } from "../dist/tools/transaction.js";

/** 解析 ToolResponse 第一段文本内容为 JSON 对象。 */
function parseToolJson(response) {
  assert.equal(response.content.length, 1);
  assert.equal(response.content[0].type, "text");
  return JSON.parse(response.content[0].text);
}

/** 创建可记录 execute / transaction 调用的内存适配器。 */
function createWriteAdapter() {
  const state = {
    executedSqls: [],
    transactionSqls: [],
  };

  const adapter = {
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
    async execute(sql) {
      state.executedSqls.push(sql);
      return { affectedRows: 2, insertId: 7 };
    },
    async transaction(sqls) {
      state.transactionSqls.push(...sqls);
      return {
        committed: true,
        steps: sqls.map((sql, index) => ({ index, sql, affectedRows: 1, insertId: 0 })),
        failedAt: null,
        error: null,
      };
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

  return { adapter, state };
}

/** 捕获指定工具注册出的 handler。 */
function captureToolHandler(register, config) {
  let handler;
  const server = {
    registerTool(_name, _definition, registeredHandler) {
      handler = registeredHandler;
    },
  };

  register(server, config);
  assert.equal(typeof handler, "function");
  return handler;
}

afterEach(async () => {
  await db.disconnect();
});

describe("execute tool", () => {
  test("readwrite 模式允许 DML 并返回执行结果", async () => {
    const { adapter, state } = createWriteAdapter();
    await db.connectWith(adapter);
    const handler = captureToolHandler(registerExecuteTool, { permissionMode: "readwrite" });

    const response = await handler({ sql: "UPDATE users SET name = 'a'" });
    const body = parseToolJson(response);

    assert.equal(body.success, true);
    assert.equal(body.mode, "readwrite");
    assert.equal(body.affectedRows, 2);
    assert.equal(body.insertId, 7);
    assert.deepEqual(state.executedSqls, ["UPDATE users SET name = 'a'"]);
  });

  test("readonly 模式拒绝写操作且不会调用适配器", async () => {
    const { adapter, state } = createWriteAdapter();
    await db.connectWith(adapter);
    const handler = captureToolHandler(registerExecuteTool, { permissionMode: "readonly" });

    const response = await handler({ sql: "UPDATE users SET name = 'a'" });
    const body = parseToolJson(response);

    assert.equal(response.isError, true);
    assert.equal(body.success, false);
    assert.match(body.error, /readonly/);
    assert.deepEqual(state.executedSqls, []);
  });

  test("readwrite 模式拒绝多语句和 DDL", async () => {
    const { adapter, state } = createWriteAdapter();
    await db.connectWith(adapter);
    const handler = captureToolHandler(registerExecuteTool, { permissionMode: "readwrite" });

    const multi = parseToolJson(await handler({ sql: "UPDATE users SET name = 'a'; DROP TABLE users" }));
    const ddl = parseToolJson(await handler({ sql: "DROP TABLE users" }));

    assert.equal(multi.success, false);
    assert.match(multi.error, /多条 SQL/);
    assert.equal(ddl.success, false);
    assert.match(ddl.error, /DDL/);
    assert.deepEqual(state.executedSqls, []);
  });
});

describe("transaction tool", () => {
  test("全部校验通过后才启动事务并返回步骤", async () => {
    const { adapter, state } = createWriteAdapter();
    await db.connectWith(adapter);
    const handler = captureToolHandler(registerTransactionTool, { permissionMode: "readwrite" });

    const response = await handler({
      sqls: ["INSERT INTO users (id) VALUES (1)", "UPDATE users SET name = 'a' WHERE id = 1"],
    });
    const body = parseToolJson(response);

    assert.equal(body.success, true);
    assert.equal(body.committed, true);
    assert.equal(body.stepCount, 2);
    assert.deepEqual(state.transactionSqls, [
      "INSERT INTO users (id) VALUES (1)",
      "UPDATE users SET name = 'a' WHERE id = 1",
    ]);
  });

  test("任一 SQL 被拒绝时不启动事务", async () => {
    const { adapter, state } = createWriteAdapter();
    await db.connectWith(adapter);
    const handler = captureToolHandler(registerTransactionTool, { permissionMode: "readwrite" });

    const response = await handler({
      sqls: ["INSERT INTO users (id) VALUES (1)", "DROP TABLE users"],
    });
    const body = parseToolJson(response);

    assert.equal(response.isError, true);
    assert.equal(body.success, false);
    assert.match(body.error, /第 2 条 SQL 被拒绝/);
    assert.deepEqual(state.transactionSqls, []);
  });
});
