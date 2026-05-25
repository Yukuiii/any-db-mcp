import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { errorMessage, fail, ok } from "../dist/utils/response.js";

/** 解析 ToolResponse 第一段文本内容为 JSON 对象。 */
function parseToolJson(response) {
  assert.equal(response.content.length, 1);
  assert.equal(response.content[0].type, "text");
  return JSON.parse(response.content[0].text);
}

describe("response helpers", () => {
  test("ok 返回统一成功 JSON 响应", () => {
    const response = ok({ rowCount: 2, rows: [{ id: 1 }, { id: 2 }] });
    const body = parseToolJson(response);

    assert.equal(response.isError, undefined);
    assert.deepEqual(body, {
      success: true,
      rowCount: 2,
      rows: [{ id: 1 }, { id: 2 }],
    });
  });

  test("fail 返回统一失败 JSON 响应并标记 isError", () => {
    const response = fail("查询失败");
    const body = parseToolJson(response);

    assert.equal(response.isError, true);
    assert.deepEqual(body, { success: false, error: "查询失败" });
  });

  test("errorMessage 提取 Error 和非 Error 的可读消息", () => {
    assert.equal(errorMessage(new Error("boom")), "boom");
    assert.equal(errorMessage("plain"), "plain");
    assert.equal(errorMessage(404), "404");
  });
});
