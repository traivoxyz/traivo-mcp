import { describe, expect, it } from "vitest";
import { connect } from "./helpers.js";

const NAMES = [
  "get_stock_board",
  "get_onchain_tokens",
  "get_crypto_markets",
  "get_trade_quote",
  "get_portfolio",
  "get_hyperliquid_account",
  "size_position",
  "get_scorecard",
  "get_chain_status",
  "prepare_trade_link",
];

describe("tool listing", () => {
  it("exposes exactly the read-only tools, each with a description and an object schema", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...NAMES].sort());
    for (const t of tools) {
      expect(t.description?.length ?? 0).toBeGreaterThan(40);
      expect(t.inputSchema.type).toBe("object");
      expect(t.annotations?.readOnlyHint).toBe(true);
      expect(t.annotations?.destructiveHint).toBe(false);
    }
  });

  it("marks local tools as closed-world", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const open = Object.fromEntries(tools.map((t) => [t.name, t.annotations?.openWorldHint]));
    expect(open.size_position).toBe(false);
    expect(open.prepare_trade_link).toBe(false);
    expect(open.get_trade_quote).toBe(true);
  });

  it("publishes required fields and enums in the JSON schema", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const quote = tools.find((t) => t.name === "get_trade_quote")!;
    expect(quote.inputSchema.required?.sort()).toEqual(["amount", "side", "symbol"]);
    const props = quote.inputSchema.properties as Record<string, { enum?: string[]; description?: string }>;
    expect(props.side!.enum).toEqual(["buy", "sell"]);
    expect(props.amount!.description).toMatch(/USDC/);
    const pf = tools.find((t) => t.name === "get_portfolio")!;
    expect(pf.inputSchema.required).toEqual(["address"]);
  });

  it("never mentions signing keys or secrets as inputs", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    for (const t of tools) {
      const keys = Object.keys((t.inputSchema.properties ?? {}) as object).join(",");
      expect(keys).not.toMatch(/key|secret|private|mnemonic|token/i);
    }
  });
});

describe("input validation", () => {
  const bad: [string, Record<string, unknown>][] = [
    ["get_portfolio", { address: "0x1234" }],
    ["get_portfolio", { address: "0x000000000000000000000000000000000000dEaD", network: "devnet" }],
    ["get_hyperliquid_account", {}],
    ["get_trade_quote", { symbol: "NVDA", side: "short", amount: 10 }],
    ["get_trade_quote", { symbol: "NVDA", side: "buy", amount: -5 }],
    ["get_trade_quote", { symbol: "NVDA", side: "buy", amount: 1e13 }],
    ["get_trade_quote", { symbol: "NV DA", side: "buy", amount: 10 }],
    ["get_trade_quote", { symbol: "../../etc", side: "buy", amount: 10 }],
    ["get_onchain_tokens", { limit: 0 }],
    ["get_scorecard", { status: "pending" }],
    ["size_position", { entry: 0, stop: 1, risk_usd: 1 }],
    ["size_position", { entry: 10, stop: 9, account_usd: 1000, risk_pct: 150 }],
    ["prepare_trade_link", { symbol: "NVDA", side: "buy" }],
  ];

  it.each(bad)("%s rejects %j without calling the API", async (name, args) => {
    const { client, calls } = await connect();
    let rejected = false;
    try {
      const res = await client.callTool({ name, arguments: args });
      rejected = !!res.isError;
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
    expect(calls).toHaveLength(0);
  });
});
