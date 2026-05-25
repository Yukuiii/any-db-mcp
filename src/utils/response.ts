/**
 * Tool 响应统一构造器
 * 所有 MCP Tool 返回给 LLM 的内容必须是合法 JSON 字符串。
 */

type ToolResponse = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

/** 成功响应：业务数据序列化为 JSON，自动追加 success: true */
export function ok(data: Record<string, unknown>): ToolResponse {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ success: true, ...data }, null, 2),
      },
    ],
  };
}

/** 失败响应：返回 { success: false, error } 并标记 isError */
export function fail(message: string): ToolResponse {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ success: false, error: message }, null, 2),
      },
    ],
    isError: true,
  };
}

/** 提取异常的可读消息 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
