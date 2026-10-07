/**
 * Logging goes to stderr only. stdout carries the MCP protocol on the stdio transport,
 * so a single stray `console.log` would corrupt the stream.
 */
export type Logger = (
  level: "debug" | "info" | "warn" | "error",
  message: string,
  extra?: Record<string, unknown>,
) => void;

export function stderrLogger(opts: { debug?: boolean } = {}): Logger {
  return (level, message, extra) => {
    if (level === "debug" && !opts.debug) return;
    const line = extra ? `${message} ${JSON.stringify(extra)}` : message;
    process.stderr.write(`[traivo-mcp] ${level}: ${line}\n`);
  };
}

export const silentLogger: Logger = () => {};
