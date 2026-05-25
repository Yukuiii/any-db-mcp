import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  DANGEROUS_SQL_PATTERN,
  READONLY_SQL_PATTERN,
  WRITE_SQL_PATTERN,
  checkSingleStatement,
} from "../dist/utils/sql-patterns.js";

describe("checkSingleStatement", () => {
  test("允许无分号或尾部分号的单条 SQL", () => {
    assert.deepEqual(checkSingleStatement("SELECT 1"), { ok: true });
    assert.deepEqual(checkSingleStatement("SELECT 1;"), { ok: true });
    assert.deepEqual(checkSingleStatement("  UPDATE users SET name = 'a';  "), { ok: true });
  });

  test("拒绝分号后仍有有效 SQL 的多语句输入", () => {
    const result = checkSingleStatement("SELECT 1; DELETE FROM users");

    assert.equal(result.ok, false);
    assert.match(result.reason ?? "", /多条 SQL/);
  });

  test("忽略字符串、标识符和注释中的分号", () => {
    assert.equal(checkSingleStatement("SELECT ';' AS semi;").ok, true);
    assert.equal(checkSingleStatement('SELECT ";" AS semi;').ok, true);
    assert.equal(checkSingleStatement("SELECT `semi;colon` FROM users;").ok, true);
    assert.equal(checkSingleStatement("SELECT 1 -- ; in comment\n;").ok, true);
    assert.equal(checkSingleStatement("SELECT 1 /* ; in comment */;").ok, true);
  });

  test("注释不能隐藏分号后的第二条语句", () => {
    const result = checkSingleStatement("SELECT 1; -- comment\nDROP TABLE users");

    assert.equal(result.ok, false);
    assert.match(result.reason ?? "", /多条 SQL/);
  });
});

describe("SQL keyword patterns", () => {
  test("识别只读语句", () => {
    assert.equal(READONLY_SQL_PATTERN.test("SELECT * FROM users"), true);
    assert.equal(READONLY_SQL_PATTERN.test(" show tables"), true);
    assert.equal(READONLY_SQL_PATTERN.test("DESCRIBE users"), true);
    assert.equal(READONLY_SQL_PATTERN.test("EXPLAIN SELECT 1"), true);
    assert.equal(READONLY_SQL_PATTERN.test("INSERT INTO users VALUES (1)"), false);
  });

  test("识别 DML 写语句", () => {
    assert.equal(WRITE_SQL_PATTERN.test("INSERT INTO users VALUES (1)"), true);
    assert.equal(WRITE_SQL_PATTERN.test(" update users set name = 'a'"), true);
    assert.equal(WRITE_SQL_PATTERN.test("DELETE FROM users"), true);
    assert.equal(WRITE_SQL_PATTERN.test("CREATE TABLE users(id int)"), false);
  });

  test("识别 DDL 和权限类危险语句", () => {
    assert.equal(DANGEROUS_SQL_PATTERN.test("DROP TABLE users"), true);
    assert.equal(DANGEROUS_SQL_PATTERN.test(" truncate table users"), true);
    assert.equal(DANGEROUS_SQL_PATTERN.test("ALTER TABLE users ADD COLUMN age int"), true);
    assert.equal(DANGEROUS_SQL_PATTERN.test("GRANT SELECT ON users TO app"), true);
    assert.equal(DANGEROUS_SQL_PATTERN.test("SELECT * FROM users"), false);
  });
});
