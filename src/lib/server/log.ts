/**
 * Structured server logging. Every operational failure path routes through
 * here so production output is one greppable JSON line per event (`docker
 * logs`, or any collector reading stdout) instead of ad-hoc console strings
 * that scroll into the void. If an external error monitor (e.g. Sentry) is
 * ever added, this module is the one seam to hook it into.
 */

type Level = "info" | "warn" | "error";

function serialize(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return value;
}

function emit(level: Level, event: string, fields: Record<string, unknown>): void {
  if (process.env.NODE_ENV === "development") {
    // Dev: human-readable — pass Error values through untouched so the
    // console prints their stack, not just "Error: message".
    console[level](
      `[wisp] ${event}`,
      ...Object.entries(fields).map(([k, v]) => (v instanceof Error ? v : `${k}=${v}`)),
    );
    return;
  }
  const entry: Record<string, unknown> = { ts: new Date().toISOString(), level, event };
  for (const [key, value] of Object.entries(fields)) entry[key] = serialize(value);
  // The logger sits inside every catch-all — it must never throw itself
  // (circular values, BigInt) or it replaces the clean 500 AND loses the log.
  let line: string;
  try {
    line = JSON.stringify(entry);
  } catch {
    line = JSON.stringify({ ts: entry.ts, level, event, unserializable: true });
  }
  console[level](line);
}

export const log = {
  info: (event: string, fields: Record<string, unknown> = {}) => emit("info", event, fields),
  warn: (event: string, fields: Record<string, unknown> = {}) => emit("warn", event, fields),
  error: (event: string, fields: Record<string, unknown> = {}) => emit("error", event, fields),
};
