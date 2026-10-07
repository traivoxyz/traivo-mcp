/**
 * Shapes returned by the public Traivo HTTP API (https://dapp.traivo.xyz/api/*), Ethereum mainnet data.
 * Amounts are in USDC unless a field says otherwise.
 * Kept in sync by hand with the dapp; only the fields this server reads or forwards are typed.
 */

export type Side = "buy" | "sell";

export type StockRow = {
  symbol: string;
  name: string;
  address: string;
  /** Last price of the listed share the token tracks (USD); null when there is no listed share. */
  reference: number | null;
  /** Seconds since that share price was set. */
  referenceAge: number | null;
  /** USDC received for selling 1 token on Uniswap V3. */
  bid: number | null;
  /** USDC per token when buying with $1,000 of USDC. */
  ask: number | null;
  mid: number | null;
  spreadBps: number | null;
  /** On-chain mid vs the listed share price, in basis points. */
  premiumBps: number | null;
  venue: string;
};

/** `eth` is the ETH price in USD. */
export type StockBoard = { block: string; rows: StockRow[]; eth: number | null };

export type OnchainRow = {
  symbol: string;
  name: string;
  address: string;
  /** Direct USDC pool, or USDC → WETH → token. */
  via: "USDC" | "WETH";
  fee: number;
  image: string | null;
  price: number | null;
};

export type CryptoRow = {
  symbol: string;
  mid: number;
  change24h: number | null;
  volume24h: number;
  fundingApr: number;
  openInterestUsd: number;
  maxLeverage: number;
};

export type TradeQuote = {
  symbol: string;
  side: Side;
  /** USDC for buy, tokens for sell. */
  amountIn: number;
  /** Tokens for buy, USDC for sell. */
  amountOut: number;
  price: number;
  smallPrice: number | null;
  impactBps: number | null;
  reference: number | null;
  premiumBps: number | null;
  referenceAge: number | null;
  depth: { usd: number; impactBps: number | null }[];
  fee: number;
  block: string;
};

export type Holding = {
  symbol: string;
  name: string;
  /** null = native ETH. */
  address: string | null;
  balance: number;
  price: number | null;
  priceSource: "chainlink" | "dex" | "peg" | null;
  value: number | null;
};

export type Portfolio = {
  address: string;
  block: string;
  holdings: Holding[];
  total: number;
  unpriced: string[];
};

export type HlPosition = {
  coin: string;
  side: "long" | "short";
  size: number;
  entry: number | null;
  mark: number | null;
  value: number;
  pnl: number;
  roe: number;
  liquidation: number | null;
  liqDistancePct: number | null;
  leverage: string | null;
};

export type HlAccount = {
  address: string;
  accountValue: number;
  withdrawable: number;
  marginUsed: number;
  notional: number;
  positions: HlPosition[];
  spot: { coin: string; total: number }[];
};

export type ScorecardStatus = "open" | "win" | "loss";

export type Suggestion = {
  id: string;
  /** Unix seconds. */
  created_at: number;
  block: string;
  symbol: string;
  side: Side;
  amount: number;
  entry: number;
  reference: number | null;
  stop: number;
  target: number;
  status: ScorecardStatus;
  /** "tp" | "sl" | "expiry" once resolved. */
  reason: string | null;
  resolved_at: number | null;
  exit: number | null;
  return_pct: number | null;
};

export type ScorecardSummary = {
  total: number;
  open: number;
  closed: number;
  wins: number;
  losses: number;
  winRate: number | null;
  avgReturnPct: number | null;
};

export type Scorecard = { summary: ScorecardSummary; suggestions: Suggestion[] };

export type ChainStatus = { chainId: number; block: string; gasGwei: number; latencyMs: number };
