import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { AppConfig } from "./config.js";
import { registerTools } from "./tools/index.js";

/** Server 工厂:每次调用产出一个全新 server 实例并完成 tools/resources 注册 */
function createServer(config: AppConfig): McpServer {
  const server = new McpServer({ name: "any-db-mcp", version: "1.0.0" });
  registerTools(server, config);
  return server;
}

/** stdio:单进程子进程模式,一个 server 一个 transport */
export async function startStdio(config: AppConfig): Promise<void> {
  const server = createServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[any-db-mcp] MCP Server 已启动 (stdio)");
}

/**
 * HTTP:Streamable HTTP transport(spec 2025-03-26)。
 *
 * 设计要点:
 *  - 每个 MCP session 对应独立的 transport + server 实例(数据库连接经 db 单例共享)
 *  - sessionId 由服务端生成,通过 Mcp-Session-Id 头返回客户端
 *  - 非初始化请求若无有效 sessionId 直接 400
 *  - 可选 Bearer Token 鉴权:设置 MCP_AUTH_TOKEN 后所有请求需带 Authorization
 *  - 默认绑 127.0.0.1,设为 0.0.0.0 需自行确保鉴权 + 网络隔离
 */
export async function startHttp(config: AppConfig): Promise<void> {
  const { host, port, path, authToken } = config.http;
  const transports = new Map<string, StreamableHTTPServerTransport>();

  const httpServer = http.createServer(async (req, res) => {
    try {
      // 鉴权(可选)
      if (authToken && !checkBearer(req, authToken)) {
        return sendJson(res, 401, { jsonrpc: "2.0", error: { code: -32000, message: "Unauthorized" } }, {
          "WWW-Authenticate": 'Bearer realm="any-db-mcp"',
        });
      }

      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      // 健康检查端点(无鉴权可选用,这里要求鉴权后才到达)
      if (url.pathname === "/healthz" && req.method === "GET") {
        return sendJson(res, 200, { ok: true });
      }
      // 仅路由配置的 MCP path
      if (url.pathname !== path) {
        return sendJson(res, 404, {
          jsonrpc: "2.0",
          error: { code: -32601, message: `Not Found: ${url.pathname}` },
        });
      }

      const sessionIdHeader = req.headers["mcp-session-id"];
      const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;

      if (req.method === "POST") {
        const body = await readJsonBody(req);
        let transport = sessionId ? transports.get(sessionId) : undefined;

        if (!transport) {
          // 没有 sessionId 时必须是 initialize 请求,其它直接拒
          if (!isInitializeRequest(body)) {
            return sendJson(res, 400, {
              jsonrpc: "2.0",
              error: {
                code: -32600,
                message: "Bad Request: missing or invalid Mcp-Session-Id header",
              },
            });
          }
          // 新建 session
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (id) => {
              transports.set(id, transport!);
              console.error(`[any-db-mcp] HTTP session 建立: ${id}`);
            },
            onsessionclosed: (id) => {
              transports.delete(id);
              console.error(`[any-db-mcp] HTTP session 关闭: ${id}`);
            },
          });
          const server = createServer(config);
          await server.connect(transport);
        }
        await transport.handleRequest(req, res, body);
        return;
      }

      if (req.method === "GET" || req.method === "DELETE") {
        // 这两个方法必须带 sessionId
        const transport = sessionId ? transports.get(sessionId) : undefined;
        if (!transport) {
          return sendJson(res, 404, {
            jsonrpc: "2.0",
            error: { code: -32001, message: "Session not found" },
          });
        }
        await transport.handleRequest(req, res);
        return;
      }

      return sendJson(res, 405, {
        jsonrpc: "2.0",
        error: { code: -32601, message: `Method Not Allowed: ${req.method}` },
      });
    } catch (err) {
      console.error(
        `[any-db-mcp] HTTP 请求处理失败: ${err instanceof Error ? err.message : String(err)}`
      );
      if (!res.headersSent) {
        sendJson(res, 500, {
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal Server Error" },
        });
      } else {
        res.end();
      }
    }
  });

  await new Promise<void>((resolve) => httpServer.listen(port, host, resolve));
  console.error(`[any-db-mcp] MCP Server 已启动 (http://${host}:${port}${path})`);
  if (authToken) {
    console.error("[any-db-mcp] Bearer Token 鉴权已启用");
  } else if (host !== "127.0.0.1" && host !== "localhost") {
    console.error(
      `[any-db-mcp] 警告:绑定 ${host} 且未设置 MCP_AUTH_TOKEN,任何能访问此地址的人均可操作数据库`
    );
  }

  // 优雅退出:关掉所有 transport
  const shutdown = async () => {
    for (const t of transports.values()) {
      try {
        await t.close();
      } catch {
        // 忽略单个关闭失败
      }
    }
    httpServer.close();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// ────────── helpers ──────────

/** 校验 Authorization: Bearer <token> 头 */
function checkBearer(req: IncomingMessage, expected: string): boolean {
  const header = req.headers["authorization"];
  if (typeof header !== "string") return false;
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  // 常数时间比较避免计时攻击
  return timingSafeEqual(m[1], expected);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

/** 读取 JSON body,上限 1MB 防 DoS */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const MAX_BYTES = 1024 * 1024;
  return new Promise<unknown>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BYTES) {
        reject(new Error(`Request body exceeds ${MAX_BYTES} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {}
): void {
  res.writeHead(status, { "Content-Type": "application/json", ...extraHeaders });
  res.end(JSON.stringify(body));
}
