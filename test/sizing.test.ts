import { describe, expect, it } from "vitest";
import { SizingError, sizePosition } from "../src/sizing.js";

describe("sizePosition", () => {
  it("matches Traivo's trade page: max loss / |entry - stop|", () => {
    // $50 max loss, 3% stop on a $240 entry
    const entry = 240;
    const stop = entry * 0.97;
    const r = sizePosition({ entry, stop, riskUsd: 50 });
    expect(r.side).toBe("buy");
    expect(r.quantity).toBeCloseTo(50 / (entry - stop), 10);
    expect(r.riskUsd).toBeCloseTo(50, 10);
    expect(r.stopDistancePct).toBeCloseTo(3, 10);
  });

  it("sizes from account and percent", () => {
    const r = sizePosition({ entry: 50, stop: 48, accountUsd: 10_000, riskPct: 1 });
    expect(r.riskBudgetUsd).toBe(100);
    expect(r.quantity).toBe(50);
    expect(r.notionalUsd).toBe(2500);
  });

  it("infers sell when the stop is above entry and computes R", () => {
    const r = sizePosition({ entry: 100, stop: 104, target: 88, riskUsd: 40 });
    expect(r.side).toBe("sell");
    expect(r.quantity).toBe(10);
    expect(r.rMultiple).toBe(3);
    expect(r.rewardUsd).toBe(120);
    expect(r.notes.join(" ")).toMatch(/selling tokens you hold/);
    expect(r.notes.join(" ")).toMatch(/Ethereum/);
  });

  it("takes flat Ethereum gas off the budget and off the reward", () => {
    // $100 budget, $10 gas per swap -> $80 left for the stop distance
    const r = sizePosition({ entry: 100, stop: 90, target: 130, riskUsd: 100, gasUsd: 10 });
    expect(r.gasUsd).toBe(20);
    expect(r.quantity).toBe(8);
    expect(r.riskUsd).toBe(100);
    // reward 8 * 30 - 20 = 220; R = 220 / 100
    expect(r.rewardUsd).toBe(220);
    expect(r.rMultiple).toBeCloseTo(2.2, 10);
    expect(r.notes.join(" ")).toMatch(/\$10 of Ethereum gas per swap \(\$20 for entry \+ exit\)/);
  });

  it("refuses when gas alone uses the risk budget", () => {
    expect(() => sizePosition({ entry: 100, stop: 90, riskUsd: 10, gasUsd: 5 })).toThrow(/gas for entry \+ exit/);
  });

  it("says when gas is not counted", () => {
    expect(sizePosition({ entry: 100, stop: 90, riskUsd: 10 }).notes.join(" ")).toMatch(/gas_usd/);
  });

  it("includes per-side costs in the risk per unit and in R", () => {
    const r = sizePosition({ entry: 100, stop: 90, target: 120, riskUsd: 100, costBps: 50 });
    // 10 + (100 + 90) * 0.005 = 10.95
    expect(r.riskPerUnit).toBeCloseTo(10.95, 10);
    expect(r.quantity).toBeCloseTo(100 / 10.95, 10);
    // (20 - 220 * 0.005) / 10.95
    expect(r.rMultiple).toBeCloseTo(18.9 / 10.95, 10);
  });

  it("caps notional and says so", () => {
    const r = sizePosition({ entry: 10, stop: 9.9, riskUsd: 100, maxNotionalUsd: 500 });
    expect(r.capped).toBe(true);
    expect(r.quantity).toBe(50);
    expect(r.riskUsd).toBeCloseTo(5, 10);
    expect(r.notes[0]).toMatch(/capped/);
  });

  it("flags poor or wrong-side targets", () => {
    expect(sizePosition({ entry: 100, stop: 90, target: 105, riskUsd: 10 }).notes.join()).toMatch(/R < 1/);
    const wrong = sizePosition({ entry: 100, stop: 90, target: 95, riskUsd: 10 });
    expect(wrong.rMultiple).toBeLessThan(0);
    expect(wrong.notes.join()).toMatch(/wrong side/);
  });

  it.each([
    [{ entry: 100, stop: 100, riskUsd: 1 }, /differ/],
    [{ entry: 100, stop: 90 }, /risk_usd/],
    [{ entry: 100, stop: 90, accountUsd: 1000 }, /risk_pct/],
    [{ entry: 100, stop: 90, riskUsd: 1, side: "sell" as const }, /above/],
    [{ entry: 100, stop: 110, riskUsd: 1, side: "buy" as const }, /below/],
    [{ entry: 100, stop: 90, riskUsd: 1, costBps: 10_000 }, /cost_bps/],
    [{ entry: Number.NaN, stop: 90, riskUsd: 1 }, /entry/],
    [{ entry: 100, stop: 90, riskUsd: 1, gasUsd: -1 }, /gas_usd/],
  ])("rejects %j", (input, msg) => {
    expect(() => sizePosition(input)).toThrow(SizingError);
    expect(() => sizePosition(input)).toThrow(msg);
  });
});
