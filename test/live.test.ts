/**
 * Live smoke test against the real Traivo API. Off by default; run with:
 *   TRAIVO_LIVE=1 pnpm test:live            (or set TRAIVO_API_URL to another deployment)
 * It only reads public data.
 */
import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createTraivoServer } from "../src/server.js";

const live = process.env.TRAIVO_LIVE === "1";
const DEAD = "0x000000000000000000000000000000000000dEaD";

describe.skipIf(!live)("live Traivo API", () => {
  async function connect() {
    const server = createTraivoServer();
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "live-test", version: "0" });
    await Promise.all([server.connect(a), client.connect(b)]);
    return async (name: string, args: Record<string, unknown> = {}) => {
      const res = await client.callTool({ name, arguments: args });
      const text = (res.content as { text: string }[])[0]!.text;
      if (res.isError) throw new Error(`${name}: ${text}`);
      return JSON.parse(text);
    };
  }

  it("reads every endpoint", async () => {
    const call = await connect();
    const board = await call("get_stock_board");
    expect(board.count).toBeGreaterThan(0);
    expect(board.rows.some((r: { symbol: string }) => r.symbol === "NVDA")).toBe(true);

    const onchain = await call("get_onchain_tokens", { limit: 5 });
    expect(onchain.total).toBeGreaterThan(0);

    const crypto = await call("get_crypto_markets", { limit: 3 });
    expect(crypto.rows[0].mid).toBeGreaterThan(0);

    const quote = await call("get_trade_quote", { symbol: "NVDA", side: "buy", amount: 100 });
    expect(quote.amountOut).toBeGreaterThan(0);
    expect(quote.amountInUnit).toBe("USDC");

    const pf = await call("get_portfolio", { address: DEAD });
    expect(pf.address.toLowerCase()).toBe(DEAD.toLowerCase());
    const testnet = await call("get_portfolio", { address: DEAD, network: "testnet" });
    expect(testnet.network).toBe("testnet");

    const hl = await call("get_hyperliquid_account", { address: DEAD });
    expect(hl).toHaveProperty("accountValue");

    const card = await call("get_scorecard", { limit: 5 });
    expect(card.summary).toHaveProperty("total");

    const chain = await call("get_chain_status");
    console.error(`[live] chainId=${chain.chainId} block=${chain.block} gas=${chain.gasGwei} gwei`);
    expect(chain.chainId).toBe(1);

    const link = await call("prepare_trade_link", { symbol: "NVDA", side: "buy", amount: 100 });
    expect(link.url).toMatch(/\/trade\?s=NVDA&side=buy&amount=100$/);

    console.error(
      `[live] stocks=${board.count} onchain=${onchain.total} crypto=${crypto.count} NVDA $100 buy -> ${quote.amountOut} @ ${quote.price} (impact ${quote.impactBps} bps) scorecard=${card.summary.total} block=${chain.block}`,
    );
  });
});
