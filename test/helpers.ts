import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { TraivoClient, type FetchLike, type HttpReply } from "../src/client.js";
import { createTraivoServer } from "../src/server.js";

export const fixture = <T = unknown>(name: string): T =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8")) as T;

export type Route = { status?: number; body: unknown } | ((url: URL) => { status?: number; body: unknown });

/** A minimal fetch reply: what TraivoClient reads (ok, status, text). */
export function reply(body: unknown, status = 200): HttpReply {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, text: async () => text };
}

/** Fetch stub keyed by pathname. Records every requested URL. */
export function mockFetch(routes: Record<string, Route>) {
  const calls: URL[] = [];
  const fetch: FetchLike = async (input) => {
    const url = new URL(input);
    calls.push(url);
    const route = routes[url.pathname];
    if (!route) return reply({ error: "not_found" }, 404);
    const { status = 200, body } = typeof route === "function" ? route(url) : route;
    return reply(body, status);
  };
  return { fetch, calls };
}

export const API = "https://api.test";
export const APP = "https://app.test";

/** The real routes of the Traivo API, answered with fixtures. */
export function apiRoutes(): Record<string, Route> {
  return {
    "/api/stocks": { body: fixture("stocks") },
    "/api/onchain": { body: fixture("onchain") },
    "/api/crypto": { body: fixture("crypto") },
    "/api/quote": { body: fixture("quote-nvda-buy") },
    "/api/scorecard": { body: fixture("scorecard") },
    "/api/chain": { body: fixture("chain") },
    "/api/portfolio/0x000000000000000000000000000000000000dEaD": (url) => ({
      body: fixture(url.searchParams.get("net") === "testnet" ? "portfolio-testnet" : "portfolio"),
    }),
    "/api/integrations/hyperliquid/0x000000000000000000000000000000000000dEaD": { body: fixture("hyperliquid") },
  };
}

/** An MCP client connected in-memory to the traivo server, backed by the fetch stub. */
export async function connect(routes: Record<string, Route> = apiRoutes()) {
  const { fetch, calls } = mockFetch(routes);
  const server = createTraivoServer({ client: new TraivoClient({ baseUrl: API, fetch }), appUrl: APP });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  async function call(name: string, args: Record<string, unknown> = {}) {
    const res = await client.callTool({ name, arguments: args });
    const content = res.content as { type: string; text: string }[];
    const text = content[0]?.text ?? "";
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { isError: !!res.isError, text, json };
  }
  return { client, server, calls, call };
}
