/**
 * Structured server logging. Every operational failure path routes through
 * here so production output is one greppable JSON line per event (`docker
 * logs`, or any collector reading stdout) instead of ad-hoc console strings
 * that scroll into the void. `setErrorReporter` is the one seam an external
 * error monitor hooks into (Sentry does, from instrumentation.ts) — this
 * module itself stays dependency-free.
 */

type Level = "info" | "warn" | "error";

type ErrorReporter = (event: string, fields: Record<string, unknown>) => void;

// Stored on globalThis, not in module scope: the instrumentation hook and the
// route handlers can be bundled separately, each with its own copy of this
// module, and the reporter registered at boot must be visible to all of them.
const REPORTER_KEY = Symbol.for("wisp.log.errorReporter");
const reporterSlot = globalThis as { [REPORTER_KEY]?: ErrorReporter };

/** Forward every `log.error` to an external monitor, in addition to stdout. */
export function setErrorReporter(reporter: ErrorReporter | undefined): void {
  reporterSlot[REPORTER_KEY] = reporter;
}

function serialize(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return value;
}

function emit(level: Level, event: string, fields: Record<string, unknown>): void {
  if (level === "error") {
    // Same rule as below: reporting must never throw out of a catch-all.
    try {
      reporterSlot[REPORTER_KEY]?.(event, fields);
    } catch {}
  }
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
