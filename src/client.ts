import { DEFAULT_API_URL, VERSION } from "./config.js";
import type {
  ChainStatus,
  CryptoRow,
  HlAccount,
  OnchainRow,
  Portfolio,
  Scorecard,
  Side,
  StockBoard,
  TradeQuote,
} from "./types.js";

/** The part of a fetch reply this client reads. The global `fetch` satisfies it. */
export type HttpReply = { ok: boolean; status: number; text(): Promise<string> };

export type FetchLike = (input: string, init?: RequestInit) => Promise<HttpReply>;

export type ClientOptions = {
  baseUrl?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
};

/** An error answered by the Traivo API (or the network on the way to it). */
export class TraivoApiError extends Error {
  constructor(
    /** HTTP status, or 0 for network/timeout errors. */
    readonly status: number,
    /** The API's `error` code (e.g. `no_route`, `bad_address`), or a local one. */
    readonly code: string,
    message?: string,
  ) {
    super(message ?? `Traivo API error ${status}: ${code}`);
    this.name = "TraivoApiError";
  }
}

/** Thin, read-only client over the public Traivo HTTP API. */
export class TraivoClient {
  readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(opts: ClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? DEFAULT_API_URL).replace(/\/+$/, "");
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  async get<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T> {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
    let res: HttpReply;
    try {
      res = await this.fetchImpl(url.toString(), {
        headers: { accept: "application/json", "user-agent": `traivo-mcp/${VERSION}` },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const timeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      throw new TraivoApiError(
        0,
        timeout ? "timeout" : "network_error",
        timeout ? `Request to ${path} timed out` : `Could not reach the Traivo API (${(err as Error).message})`,
      );
    }
    const text = await res.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      throw new TraivoApiError(res.status, "bad_json", `Traivo API returned non-JSON for ${path} (HTTP ${res.status})`);
    }
    if (!res.ok) {
      const code =
        body && typeof body === "object" && "error" in body
          ? String((body as { error: unknown }).error)
          : `http_${res.status}`;
      throw new TraivoApiError(res.status, code);
    }
    return body as T;
  }

  /** Tokenized stocks on Ethereum (Ondo Global Markets): Uniswap V3 bid/ask/mid in USDC vs the listed share price. */
  stocks() {
    return this.get<StockBoard>("/api/stocks");
  }

  /** Tokens swappable against USDC on Ethereum (Uniswap V3) with on-chain prices. */
  onchain() {
    return this.get<{ rows: OnchainRow[] }>("/api/onchain");
  }

  /** Perp markets from Hyperliquid (majors): mid, 24h change, funding, open interest. */
  crypto() {
    return this.get<{ rows: CryptoRow[] }>("/api/crypto");
  }

  /** Pre-trade quote against USDC on Ethereum. `amount` is USDC for buys, tokens for sells. */
  quote(symbol: string, side: Side, amount: number) {
    return this.get<TradeQuote>("/api/quote", { symbol, side, amount });
  }

  /** Wallet holdings on Ethereum mainnet, or Sepolia with `network: "testnet"`. */
  portfolio(address: string, network: "mainnet" | "testnet" = "mainnet") {
    return this.get<Portfolio>(
      `/api/portfolio/${encodeURIComponent(address)}`,
      network === "testnet" ? { net: "testnet" } : undefined,
    );
  }

  /** Read-only Hyperliquid account summary for any address. */
  hyperliquid(address: string) {
    return this.get<HlAccount>(`/api/integrations/hyperliquid/${encodeURIComponent(address)}`);
  }

  /** Public scorecard of every Traivo AI call, misses included. */
  scorecard() {
    return this.get<Scorecard>("/api/scorecard");
  }

  /** Ethereum mainnet head block, gas price and RPC latency. */
  chain() {
    return this.get<ChainStatus>("/api/chain");
  }
}
