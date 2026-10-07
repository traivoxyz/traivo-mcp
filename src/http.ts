import { createServer, type IncomingMessage, type Server } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Logger } from "./log.js";
import type { ServerOptions } from "./server.js";
import { createTraivoServer } from "./server.js";

const MAX_BODY = 1_000_000;

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new Error("body_too_large");
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : undefined;
}

type Outgoing = { writeHead(status: number, headers: Record<string, string>): { end(chunk: string): unknown } };

function sendJson(res: Outgoing, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

/**
 * Stateless streamable HTTP transport: a fresh server + transport per POST to `/mcp`.
 * Binds to 127.0.0.1 by default; it has no auth, so put it behind your own proxy before exposing it.
 */
export function startHttpServer(
  opts: ServerOptions & { port: number; host?: string; logger: Logger },
): Promise<Server> {
  const { port, host = "127.0.0.1", logger } = opts;
  const http = createServer(async (req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    if (path === "/health") return sendJson(res, 200, { ok: true });
    if (path !== "/mcp") return sendJson(res, 404, { error: "not_found" });
    if (req.method !== "POST")
      return sendJson(res, 405, {
        jsonrpc: "2.0",
        error: { code: -32000, message: "Method not allowed (stateless server: POST only)" },
        id: null,
      });
    try {
      const body = await readJson(req);
      const server = createTraivoServer(opts);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (err) {
      logger("error", "http request failed", { error: err instanceof Error ? err.message : String(err) });
      if (!res.headersSent)
        sendJson(res, 400, { jsonrpc: "2.0", error: { code: -32700, message: "Bad request" }, id: null });
    }
  });
  return new Promise((resolve, reject) => {
    http.once("error", reject);
    http.listen(port, host, () => {
      logger("info", `streamable HTTP on http://${host}:${port}/mcp`);
      resolve(http);
    });
  });
}
