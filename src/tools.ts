import { z } from "zod";
import type { TraivoClient } from "./client.js";
import { sizePosition } from "./sizing.js";
import { tradeLink } from "./links.js";

export type ToolContext = { client: TraivoClient; appUrl: string };

export type ToolDef<S extends z.ZodRawShape = z.ZodRawShape> = {
  name: string;
  title: string;
  description: string;
  inputSchema: S;
  /** Whether the tool calls the network (false = pure local computation). */
  network: boolean;
  run: (args: z.infer<z.ZodObject<S>>, ctx: ToolContext) => Promise<unknown>;
};

const defineTool = <S extends z.ZodRawShape>(def: ToolDef<S>) => def;

const symbol = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9.-]{1,20}$/, "1-20 letters, digits, '.' or '-'")
  .describe("Ticker as Traivo lists it, e.g. NVDA, TSLA, SPY, ETH, WBTC. Case-insensitive.");
const symbols = z.array(symbol).max(100).optional().describe("Only return these symbols. Omit for all.");
const side = z.enum(["buy", "sell"]).describe("buy = spend USDC for the token; sell = sell the token for USDC.");
const amount = z
  .number()
  .positive()
  .max(1e12)
  .describe("Size of the trade: USDC to spend for a buy, number of tokens for a sell.");
const address = z
  .string()
  .trim()
  .regex(/^0x[0-9a-fA-F]{40}$/, "a 0x-prefixed 20-byte hex address")
  .describe("EVM wallet address (0x…). Public data only; no signature needed.");
const limit = (def: number, max: number) =>
  z.number().int().min(1).max(max).optional().describe(`Max rows to return (default ${def}, max ${max}).`);

const pick = <T extends { symbol: string }>(rows: T[], wanted?: string[]) => {
  if (!wanted?.length) return rows;
  const set = new Set(wanted.map((s) => s.toUpperCase()));
  return rows.filter((r) => set.has(r.symbol.toUpperCase()));
};

const iso = (sec: number | null) => (sec ? new Date(sec * 1000).toISOString() : null);

export const TOOLS = [
  defineTool({
    name: "get_stock_board",
    title: "Stock token board",
    description:
      "Live board of tokenized stocks on Ethereum mainnet (Ondo Global Markets tokens, traded on Uniswap V3 against USDC). Per token: on-chain bid (USDC for selling 1 token), ask (USDC per token when buying with $1,000), mid, spread, the listed share's last price as the reference with its age in seconds, and the premium of the on-chain mid vs that share price in bps. Also returns ethUsd, the ETH price. Null prices mean the pool is not quoted; a null reference means there is no listed share to compare against. The tokens trade around the clock but the share price only moves while its exchange is open, so a large referenceAgeSec outside US market hours is normal.",
    inputSchema: { symbols },
    network: true,
    async run(args, { client }) {
      const board = await client.stocks();
      const rows = pick(board.rows, args.symbols).map((r) => ({
        symbol: r.symbol,
        name: r.name,
        address: r.address,
        bid: r.bid,
        ask: r.ask,
        mid: r.mid,
        spreadBps: r.spreadBps,
        reference: r.reference,
        referenceAgeSec: r.referenceAge,
        premiumBps: r.premiumBps,
        venue: r.venue,
      }));
      return { block: board.block, ethUsd: board.eth, count: rows.length, rows };
    },
  }),
  defineTool({
    name: "get_onchain_tokens",
    title: "On-chain crypto tokens",
    description:
      "Tokens with a real Uniswap V3 route against USDC on Ethereum mainnet (ETH plus tokens Traivo discovered on-chain), with the on-chain USD price when a quote is available. `via` is the route (direct USDC pool, or USDC → WETH → token); `fee` is the pool fee tier in hundredths of a bip. Discovered tokens are not reviewed by Traivo — check liquidity with get_trade_quote before sizing up.",
    inputSchema: {
      symbol: symbol.optional().describe("Only this symbol."),
      priced_only: z.boolean().optional().describe("Drop tokens with no current on-chain price (default false)."),
      limit: limit(100, 500),
    },
    network: true,
    async run(args, { client }) {
      const { rows } = await client.onchain();
      let out = pick(rows, args.symbol ? [args.symbol] : undefined);
      if (args.priced_only) out = out.filter((r) => r.price !== null);
      const total = out.length;
      out = out.slice(0, args.limit ?? 100);
      return {
        total,
        count: out.length,
        rows: out.map((r) => ({
          symbol: r.symbol,
          name: r.name,
          address: r.address,
          via: r.via,
          fee: r.fee,
          price: r.price,
        })),
      };
    },
  }),
  defineTool({
    name: "get_crypto_markets",
    title: "Crypto perp markets",
    description:
      "Major crypto perpetual markets from Hyperliquid, sorted by 24h volume as Traivo shows them: mid price, 24h change %, 24h volume (USD), annualised funding % and open interest (USD), max leverage. Reference data for majors; these are not Ethereum swaps.",
    inputSchema: { symbols, limit: limit(40, 100) },
    network: true,
    async run(args, { client }) {
      const { rows } = await client.crypto();
      const out = pick(rows, args.symbols).slice(0, args.limit ?? 40);
      return {
        count: out.length,
        rows: out.map((r) => ({
          symbol: r.symbol,
          mid: r.mid,
          change24hPct: r.change24h,
          volume24hUsd: r.volume24h,
          fundingAprPct: r.fundingApr,
          openInterestUsd: r.openInterestUsd,
          maxLeverage: r.maxLeverage,
        })),
      };
    },
  }),
  defineTool({
    name: "get_trade_quote",
    title: "Trade quote",
    description:
      "Live pre-trade quote for swapping a token against USDC on Uniswap V3 on Ethereum mainnet, read from the chain at the current block. Returns amount in/out, average price at this size, price impact vs a small trade, premium vs the reference (the listed share price for tokenized stocks, Chainlink ETH/USD for ETH, the Hyperliquid mid for other crypto it lists), an impact ladder at larger sizes and the pool fee. Ethereum gas is not included. Read-only: nothing is signed or sent.",
    inputSchema: { symbol, side, amount },
    network: true,
    async run(args, { client }) {
      const q = await client.quote(args.symbol.toUpperCase(), args.side, args.amount);
      return {
        symbol: q.symbol,
        side: q.side,
        amountIn: q.amountIn,
        amountInUnit: q.side === "buy" ? "USDC" : q.symbol,
        amountOut: q.amountOut,
        amountOutUnit: q.side === "buy" ? q.symbol : "USDC",
        price: q.price,
        smallTradePrice: q.smallPrice,
        impactBps: q.impactBps,
        reference: q.reference,
        referenceAgeSec: q.referenceAge,
        premiumBps: q.premiumBps,
        depth: q.depth,
        poolFee: q.fee,
        block: q.block,
      };
    },
  }),
  defineTool({
    name: "get_portfolio",
    title: "Wallet portfolio",
    description:
      "Public token holdings of any address on Ethereum mainnet: ETH, USDC, Ondo tokenized stocks and discovered tokens, each with balance, USD price, price source (dex, peg or chainlink) and value, plus the total. Symbols listed in `unpriced` are held but have no price. Use network=testnet for Sepolia (ETH and test USDC only).",
    inputSchema: {
      address,
      network: z.enum(["mainnet", "testnet"]).optional().describe("mainnet = Ethereum (default); testnet = Sepolia."),
    },
    network: true,
    async run(args, { client }) {
      const p = await client.portfolio(args.address, args.network ?? "mainnet");
      return {
        address: p.address,
        network: args.network ?? "mainnet",
        block: p.block,
        totalUsd: p.total,
        holdings: p.holdings,
        unpriced: p.unpriced,
      };
    },
  }),
  defineTool({
    name: "get_hyperliquid_account",
    title: "Hyperliquid account",
    description:
      "Read-only summary of a Hyperliquid account by address: account value, withdrawable, margin used, total notional, open perp positions (side, size, entry, mark, PnL, ROE, liquidation price and distance %, leverage) and spot balances. Public data; no keys.",
    inputSchema: { address },
    network: true,
    async run(args, { client }) {
      return client.hyperliquid(args.address);
    },
  }),
  defineTool({
    name: "size_position",
    title: "Position size",
    description:
      "Pure local math, no network: size a position from a max loss and a stop. quantity = risk budget / loss per unit at the stop (plus optional per-side costs and flat Ethereum gas per swap). Give risk_usd, or account_usd with risk_pct. Direction is inferred from the stop (stop below entry = buy). Optional target returns the R multiple and reward; optional max_notional_usd caps the size.",
    inputSchema: {
      entry: z.number().positive().describe("Entry price."),
      stop: z.number().positive().describe("Stop price; the trade is closed here."),
      risk_usd: z.number().positive().optional().describe("Max loss in USD if the stop is hit."),
      account_usd: z.number().positive().optional().describe("Account size in USD (with risk_pct)."),
      risk_pct: z.number().positive().max(100).optional().describe("Percent of account_usd to risk, e.g. 1 for 1%."),
      target: z.number().positive().optional().describe("Take-profit price, for the R multiple."),
      side: side.optional().describe("Optional check: must agree with the stop (buy = stop below entry)."),
      cost_bps: z.number().min(0).max(9_999).optional().describe("Fees + slippage per side in bps (default 0)."),
      gas_usd: z
        .number()
        .min(0)
        .max(1_000_000)
        .optional()
        .describe("Ethereum gas per swap in USD, paid on entry and exit (default 0 = not included)."),
      max_notional_usd: z.number().positive().optional().describe("Cap on position value in USD, e.g. your balance."),
    },
    network: false,
    async run(args) {
      return sizePosition({
        entry: args.entry,
        stop: args.stop,
        riskUsd: args.risk_usd,
        accountUsd: args.account_usd,
        riskPct: args.risk_pct,
        target: args.target,
        side: args.side,
        costBps: args.cost_bps,
        gasUsd: args.gas_usd,
        maxNotionalUsd: args.max_notional_usd,
      });
    },
  }),
  defineTool({
    name: "get_scorecard",
    title: "Traivo AI scorecard",
    description:
      "Traivo AI's public scorecard: every trade call it made (symbol, side, entry, stop, target, block), graded against live prices — target first = win, stop first = loss, expiry = sign of the return. Misses are included. Returns the summary over the latest calls and the matching calls, newest first.",
    inputSchema: {
      status: z
        .enum(["open", "win", "loss", "closed"])
        .optional()
        .describe("Filter: open, win, loss, or closed (win + loss)."),
      symbol: symbol.optional().describe("Only calls on this symbol."),
      limit: limit(50, 200),
    },
    network: true,
    async run(args, { client }) {
      const card = await client.scorecard();
      let rows = card.suggestions;
      if (args.status === "closed") rows = rows.filter((r) => r.status !== "open");
      else if (args.status) rows = rows.filter((r) => r.status === args.status);
      if (args.symbol) rows = pick(rows, [args.symbol]);
      const total = rows.length;
      rows = rows.slice(0, args.limit ?? 50);
      return {
        summary: card.summary,
        matching: total,
        count: rows.length,
        calls: rows.map((r) => ({
          id: r.id,
          createdAt: iso(r.created_at),
          block: r.block,
          symbol: r.symbol,
          side: r.side,
          amount: r.amount,
          entry: r.entry,
          reference: r.reference,
          stop: r.stop,
          target: r.target,
          status: r.status,
          reason: r.reason,
          resolvedAt: iso(r.resolved_at),
          exit: r.exit,
          returnPct: r.return_pct,
        })),
      };
    },
  }),
  defineTool({
    name: "get_chain_status",
    title: "Ethereum status",
    description:
      "Ethereum mainnet (chain id 1) head block, gas price (gwei) and RPC latency as seen by Traivo. Useful to timestamp other reads and to estimate gas for size_position.",
    inputSchema: {},
    network: true,
    async run(_args, { client }) {
      return client.chain();
    },
  }),
  defineTool({
    name: "prepare_trade_link",
    title: "Trade deep link",
    description:
      "Returns a Traivo link with the trade ticket prefilled (symbol, side, amount) for the USER to open, review and sign in their own wallet. This tool never signs, sends or simulates a transaction and needs no keys. Call get_trade_quote first so the user sees price impact before opening the link.",
    inputSchema: { symbol, side, amount },
    network: false,
    async run(args, { appUrl }) {
      return tradeLink(appUrl, args.symbol, args.side, args.amount);
    },
  }),
];

export type ToolName = (typeof TOOLS)[number]["name"];
