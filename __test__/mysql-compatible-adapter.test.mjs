import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { MySQLAdapter } from "../dist/adapters/mysql.js";

/** 创建 MySQL 协议兼容 adapter 的最小配置。 */
function createAdapter(type) {
  return new MySQLAdapter({
    type,
    host: "localhost",
    port: 3306,
    user: "root",
    password: "",
    database: "app",
  });
}

describe("MySQL compatible adapters", () => {
  test("默认类型保持 mysql", () => {
    assert.equal(createAdapter(undefined).type, "mysql");
  });

  test("MariaDB alias 在 MCP 层保留 mariadb 类型", () => {
    assert.equal(createAdapter("mariadb").type, "mariadb");
  });
});
