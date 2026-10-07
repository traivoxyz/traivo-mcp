import { describe, expect, it } from "vitest";
import { tradeLink } from "../src/links.js";
import { compact, decimalString } from "../src/format.js";

describe("tradeLink", () => {
  it("uses the dapp's query parameters (s, side, amount)", () => {
    const l = tradeLink("https://dapp.traivo.xyz/", "tsla", "sell", 1.5);
    expect(l.url).toBe("https://dapp.traivo.xyz/trade?s=TSLA&side=sell&amount=1.5");
    expect(l.symbol).toBe("TSLA");
  });

  it("rejects bad symbols and amounts", () => {
    expect(() => tradeLink("https://x.test", "NV DA", "buy", 1)).toThrow();
    expect(() => tradeLink("https://x.test", "NVDA", "buy", 0)).toThrow();
    expect(() => tradeLink("https://x.test", "NVDA", "buy", Number.POSITIVE_INFINITY)).toThrow();
  });
});

describe("decimalString", () => {
  it.each([
    [250, "250"],
    [0.1 + 0.2, "0.3"],
    [0.00000042, "0.00000042"],
    [1e-9, "0.000000001"],
    [123456789.123, "123456789.123"],
    [1e12, "1000000000000"],
  ])("%d -> %s", (n, s) => {
    expect(decimalString(n)).toBe(s);
  });
});

describe("compact", () => {
  it("rounds floats, keeps integers, nulls and strings, drops undefined", () => {
    expect(compact({ a: 1.23456789, b: 42, c: null, d: "x", e: undefined, f: [0.000123456789] })).toEqual({
      a: 1.23457,
      b: 42,
      c: null,
      d: "x",
      f: [0.000123457],
    });
  });
});
