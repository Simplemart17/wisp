/**
 * Same-origin relay for browser error reports (rewritten here from
 * SENTRY_TUNNEL_ROUTE by withSentryConfig). Two reasons it exists instead of
 * the browser posting to Sentry directly: the CSP keeps `connect-src` free of
 * a third-party origin, and Sentry never learns who the visitor is.
 *
 * The SDK's relay would otherwise pass the client IP along (it reads the
 * headers below and sends them on as X-Sentry-Forwarded-For), so they are
 * removed first — Wisp only ever keeps salted IP hashes, and that holds for
 * its error monitor too. Rejects everything while no DSN is configured.
 */
import { POST as relay } from "@sentry/nextjs/tunnel";

const IDENTIFYING_HEADERS = [
  "cf-connecting-ip",
  "x-vercel-forwarded-for",
  "x-forwarded-for",
  "x-real-ip",
  "referer",
  "cookie",
];

export function POST(request: Request): Promise<Response> {
  const headers = new Headers(request.headers);
  for (const name of IDENTIFYING_HEADERS) headers.delete(name);
  // Rebuilt from parts: the framework's request object can't be passed to the
  // Request constructor as-is, and a streamed body needs `duplex`.
  const init: RequestInit & { duplex: "half" } = {
    method: "POST",
    headers,
    body: request.body,
    duplex: "half",
  };
  return relay(new Request(request.url, init));
}
