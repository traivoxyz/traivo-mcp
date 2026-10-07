import type { Side } from "./types.js";

export type SizeInput = {
  entry: number;
  stop: number;
  /** Max loss in USD if the stop is hit. Either this or `accountUsd` + `riskPct`. */
  riskUsd?: number;
  accountUsd?: number;
  /** Percent of `accountUsd` to risk, e.g. 1 = 1%. */
  riskPct?: number;
  target?: number;
  /** Optional; inferred from the stop (stop below entry = buy/long). Must agree with the stop if given. */
  side?: Side;
  /** Fees + slippage per side in basis points, charged on entry and exit notional. Default 0. */
  costBps?: number;
  /** Flat Ethereum gas cost per swap in USD, paid on entry and again on exit. Default 0 (not included). */
  gasUsd?: number;
  /** Cap on position notional in USD (e.g. available balance). */
  maxNotionalUsd?: number;
};

export type SizeResult = {
  side: Side;
  entry: number;
  stop: number;
  target: number | null;
  riskBudgetUsd: number;
  riskPerUnit: number;
  stopDistancePct: number;
  quantity: number;
  notionalUsd: number;
  /** Loss at the stop for `quantity`, including costs and gas. Below the budget only when capped. */
  riskUsd: number;
  /** Gas counted for the round trip (entry + exit swaps), in USD. */
  gasUsd: number;
  capped: boolean;
  rMultiple: number | null;
  rewardUsd: number | null;
  targetDistancePct: number | null;
  notes: string[];
};

export class SizingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SizingError";
  }
}

const positive = (n: number | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

/**
 * Size a position from a max loss and a stop: quantity = risk budget / loss per unit at the stop.
 * Same rule as the sizing panel on Traivo's trade page, plus optional costs, Ethereum gas, a notional cap and the
 * R multiple. Gas is flat per swap, so it comes off the budget before sizing and off the reward after.
 * Pure function: no network, no state.
 */
export function sizePosition(input: SizeInput): SizeResult {
  const { entry, stop, target } = input;
  if (!positive(entry)) throw new SizingError("entry must be a positive price");
  if (!positive(stop)) throw new SizingError("stop must be a positive price");
  if (stop === entry) throw new SizingError("stop must differ from entry");
  const side: Side = stop < entry ? "buy" : "sell";
  if (input.side && input.side !== side)
    throw new SizingError(`a ${input.side} needs its stop ${input.side === "buy" ? "below" : "above"} the entry`);

  let budget: number;
  if (input.riskUsd !== undefined) {
    if (!positive(input.riskUsd)) throw new SizingError("risk_usd must be positive");
    budget = input.riskUsd;
  } else if (input.accountUsd !== undefined || input.riskPct !== undefined) {
    if (!positive(input.accountUsd)) throw new SizingError("account_usd must be positive");
    if (!positive(input.riskPct) || input.riskPct > 100) throw new SizingError("risk_pct must be in (0, 100]");
    budget = (input.accountUsd * input.riskPct) / 100;
  } else {
    throw new SizingError("give risk_usd, or account_usd with risk_pct");
  }

  const costBps = input.costBps ?? 0;
  if (!(costBps >= 0 && costBps < 10_000)) throw new SizingError("cost_bps must be in [0, 10000)");
  const cost = costBps / 10_000;
  const riskPerUnit = Math.abs(entry - stop) + (entry + stop) * cost;

  const gasPerSwap = input.gasUsd ?? 0;
  if (!(Number.isFinite(gasPerSwap) && gasPerSwap >= 0)) throw new SizingError("gas_usd must be zero or positive");
  const gas = gasPerSwap * 2;
  if (gas >= budget)
    throw new SizingError(
      `gas for entry + exit ($${gas}) uses the whole risk budget ($${budget}); raise the budget or skip this trade`,
    );

  let quantity = (budget - gas) / riskPerUnit;
  let capped = false;
  const notes: string[] = [];
  if (input.maxNotionalUsd !== undefined) {
    if (!positive(input.maxNotionalUsd)) throw new SizingError("max_notional_usd must be positive");
    if (quantity * entry > input.maxNotionalUsd) {
      quantity = input.maxNotionalUsd / entry;
      capped = true;
      notes.push("Size capped by max_notional_usd; the loss at the stop is below the risk budget.");
    }
  }

  let rMultiple: number | null = null;
  let rewardUsd: number | null = null;
  let targetDistancePct: number | null = null;
  if (target !== undefined) {
    if (!positive(target)) throw new SizingError("target must be a positive price");
    const rewardPerUnit = (side === "buy" ? target - entry : entry - target) - (entry + target) * cost;
    rewardUsd = rewardPerUnit * quantity - gas;
    rMultiple = rewardUsd / (quantity * riskPerUnit + gas);
    targetDistancePct = (Math.abs(target - entry) / entry) * 100;
    if ((side === "buy" && target <= entry) || (side === "sell" && target >= entry))
      notes.push("Target is on the wrong side of the entry for this direction.");
    else if (rMultiple < 1) notes.push("Reward is smaller than the risk (R < 1).");
  }
  if (side === "sell")
    notes.push("Sell side: on Ethereum spot (Uniswap) this means selling tokens you hold, not a leveraged short.");
  if (gas > 0)
    notes.push(
      `Includes $${gasPerSwap} of Ethereum gas per swap ($${gas} for entry + exit) in the risk and the reward.`,
    );
  else
    notes.push(
      "Ethereum gas is not included: each swap pays a flat gas fee in ETH whatever the size, which matters on small trades. Pass gas_usd to count it.",
    );

  return {
    side,
    entry,
    stop,
    target: target ?? null,
    riskBudgetUsd: budget,
    riskPerUnit,
    stopDistancePct: (Math.abs(entry - stop) / entry) * 100,
    quantity,
    notionalUsd: quantity * entry,
    riskUsd: quantity * riskPerUnit + gas,
    gasUsd: gas,
    capped,
    rMultiple,
    rewardUsd,
    targetDistancePct,
    notes,
  };
}
