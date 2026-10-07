import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "tsup";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { TraivoClient } from "../src/client.js";
import { startHttpServer } from "../src/http.js";
import { silentLogger } from "../src/log.js";
import { apiRoutes, mockFetch } from "./helpers.js";

/** A local stand-in for the Traivo API, served from the fixtures. */
async function fakeApi(): Promise<{ url: string; server: Server }> {
  const { fetch } = mockFetch(apiRoutes());
  const server = createServer(async (req, res) => {
    const r = await fetch(`http://fake${req.url}`);
    res.writeHead(r.status, { "content-type": "application/json" }).end(await r.text());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
}

describe("stdio transport", () => {
  let dir: string;
  let api: { url: string; server: Server };

  beforeAll(async () => {
    // Build inside the repo so the bundle resolves its dependencies from ./node_modules.
    const cache = join(process.cwd(), "node_modules", ".cache");
    mkdirSync(cache, { recursive: true });
    dir = mkdtempSync(join(cache, "traivo-mcp-stdio-"));
    await build({
      entry: { cli: "src/cli.ts" },
      outDir: dir,
      format: ["esm"],
      platform: "node",
      silent: true,
      dts: false,
    });
    api = await fakeApi();
  });

  afterAll(() => {
    api?.server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("keeps stdout protocol-clean while logging to stderr", async () => {
    const child = spawn(process.execPath, [join(dir, "cli.js")], {
      env: { ...process.env, TRAIVO_API_URL: api.url, TRAIVO_DEBUG: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));

    const send = (msg: object) => child.stdin.write(JSON.stringify(msg) + "\n");
    const waitFor = (id: number) =>
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no reply for id ${id}; stderr: ${stderr}`)), 10_000);
        const check = () => {
          if (stdout.split("\n").some((l) => l.includes(`"id":${id}`))) {
            clearTimeout(timer);
            child.stdout.off("data", check);
            resolve();
          }
        };
        child.stdout.on("data", check);
        check();
      });

    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } },
    });
    await waitFor(1);
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "get_stock_board", arguments: { symbols: ["NVDA"] } },
    });
    // a failing call exercises the warn log path
    send({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "get_hyperliquid_account", arguments: { address: "0x0000000000000000000000000000000000000001" } },
    });
    await Promise.all([waitFor(2), waitFor(3), waitFor(4)]);
    child.kill();

    const lines = stdout.split("\n").filter((l) => l.length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(4);
    for (const line of lines) {
      const msg = JSON.parse(line);
      expect(msg.jsonrpc).toBe("2.0");
    }
    const byId = Object.fromEntries(lines.map((l) => JSON.parse(l)).map((m) => [m.id, m]));
    expect(byId[1].result.serverInfo.name).toBe("traivo");
    expect(byId[2].result.tools).toHaveLength(10);
    expect(JSON.parse(byId[3].result.content[0].text).rows[0].symbol).toBe("NVDA");
    expect(byId[4].result.isError).toBe(true);
    // logs went to stderr
    expect(stderr).toContain("[traivo-mcp] info: ready on stdio");
    expect(stderr).toContain("get_stock_board ok");
    expect(stderr).toContain("get_hyperliquid_account failed");
  });

  it("prints help to stderr, not stdout", async () => {
    const child = spawn(process.execPath, [join(dir, "cli.js"), "--help"], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const code = await new Promise((resolve) => child.on("close", resolve));
    expect(code).toBe(0);
    expect(stdout).toBe("");
    expect(stderr).toContain("TRAIVO_API_URL");
  });
});

describe("streamable HTTP transport", () => {
  it("serves tools statelessly on /mcp", async () => {
    const { fetch } = mockFetch(apiRoutes());
    const http = await startHttpServer({
      client: new TraivoClient({ baseUrl: "https://api.test", fetch }),
      appUrl: "https://app.test",
      logger: silentLogger,
      port: 0,
    });
    const { port } = http.address() as AddressInfo;
    try {
      const health = await globalThis.fetch(`http://127.0.0.1:${port}/health`);
      expect(await health.json()).toEqual({ ok: true });
      expect((await globalThis.fetch(`http://127.0.0.1:${port}/mcp`)).status).toBe(405);

      const client = new Client({ name: "t", version: "0" });
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(10);
      const res = await client.callTool({
        name: "prepare_trade_link",
        arguments: { symbol: "AAPL", side: "buy", amount: 50 },
      });
      const text = (res.content as { text: string }[])[0]!.text;
      expect(JSON.parse(text).url).toBe("https://app.test/trade?s=AAPL&side=buy&amount=50");
      await client.close();
    } finally {
      http.close();
    }
  });
});
