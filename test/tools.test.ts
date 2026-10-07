import { describe, expect, it } from "vitest";
import { APP, apiRoutes, connect, fixture } from "./helpers.js";

const DEAD = "0x000000000000000000000000000000000000dEaD";

describe("get_stock_board", () => {
  it("returns every row, compacted, with the ETH price", async () => {
    const { call, calls } = await connect();
    const { isError, json } = await call("get_stock_board");
    expect(isError).toBe(false);
    const raw = fixture<{ rows: { symbol: string; mid: number | null }[] }>("stocks");
    expect(calls[0]!.pathname).toBe("/api/stocks");
    expect(json.count).toBe(raw.rows.length);
    expect(json.ethUsd).toBeTypeOf("number");
    const nvda = json.rows.find((r: { symbol: string }) => r.symbol === "NVDA");
    expect(Object.keys(nvda)).toEqual([
      "symbol",
      "name",
      "address",
      "bid",
      "ask",
      "mid",
      "spreadBps",
      "reference",
      "referenceAgeSec",
      "premiumBps",
      "venue",
    ]);
    // compacted to 6 significant digits
    expect(String(nvda.mid).replace(".", "").length).toBeLessThanOrEqual(6);
  });

  it("filters by symbol, case-insensitively", async () => {
    const { call } = await connect();
    const { json } = await call("get_stock_board", { symbols: ["nvda", "TSLA"] });
    expect(json.rows.map((r: { symbol: string }) => r.symbol)).toEqual(["NVDA", "TSLA"]);
  });

  it("keeps a null reference for tokens with no listed share", async () => {
    const { call } = await connect();
    const { json } = await call("get_stock_board", { symbols: ["SPCX"] });
    expect(json.rows[0].mid).toBeTypeOf("number");
    expect(json.rows[0].reference).toBeNull();
    expect(json.rows[0].premiumBps).toBeNull();
    expect(json.rows[0].venue).toMatch(/Uniswap V3/);
  });

  it("keeps null prices for pools that were not quoted", async () => {
    const raw = fixture<{ block: string; rows: Record<string, unknown>[]; eth: number }>("stocks");
    const unquoted = {
      ...raw.rows[0],
      symbol: "XYZ",
      bid: null,
      ask: null,
      mid: null,
      spreadBps: null,
      premiumBps: null,
    };
    const { call } = await connect({ ...apiRoutes(), "/api/stocks": { body: { ...raw, rows: [unquoted] } } });
    const { json } = await call("get_stock_board");
    expect(json.rows[0]).toMatchObject({ symbol: "XYZ", mid: null, bid: null, ask: null });
  });
});

describe("get_onchain_tokens", () => {
  it("drops images and supports priced_only + limit", async () => {
    const { call } = await connect();
    const all = await call("get_onchain_tokens");
    expect(all.json.total).toBe(5);
    expect(all.json.rows[0]).not.toHaveProperty("image");
    const priced = await call("get_onchain_tokens", { priced_only: true, limit: 2 });
    expect(priced.json.total).toBe(4);
    expect(priced.json.count).toBe(2);
    expect(priced.json.rows.every((r: { price: number | null }) => r.price !== null)).toBe(true);
  });

  it("looks up one symbol", async () => {
    const { call } = await connect();
    const { json } = await call("get_onchain_tokens", { symbol: "eth" });
    expect(json.rows).toHaveLength(1);
    expect(json.rows[0]).toMatchObject({ symbol: "ETH", via: "USDC", fee: 500 });
  });
});

describe("get_crypto_markets", () => {
  it("renames fields with units and limits rows", async () => {
    const { call, calls } = await connect();
    const { json } = await call("get_crypto_markets", { limit: 2 });
    expect(calls[0]!.pathname).toBe("/api/crypto");
    expect(json.count).toBe(2);
    expect(json.rows[0]).toHaveProperty("fundingAprPct");
    expect(json.rows[0]).toHaveProperty("change24hPct");
    expect(json.rows[0].symbol).toBe("BTC");
  });
});

describe("get_trade_quote", () => {
  it("passes symbol, side and amount and labels units", async () => {
    const { call, calls } = await connect();
    const { isError, json } = await call("get_trade_quote", { symbol: "nvda", side: "buy", amount: 100 });
    expect(isError).toBe(false);
    const q = calls[0]!;
    expect(q.pathname).toBe("/api/quote");
    expect(Object.fromEntries(q.searchParams)).toEqual({ symbol: "NVDA", side: "buy", amount: "100" });
    expect(json).toMatchObject({
      symbol: "NVDA",
      side: "buy",
      amountInUnit: "USDC",
      amountOutUnit: "NVDA",
      poolFee: 3000,
    });
    expect(json.depth).toHaveLength(4);
  });

  it("maps no_route to a helpful error", async () => {
    const { call } = await connect({ ...apiRoutes(), "/api/quote": { status: 404, body: { error: "no_route" } } });
    const { isError, json } = await call("get_trade_quote", { symbol: "XYZ", side: "buy", amount: 10 });
    expect(isError).toBe(true);
    expect(json).toMatchObject({ error: "no_route", status: 404 });
    expect(json.message).toMatch(/get_stock_board/);
    expect(json.message).toMatch(/USDC on Ethereum/);
  });
});

describe("get_portfolio", () => {
  it("reads mainnet by default", async () => {
    const { call, calls } = await connect();
    const { json } = await call("get_portfolio", { address: DEAD });
    expect(calls[0]!.pathname).toBe(`/api/portfolio/${DEAD}`);
    expect(calls[0]!.search).toBe("");
    expect(json).toMatchObject({ network: "mainnet", totalUsd: 1955.82, unpriced: ["MYSTERY"] });
    expect(json.holdings.map((h: { symbol: string }) => h.symbol)).toEqual(["USDC", "ETH", "NVDA"]);
    expect(json.holdings).toHaveLength(3);
  });

  it("reads the testnet with net=testnet", async () => {
    const { call, calls } = await connect();
    const { json } = await call("get_portfolio", { address: DEAD, network: "testnet" });
    expect(calls[0]!.searchParams.get("net")).toBe("testnet");
    expect(json).toMatchObject({ network: "testnet", totalUsd: 0, holdings: [] });
  });
});

describe("get_hyperliquid_account", () => {
  it("forwards the account summary", async () => {
    const { call, calls } = await connect();
    const { json } = await call("get_hyperliquid_account", { address: DEAD });
    expect(calls[0]!.pathname).toBe(`/api/integrations/hyperliquid/${DEAD}`);
    expect(json.positions).toHaveLength(2);
    expect(json.positions[1]).toMatchObject({ coin: "SOL", side: "short" });
    expect(json.positions[0].liquidation).toBe(61234.1);
  });
});

describe("size_position", () => {
  it("is local: no fetch", async () => {
    const { call, calls } = await connect();
    const { isError, json } = await call("size_position", { entry: 100, stop: 95, risk_usd: 50, target: 115 });
    expect(isError).toBe(false);
    expect(calls).toHaveLength(0);
    expect(json).toMatchObject({ side: "buy", quantity: 10, notionalUsd: 1000, rMultiple: 3, rewardUsd: 150 });
    expect(json.notes.join(" ")).toMatch(/Ethereum gas is not included/);
  });

  it("counts Ethereum gas when gas_usd is given", async () => {
    const { call } = await connect();
    const { json } = await call("size_position", { entry: 100, stop: 95, risk_usd: 50, gas_usd: 5 });
    expect(json).toMatchObject({ quantity: 8, riskUsd: 50, gasUsd: 10 });
    expect(json.notes.join(" ")).toMatch(/\$5 of Ethereum gas per swap/);
  });

  it("reports bad combinations as invalid_input", async () => {
    const { call } = await connect();
    const { isError, json } = await call("size_position", { entry: 100, stop: 95 });
    expect(isError).toBe(true);
    expect(json).toMatchObject({ error: "invalid_input" });
  });
});

describe("get_scorecard", () => {
  it("returns the summary and calls with ISO dates", async () => {
    const { call } = await connect();
    const { json } = await call("get_scorecard");
    expect(json.summary).toMatchObject({ total: 3, wins: 1, losses: 1 });
    expect(json.calls).toHaveLength(3);
    expect(json.calls[0].createdAt).toBe(new Date(1791300000 * 1000).toISOString());
    expect(json.calls[0].resolvedAt).toBeNull();
  });

  it("filters by status and symbol", async () => {
    const { call } = await connect();
    expect((await call("get_scorecard", { status: "closed" })).json.matching).toBe(2);
    expect((await call("get_scorecard", { status: "open" })).json.calls[0].id).toBe("s3");
    const nvda = await call("get_scorecard", { symbol: "nvda", limit: 1 });
    expect(nvda.json).toMatchObject({ matching: 2, count: 1 });
  });
});

describe("get_chain_status", () => {
  it("returns the head block", async () => {
    const { call } = await connect();
    const { json } = await call("get_chain_status");
    expect(json).toMatchObject({ chainId: 1 });
    expect(json.block).toMatch(/^\d+$/);
  });
});

describe("prepare_trade_link", () => {
  it("builds a deep link on the app URL without any network call", async () => {
    const { call, calls } = await connect();
    const { json } = await call("prepare_trade_link", { symbol: "nvda", side: "buy", amount: 250 });
    expect(calls).toHaveLength(0);
    expect(json.url).toBe(`${APP}/trade?s=NVDA&side=buy&amount=250`);
    expect(json.amountUnit).toBe("USDC to spend");
    expect(json.signing).toMatch(/never signs/);
  });

  it("writes tiny sell amounts without exponent notation", async () => {
    const { call } = await connect();
    const { json } = await call("prepare_trade_link", { symbol: "ETH", side: "sell", amount: 0.00000042 });
    expect(json.url).toBe(`${APP}/trade?s=ETH&side=sell&amount=0.00000042`);
    expect(json.amountUnit).toBe("ETH tokens to sell");
  });
});
