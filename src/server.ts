import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { TraivoApiError, TraivoClient } from "./client.js";
import { VERSION, loadConfig } from "./config.js";
import { compact } from "./format.js";
import { silentLogger, type Logger } from "./log.js";
import { SizingError } from "./sizing.js";
import { TOOLS, type ToolContext } from "./tools.js";

export type ServerOptions = {
  client?: TraivoClient;
  /** Base URL for trade deep links. Defaults to the client's base URL. */
  appUrl?: string;
  logger?: Logger;
};

const HINTS: Record<string, string> = {
  no_route:
    "No Uniswap V3 route against USDC on Ethereum for this symbol. Check get_stock_board or get_onchain_tokens for tradable symbols.",
  bad_request: "The Traivo API rejected the parameters (unknown symbol, or amount out of range).",
  bad_address: "Not a valid EVM address.",
  upstream_failed: "Traivo could not reach an upstream data source (RPC or market data). Try again shortly.",
  timeout: "The Traivo API did not answer in time. Try again shortly.",
  network_error: "Could not reach the Traivo API. Check TRAIVO_API_URL and the network.",
  not_found: "This endpoint does not exist on the configured Traivo API.",
};

export function errorResult(err: unknown): CallToolResult {
  let body: Record<string, unknown>;
  if (err instanceof TraivoApiError)
    body = { error: err.code, status: err.status, message: HINTS[err.code] ?? err.message };
  else if (err instanceof SizingError) body = { error: "invalid_input", message: err.message };
  else body = { error: "internal_error", message: err instanceof Error ? err.message : String(err) };
  return { isError: true, content: [{ type: "text", text: JSON.stringify(body) }] };
}

export function okResult(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(compact(data)) }] };
}

/** Build the `traivo` MCP server with every read-only tool registered. Transport-agnostic. */
export function createTraivoServer(opts: ServerOptions = {}): McpServer {
  const config = opts.client && opts.appUrl ? null : loadConfig();
  const client = opts.client ?? new TraivoClient({ baseUrl: config!.apiUrl, timeoutMs: config!.timeoutMs });
  const ctx: ToolContext = { client, appUrl: opts.appUrl ?? (opts.client ? client.baseUrl : config!.appUrl) };
  const log = opts.logger ?? silentLogger;

  const server = new McpServer(
    { name: "traivo", version: VERSION },
    {
      instructions:
        "Read-only Traivo tools for Ethereum mainnet: tokenized stock (Ondo Global Markets) and crypto prices against USDC, live Uniswap V3 swap quotes, public wallet portfolios, Hyperliquid accounts, Traivo AI's public scorecard and local position sizing. Nothing here signs or sends transactions; to trade, call prepare_trade_link and give the user the link to review and sign themselves.",
    },
  );

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: {
          title: tool.title,
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: tool.network,
        },
      },
      async (args: unknown) => {
        const started = Date.now();
        try {
          const data = await (tool.run as (a: unknown, c: ToolContext) => Promise<unknown>)(args, ctx);
          log("debug", `${tool.name} ok`, { ms: Date.now() - started });
          return okResult(data);
        } catch (err) {
          log("warn", `${tool.name} failed`, { error: err instanceof Error ? err.message : String(err) });
          return errorResult(err);
        }
      },
    );
  }
  return server;
}
