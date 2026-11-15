/**
 * Next.js instrumentation hook — runs once when the server starts, before any
 * request is served. Starts error monitoring (when a DSN is configured) and
 * fails the boot on missing critical env (see boot.ts).
 */
import * as Sentry from "@sentry/nextjs";

import { setErrorReporter } from "./lib/server/log";
import { SENTRY_DSN, sentryBaseOptions } from "./lib/shared/sentry";

/** Don't let one failure repeating on a timer (health probe, sweeper) eat the quota. */
const REPORT_COOLDOWN_MS = 60_000;
const lastReported = new Map<string, number>();

function reportLoggedError(event: string, fields: Record<string, unknown>): void {
  const cause = Object.values(fields).find((value) => value instanceof Error);
  const key = `${event}:${cause?.message ?? ""}`;
  const now = Date.now();
  if (now - (lastReported.get(key) ?? 0) < REPORT_COOLDOWN_MS) return;
  if (lastReported.size > 500) lastReported.clear();
  lastReported.set(key, now);

  Sentry.withScope((scope) => {
    scope.setTag("log_event", event);
    scope.setContext(
      "log",
      Object.fromEntries(Object.entries(fields).filter(([, value]) => !(value instanceof Error))),
    );
    if (cause) {
      Sentry.captureException(cause);
    } else {
      scope.setFingerprint([event]);
      Sentry.captureMessage(event, "error");
    }
  });
}

export async function register(): Promise<void> {
  if (SENTRY_DSN) {
    Sentry.init(sentryBaseOptions);
    // Route handlers catch their own errors and answer with an opaque 500
    // (http.ts), so the logger is where server failures actually surface.
    setErrorReporter(reportLoggedError);
  }

  // The middleware bundle registers under the edge runtime too; env
  // validation only makes sense in the real Node server process.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertBootEnv, startSweeper } = await import("./lib/server/boot");
  assertBootEnv();
  startSweeper();
}

/** Errors Next.js catches itself: Server Components, middleware. */
export const onRequestError = Sentry.captureRequestError;
