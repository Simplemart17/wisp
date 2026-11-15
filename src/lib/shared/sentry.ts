/**
 * Error monitoring guard rails, shared by the browser, Node and edge SDK
 * inits so the three can't drift.
 *
 * Wisp's promise (SPEC §2–3) is that secrets never leave the browser: the
 * link key and the management token live in the URL fragment, plaintext only
 * exists in page memory. An error monitor is a third party that sees whatever
 * the SDK attaches to an event, and its defaults are the opposite of that
 * promise — full URLs (fragment included), request bodies, cookies, headers,
 * stack-frame locals. So collection is switched off at the source, and every
 * outgoing event is additionally walked and scrubbed in case an integration
 * (or a future SDK default) puts a URL somewhere new.
 */
import type { Breadcrumb, ErrorEvent } from "@sentry/nextjs";

/** Build-time-inlined public DSN; monitoring is off entirely while unset. */
export const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN || undefined;

/** Same-origin path the browser posts events to (see next.config.ts). */
export const SENTRY_TUNNEL_ROUTE = "/monitoring";

const REDACTED = "[redacted]";

// A fragment long enough to be a link key or management token (both are
// base64url, 43+ chars). Short fragments — hex colours, heading anchors —
// are left alone so stack traces and selectors stay readable.
const SECRET_FRAGMENT_RE = /#[A-Za-z0-9_\-.~=%+/]{16,}/g;
// Absolute URLs: the query can carry a signed-storage token, the fragment a key.
const ABSOLUTE_URL_RE = /\bhttps?:\/\/[^\s"'<>]+/g;

/** Drop the query string and fragment from every URL inside `text`. */
export function scrubText(text: string): string {
  return text
    .replace(ABSOLUTE_URL_RE, (url) => {
      const cut = url.search(/[?#]/);
      return cut === -1 ? url : url.slice(0, cut);
    })
    .replace(SECRET_FRAGMENT_RE, `#${REDACTED}`);
}

/** Recursively scrub every string in a JSON-like value, in place. */
function scrubDeep(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return scrubText(value);
  if (depth > 12 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = scrubDeep(value[i], depth + 1);
    return value;
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) record[key] = scrubDeep(record[key], depth + 1);
  return value;
}

export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  return scrubDeep(breadcrumb) as Breadcrumb;
}

export function scrubEvent(event: ErrorEvent): ErrorEvent {
  // Never identify the person: Wisp only ever stores salted IP hashes.
  delete event.user;
  if (event.request) {
    delete event.request.cookies;
    delete event.request.data;
    delete event.request.query_string;
    const userAgent = event.request.headers?.["User-Agent"] ?? event.request.headers?.["user-agent"];
    // The browser/OS is what makes a Web Crypto bug reproducible; nothing
    // else in the headers is worth the risk (x-management-token, cookies).
    event.request.headers = userAgent ? { "User-Agent": userAgent } : undefined;
  }
  return scrubDeep(event) as ErrorEvent;
}

/**
 * Options common to every runtime. Errors only: no tracing, no session
 * replay (a replay of the viewer would record decrypted plaintext), no logs.
 */
export const sentryBaseOptions = {
  dsn: SENTRY_DSN,
  environment: process.env.NODE_ENV,
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: { request: { allow: ["user-agent"] }, response: false },
    httpBodies: [],
    urlQueryParams: false,
    databaseQueryData: false,
    stackFrameVariables: false,
  },
  beforeSend: scrubEvent,
  beforeBreadcrumb: scrubBreadcrumb,
} satisfies {
  dsn: string | undefined;
  environment: string | undefined;
  dataCollection: import("@sentry/nextjs").BrowserOptions["dataCollection"];
  beforeSend: (event: ErrorEvent) => ErrorEvent;
  beforeBreadcrumb: (breadcrumb: Breadcrumb) => Breadcrumb;
};
