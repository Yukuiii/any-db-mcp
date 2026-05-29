import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SQLiteAdapter } from "../dist/adapters/sqlite.js";

let tempDir;
let adapter;

/** 创建一个连接到临时 SQLite 文件的适配器实例。 */
async function createAdapter() {
  tempDir = await mkdtemp(path.join(tmpdir(), "any-db-mcp-test-"));
  adapter = new SQLiteAdapter({ filepath: path.join(tempDir, "db.sqlite") });
  await adapter.connect();
  return adapter;
}

/** 创建测试表结构并写入最小样本数据。 */
async function seedSchema(db) {
  await db.execute("CREATE TABLE groups (id INTEGER PRIMARY KEY, name TEXT NOT NULL)");
  await db.execute(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      group_id INTEGER,
      FOREIGN KEY(group_id) REFERENCES groups(id)
    )
  `);
  await db.execute("INSERT INTO groups (id, name) VALUES (1, 'admin')");
  await db.execute("INSERT INTO users (email, group_id) VALUES ('a@example.com', 1)");
  await db.execute("INSERT INTO users (email, group_id) VALUES ('b@example.com', 1)");
}

beforeEach(async () => {
  await createAdapter();
});

afterEach(async () => {
  if (adapter) {
    await adapter.disconnect();
    adapter = undefined;
  }
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("SQLiteAdapter", () => {
  test("支持连接、建表、写入、查询和列出表", async () => {
    await seedSchema(adapter);

    const tables = await adapter.listTables();
    const rows = await adapter.query("SELECT email FROM users ORDER BY email");

    assert.deepEqual(tables, [
      { name: "groups", comment: null },
      { name: "users", comment: null },
    ]);
    assert.deepEqual(rows, [{ email: "a@example.com" }, { email: "b@example.com" }]);
  });

  test("describeTable 返回列、索引和外键信息", async () => {
    await seedSchema(adapter);

    const description = await adapter.describeTable("users");
    const idColumn = description.columns.find((column) => column.name === "id");
    const emailColumn = description.columns.find((column) => column.name === "email");
    const uniqueEmailIndex = description.indexes.find(
      (index) => index.unique && index.columns.includes("email")
    );

    assert.equal(description.table, "users");
    assert.equal(idColumn?.key, "PRI");
    assert.equal(emailColumn?.nullable, false);
    assert.ok(uniqueEmailIndex);
    assert.deepEqual(description.foreignKeys, [
      {
        column: "group_id",
        referencedTable: "groups",
        referencedColumn: "id",
        constraintName: "fk_users_group_id",
      },
    ]);
  });

  test("采样和行数统计返回受控结果", async () => {
    await seedSchema(adapter);

    const sample = await adapter.sampleData("users", 1);
    const rowCount = await adapter.estimateRowCount("users");

    assert.equal(sample.length, 1);
    assert.deepEqual(rowCount, { value: 2, isEstimate: false });
  });

  test("事务成功提交，失败时回滚已执行步骤", async () => {
    await adapter.execute("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT UNIQUE)");

    const committed = await adapter.transaction([
      "INSERT INTO items (name) VALUES ('a')",
      "INSERT INTO items (name) VALUES ('b')",
    ]);
    const failed = await adapter.transaction([
      "INSERT INTO items (name) VALUES ('c')",
      "INSERT INTO items (name) VALUES ('a')",
    ]);
    const rows = await adapter.query("SELECT name FROM items ORDER BY name");

    assert.equal(committed.committed, true);
    assert.equal(committed.steps.length, 2);
    assert.equal(failed.committed, false);
    assert.equal(failed.failedAt, 1);
    assert.deepEqual(rows, [{ name: "a" }, { name: "b" }]);
  });

  test("拒绝非法 PRAGMA 表名并在断开后报错", async () => {
    await seedSchema(adapter);

    await assert.rejects(
      () => adapter.describeTable("users; DROP TABLE users"),
      /非法的 SQLite 标识符/
    );

    await adapter.disconnect();
    await assert.rejects(() => adapter.query("SELECT 1"), /SQLite 未连接/);
  });
});
