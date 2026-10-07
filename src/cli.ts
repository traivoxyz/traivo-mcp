#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { TraivoClient } from "./client.js";
import { VERSION, loadConfig } from "./config.js";
import { startHttpServer } from "./http.js";
import { stderrLogger } from "./log.js";
import { createTraivoServer } from "./server.js";

const HELP = `traivo-mcp ${VERSION} — MCP server for Traivo (read-only)

Usage:
  traivo-mcp                 stdio transport (default; for desktop apps and editors)
  traivo-mcp --http [--port 3333] [--host 127.0.0.1]
                             stateless streamable HTTP on /mcp
  traivo-mcp --help | --version

Environment:
  TRAIVO_API_URL     API base URL (default https://dapp.traivo.xyz)
  TRAIVO_APP_URL     base URL for trade deep links (default TRAIVO_API_URL)
  TRAIVO_TIMEOUT_MS  per-request timeout (default 15000)
  TRAIVO_DEBUG=1     verbose logs (stderr only)
`;

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  // Help/version go to stderr too: stdout belongs to the protocol.
  if (args.includes("--help") || args.includes("-h")) return void process.stderr.write(HELP);
  if (args.includes("--version") || args.includes("-v")) return void process.stderr.write(`${VERSION}\n`);

  const logger = stderrLogger({ debug: process.env.TRAIVO_DEBUG === "1" });
  const config = loadConfig();
  const client = new TraivoClient({ baseUrl: config.apiUrl, timeoutMs: config.timeoutMs });
  const opts = { client, appUrl: config.appUrl, logger };

  if (args.includes("--http")) {
    const port = Number(flag(args, "--port") ?? process.env.PORT ?? 3333);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error("--port must be 1-65535");
    await startHttpServer({ ...opts, port, host: flag(args, "--host") });
    return;
  }

  const server = createTraivoServer(opts);
  await server.connect(new StdioServerTransport());
  logger("info", `ready on stdio (api ${config.apiUrl})`);
}

main().catch((err) => {
  process.stderr.write(`[traivo-mcp] fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
