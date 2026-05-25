import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { checkWritePermission } from "../dist/utils/permission.js";

describe("checkWritePermission", () => {
  test("readonly 模式拒绝任何写操作", () => {
    for (const sql of [
      "INSERT INTO users VALUES (1)",
      "UPDATE users SET name = 'a'",
      "DELETE FROM users",
      "CREATE TABLE users(id int)",
    ]) {
      const result = checkWritePermission(sql, "readonly");

      assert.equal(result.allowed, false);
      assert.match(result.reason ?? "", /readonly/);
    }
  });

  test("readwrite 模式允许 DML 并拒绝 DDL 或查询", () => {
    assert.equal(checkWritePermission("INSERT INTO users VALUES (1)", "readwrite").allowed, true);
    assert.equal(checkWritePermission(" update users set name = 'a'", "readwrite").allowed, true);
    assert.equal(checkWritePermission("DELETE FROM users", "readwrite").allowed, true);

    const ddl = checkWritePermission("DROP TABLE users", "readwrite");
    const select = checkWritePermission("SELECT * FROM users", "readwrite");

    assert.equal(ddl.allowed, false);
    assert.match(ddl.reason ?? "", /DDL/);
    assert.equal(select.allowed, false);
    assert.match(select.reason ?? "", /不是合法的写操作/);
  });

  test("full 模式允许 DML 与 DDL 但拒绝查询", () => {
    assert.equal(checkWritePermission("INSERT INTO users VALUES (1)", "full").allowed, true);
    assert.equal(checkWritePermission("CREATE TABLE users(id int)", "full").allowed, true);
    assert.equal(checkWritePermission("ALTER TABLE users ADD COLUMN age int", "full").allowed, true);

    const result = checkWritePermission("SELECT * FROM users", "full");

    assert.equal(result.allowed, false);
    assert.match(result.reason ?? "", /既不是 DML 也不是 DDL/);
  });
});
