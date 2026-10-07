import { decimalString } from "./format.js";
import type { Side } from "./types.js";

export type TradeLink = {
  url: string;
  symbol: string;
  side: Side;
  amount: number;
  amountUnit: string;
  signing: string;
};

/**
 * Build a deep link to Traivo's trade ticket, prefilled. The user opens it, reviews the quote and
 * pre-trade checks, and signs in their own wallet. Nothing here signs or sends anything.
 */
export function tradeLink(appUrl: string, symbol: string, side: Side, amount: number): TradeLink {
  const sym = symbol.trim().toUpperCase();
  if (!/^[A-Z0-9.-]{1,20}$/.test(sym)) throw new Error("symbol must be 1-20 letters, digits, '.' or '-'");
  if (!(Number.isFinite(amount) && amount > 0 && amount <= 1e12)) throw new Error("amount must be > 0 and <= 1e12");
  const qs = new URLSearchParams({ s: sym, side, amount: decimalString(amount) });
  return {
    url: `${appUrl.replace(/\/+$/, "")}/trade?${qs.toString()}`,
    symbol: sym,
    side,
    amount,
    amountUnit: side === "buy" ? "USDC to spend" : `${sym} tokens to sell`,
    signing:
      "Opens a prefilled ticket. The user reviews the quote and checks, then signs in their own wallet. traivo-mcp never signs or sends transactions.",
  };
}
