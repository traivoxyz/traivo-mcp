export const VERSION = "0.1.0";
export const DEFAULT_API_URL = "https://dapp.traivo.xyz";

export type Config = {
  /** Base URL of the Traivo API (the dapp origin). */
  apiUrl: string;
  /** Base URL used for trade deep links. Defaults to `apiUrl`. */
  appUrl: string;
  /** Per-request timeout in milliseconds. */
  timeoutMs: number;
};

function cleanUrl(raw: string, name: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} must be an absolute http(s) URL, got "${raw}"`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`${name} must use http or https`);
  return url.origin + url.pathname.replace(/\/+$/, "");
}

/** Read configuration from environment variables. */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const apiUrl = cleanUrl(env.TRAIVO_API_URL?.trim() || DEFAULT_API_URL, "TRAIVO_API_URL");
  const appUrl = cleanUrl(env.TRAIVO_APP_URL?.trim() || apiUrl, "TRAIVO_APP_URL");
  const timeout = Number(env.TRAIVO_TIMEOUT_MS ?? 15_000);
  return { apiUrl, appUrl, timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 15_000 };
}
