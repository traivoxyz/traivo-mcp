import { describe, expect, it } from "vitest";
import { TraivoApiError, TraivoClient } from "../src/client.js";
import { DEFAULT_API_URL, loadConfig } from "../src/config.js";
import { errorResult } from "../src/server.js";
import { mockFetch, reply } from "./helpers.js";

describe("TraivoClient", () => {
  it("sends JSON accept + a user agent and strips trailing slashes", async () => {
    const seen: RequestInit[] = [];
    const client = new TraivoClient({
      baseUrl: "https://api.test///",
      fetch: async (url, init) => {
        seen.push(init!);
        expect(url).toBe("https://api.test/api/chain");
        return reply({ chainId: 1 });
      },
    });
    await client.chain();
    const headers = seen[0]!.headers as Record<string, string>;
    expect(headers.accept).toBe("application/json");
    expect(headers["user-agent"]).toMatch(/^traivo-mcp\//);
  });

  it("encodes path parameters", async () => {
    const { fetch, calls } = mockFetch({});
    const client = new TraivoClient({ baseUrl: "https://api.test", fetch });
    await client.hyperliquid("0xabc/../x").catch(() => {});
    expect(calls[0]!.pathname).toBe("/api/integrations/hyperliquid/0xabc%2F..%2Fx");
  });

  it("maps API error bodies to TraivoApiError", async () => {
    const { fetch } = mockFetch({ "/api/scorecard": { status: 502, body: { error: "upstream_failed" } } });
    const err = await new TraivoClient({ baseUrl: "https://api.test", fetch }).scorecard().catch((e) => e);
    expect(err).toBeInstanceOf(TraivoApiError);
    expect(err).toMatchObject({ status: 502, code: "upstream_failed" });
  });

  it("reports non-JSON bodies", async () => {
    const { fetch } = mockFetch({ "/api/stocks": { status: 200, body: "<html>oops</html>" } });
    const err = await new TraivoClient({ baseUrl: "https://api.test", fetch }).stocks().catch((e) => e);
    expect(err).toMatchObject({ code: "bad_json" });
  });

  it("reports network failures and timeouts", async () => {
    const down = new TraivoClient({
      baseUrl: "https://api.test",
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });
    expect(await down.crypto().catch((e) => e)).toMatchObject({ status: 0, code: "network_error" });

    const slow = new TraivoClient({
      baseUrl: "https://api.test",
      timeoutMs: 20,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason))),
    });
    expect(await slow.crypto().catch((e) => e)).toMatchObject({ code: "timeout" });
  });

  it("turns errors into MCP error results", () => {
    const r = errorResult(new TraivoApiError(404, "no_route"));
    expect(r.isError).toBe(true);
    expect(JSON.parse((r.content[0] as { text: string }).text)).toMatchObject({ error: "no_route", status: 404 });
    expect(JSON.parse((errorResult(new Error("boom")).content[0] as { text: string }).text).error).toBe(
      "internal_error",
    );
  });
});

describe("loadConfig", () => {
  it("defaults to the public dapp", () => {
    expect(loadConfig({})).toEqual({ apiUrl: DEFAULT_API_URL, appUrl: DEFAULT_API_URL, timeoutMs: 15_000 });
  });

  it("reads overrides and normalises URLs", () => {
    expect(
      loadConfig({
        TRAIVO_API_URL: "http://localhost:8787/",
        TRAIVO_APP_URL: "https://app.test/",
        TRAIVO_TIMEOUT_MS: "500",
      }),
    ).toEqual({ apiUrl: "http://localhost:8787", appUrl: "https://app.test", timeoutMs: 500 });
    expect(loadConfig({ TRAIVO_API_URL: "http://localhost:8787" }).appUrl).toBe("http://localhost:8787");
  });

  it("rejects invalid URLs", () => {
    expect(() => loadConfig({ TRAIVO_API_URL: "not a url" })).toThrow(/TRAIVO_API_URL/);
    expect(() => loadConfig({ TRAIVO_API_URL: "ftp://x.test" })).toThrow(/http/);
  });
});
