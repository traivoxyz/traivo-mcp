# traivo-mcp

A [Model Context Protocol](https://modelcontextprotocol.io) server that gives any MCP client (desktop chat apps,
code editors, your own agent) Traivo's **read-only** tools for Ethereum mainnet: tokenized stock prices (Ondo
Global Markets tokens on Uniswap V3) against the listed share price, live swap quotes against USDC, public wallet
portfolios, Hyperliquid accounts, the public Traivo AI scorecard and position sizing with Ethereum gas.

It is a thin client over the public Traivo API (`https://dapp.traivo.xyz/api/*`), so it duplicates no chain
logic and needs no keys. **It never signs or sends a transaction.** To trade, it hands back a link to Traivo's
trade ticket, prefilled, for the user to review and sign in their own wallet.

## Quick start

Requires Node.js 20 or newer. Not on npm yet, so run it from a clone:

```sh
git clone <this repo> traivo-mcp && cd traivo-mcp
pnpm install && pnpm build
node dist/cli.js --help
```

Then point your MCP client at `node /absolute/path/to/traivo-mcp/dist/cli.js` (stdio). After the npm release the
command becomes `npx -y traivo-mcp`.

### Generic MCP client config (JSON)

Most clients read an `mcpServers` map like this:

```json
{
  "mcpServers": {
    "traivo": {
      "command": "node",
      "args": ["/absolute/path/to/traivo-mcp/dist/cli.js"],
      "env": { "TRAIVO_API_URL": "https://dapp.traivo.xyz" }
    }
  }
}
```

### Desktop apps (Claude Desktop and similar)

Add the block above to the app's MCP config file (in Claude Desktop: _Settings → Developer → Edit Config_, which
opens `claude_desktop_config.json`), then restart the app. The Traivo tools appear in the tools menu.

### Editors and coding agents

- **Claude Code:** `claude mcp add traivo -- node /absolute/path/to/traivo-mcp/dist/cli.js`
- **Cursor:** add the same `mcpServers` block to `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global).
- **VS Code:** add to `.vscode/mcp.json`:

  ```json
  {
    "servers": {
      "traivo": { "type": "stdio", "command": "node", "args": ["/absolute/path/to/traivo-mcp/dist/cli.js"] }
    }
  }
  ```

### Streamable HTTP (optional)

```sh
node dist/cli.js --http --port 3333          # serves POST http://127.0.0.1:3333/mcp
```

Stateless (no sessions), replies streamed as server-sent events, `GET /health` for probes. It binds to `127.0.0.1` and has **no auth**;
put it behind your own proxy and access control before exposing it (`--host 0.0.0.0` to bind elsewhere).

## Configuration

| Variable            | Default                   | Meaning                                                            |
| ------------------- | ------------------------- | ------------------------------------------------------------------ |
| `TRAIVO_API_URL`    | `https://dapp.traivo.xyz` | Traivo API base URL (e.g. a local dapp at `http://localhost:8787`) |
| `TRAIVO_APP_URL`    | `TRAIVO_API_URL`          | Base URL used in trade links                                       |
| `TRAIVO_TIMEOUT_MS` | `15000`                   | Per-request timeout                                                |
| `TRAIVO_DEBUG`      | unset                     | `1` = log every tool call (to stderr)                              |

Logs always go to **stderr**; stdout carries only the MCP protocol (a test enforces this).

## Tools

All tools are read-only (`readOnlyHint: true`). Outputs are compact JSON (floats rounded to 6 significant digits).

| Tool                      | API                                          | What it returns                                                                                                                                                                |
| ------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `get_stock_board`         | `GET /api/stocks`                            | Ondo tokenized stocks on Ethereum: Uniswap V3 bid / ask / mid in USDC, spread, listed share price and its age, premium vs the share (bps), venue, ETH price. Filter `symbols`. |
| `get_onchain_tokens`      | `GET /api/onchain`                           | Tokens with a real Uniswap V3 route against USDC on Ethereum, route (`via`: USDC or WETH), pool fee, on-chain price. `symbol`, `priced_only`, `limit`.                         |
| `get_crypto_markets`      | `GET /api/crypto`                            | Major perp markets from Hyperliquid: mid, 24h change, volume, funding APR, open interest, max leverage. `symbols`, `limit`.                                                    |
| `get_trade_quote`         | `GET /api/quote`                             | Live quote vs USDC at the current Ethereum block: amount out, average price, impact vs a small trade, premium vs reference, impact ladder, pool fee. Gas excluded.             |
| `get_portfolio`           | `GET /api/portfolio/:address[?net=testnet]`  | Public Ethereum holdings of any address with price source and USD value, total, unpriced symbols. `network`: `mainnet` (default) or `testnet` (Sepolia).                       |
| `get_hyperliquid_account` | `GET /api/integrations/hyperliquid/:address` | Hyperliquid account value, margin, perp positions (PnL, ROE, liquidation distance), spot balances.                                                                             |
| `get_scorecard`           | `GET /api/scorecard`                         | Every Traivo AI call with entry, stop, target, block and its grade (win / loss / open), plus the summary. `status`, `symbol`, `limit`.                                         |
| `get_chain_status`        | `GET /api/chain`                             | Ethereum mainnet (chain id 1) head block, gas price, RPC latency.                                                                                                              |
| `size_position`           | — (local math)                               | Quantity from a max loss and a stop (`risk_usd`, or `account_usd` + `risk_pct`), optional costs, Ethereum gas per swap (`gas_usd`), notional cap, target → R multiple.         |
| `prepare_trade_link`      | — (local)                                    | `https://dapp.traivo.xyz/trade?s=<SYMBOL>&side=<buy\|sell>&amount=<n>` for the user to open, review and sign. Never signs.                                                     |

`amount` means **USDC to spend** for a buy and **tokens to sell** for a sell, in both `get_trade_quote` and
`prepare_trade_link`.

### Example

```text
User: Is $5,000 of tokenized NVDA expensive on-chain right now?
→ get_stock_board { "symbols": ["NVDA"] }               premium vs the share price, spread, price age
→ get_trade_quote { "symbol": "NVDA", "side": "buy", "amount": 5000 }   impact at that size
→ get_chain_status                                       gas price, to estimate gas_usd
→ size_position   { "entry": 239.4, "stop": 232.2, "risk_usd": 100, "target": 254, "gas_usd": 2 }
→ prepare_trade_link { "symbol": "NVDA", "side": "buy", "amount": 2000 }
```

## Library use

```ts
import { TraivoClient, createTraivoServer, sizePosition } from "traivo-mcp";

const server = createTraivoServer({ client: new TraivoClient({ baseUrl: "https://dapp.traivo.xyz" }) });
// connect `server` to any MCP transport
```

## How Traivo uses it

The same public API backs the Traivo app and Traivo AI's tools. This server exposes those reads to agents you
run yourself, so they can check prices, quotes and the scorecard directly instead of trusting a summary. The
scorecard tool returns misses as well as wins; see it live at <https://dapp.traivo.xyz>.

## Limitations

- **No paper trading or orders in v0.1.** Those endpoints need a signed-in wallet session (a browser cookie from
  wallet sign-in); Traivo has no API-token model yet. `paper_trade` / `get_paper_account` will come once it does.
- **No live trading, ever, from this server.** It returns a deep link; signing happens in the user's wallet.
- Quotes are a snapshot at one block. Prices move between the quote and the signature.
- Tokenized stocks trade around the clock, but the reference share price only moves while its exchange is open;
  outside US market hours a large `referenceAgeSec` is normal and the premium includes that gap. Tokens with no
  listed share (e.g. a private company) have a `null` reference.
- Quotes exclude Ethereum gas. Gas is a flat cost per swap, so on small trades it can outweigh the price impact;
  pass `gas_usd` to `size_position` to count it.
- Tokens in `get_onchain_tokens` are discovered on-chain and **not reviewed** by Traivo.
- Traivo and this server are not affiliated with the issuers of the tokenized stocks it reads.
- On-chain prices can be `null` when the upstream RPC read fails or a pool has no quote; treat `null` as unknown,
  not zero.
- The streamable HTTP mode has no authentication of its own.
- Rate limits and caching follow the public API (its answers are cached for seconds).

## Development

```sh
pnpm install
pnpm lint        # prettier --check
pnpm typecheck
pnpm test        # mocked fetch, schema validation, stdio/HTTP transport tests
pnpm build
TRAIVO_LIVE=1 pnpm test:live   # optional: read-only smoke test against the real API
```

## License

MIT © Traivo
