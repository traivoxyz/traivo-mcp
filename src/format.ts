/** Round every non-integer number to `digits` significant digits so tool output stays short. */
export function compact<T>(value: T, digits = 6): T {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Number.isInteger(value)) return value;
    return Number(value.toPrecision(digits)) as T;
  }
  if (Array.isArray(value)) return value.map((v) => compact(v, digits)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = compact(v, digits);
    return out as T;
  }
  return value;
}

/** Plain decimal string for a positive amount (never exponent notation), at most 12 significant digits. */
export function decimalString(amount: number): string {
  const rounded = Number(amount.toPrecision(12));
  const s = String(rounded);
  if (!/e/i.test(s)) return s;
  const decimals = Math.min(100, Math.max(0, 11 - Math.floor(Math.log10(Math.abs(rounded)))));
  return rounded
    .toFixed(decimals)
    .replace(/(\.\d*?)0+$/, "$1")
    .replace(/\.$/, "");
}
