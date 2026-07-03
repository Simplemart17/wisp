import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Two jobs, one middleware:
 *
 * 1. CSP hardening (SPEC §10) for rendered pages — nonce-based, no
 *    unsafe-inline scripts. Next.js picks the nonce up from the `x-nonce`
 *    request header. API routes are passed through untouched (JSON).
 * 2. Clerk session context (SPEC §5b) — active only when Clerk keys are
 *    configured; self-hosts without Clerk run management-token-only and this
 *    degrades to the plain CSP middleware.
 */

const CLERK_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

/** `pk_test_<base64 of "slug.clerk.accounts.dev$">` → that frontend origin. */
function clerkFrontendOrigin(): string {
  if (!CLERK_PUBLISHABLE_KEY) return "";
  try {
    const encoded = CLERK_PUBLISHABLE_KEY.split("_")[2];
    return `https://${atob(encoded).replace(/\$$/, "")}`;
  } catch {
    return "";
  }
}

function applyCsp(request: NextRequest): NextResponse {
  if (request.nextUrl.pathname.startsWith("/api")) {
    return NextResponse.next();
  }

  const nonce = btoa(crypto.getRandomValues(new Uint8Array(16)).join("-")).slice(0, 24);

  const supabaseOrigin = (() => {
    try {
      return new URL(process.env.SUPABASE_URL ?? "").origin;
    } catch {
      return "";
    }
  })();
  const clerkOrigin = clerkFrontendOrigin();

  // Dev tooling (HMR, source maps) needs eval; never allowed in production.
  const devEval = process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";

  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${devEval} ${clerkOrigin}`.trimEnd(),
    `style-src 'self' 'unsafe-inline'`, // styled-jsx/Tailwind inline styles
    `img-src 'self' blob: data:${clerkOrigin ? " https://img.clerk.com" : ""}`,
    `font-src 'self'`,
    `connect-src 'self' ${supabaseOrigin} ${clerkOrigin}`.replace(/\s+/g, " ").trimEnd(),
    `worker-src 'self' blob:`, // PDF.js worker
    `frame-src ${clerkOrigin ? "https://challenges.cloudflare.com" : "'none'"}`, // Clerk bot protection
    `frame-ancestors 'none'`,
    `form-action 'self'`,
    `base-uri 'self'`,
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export default CLERK_PUBLISHABLE_KEY
  ? clerkMiddleware((_auth, request) => applyCsp(request))
  : applyCsp;

export const config = {
  // Includes /api so Clerk's auth() works in Route Handlers; applyCsp skips
  // setting CSP on those responses itself.
  matcher: [{ source: "/((?!_next/static|_next/image|favicon.ico).*)" }],
};
