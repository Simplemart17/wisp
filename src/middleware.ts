import { NextResponse, type NextRequest } from "next/server";

/**
 * CSP hardening (SPEC §10): nonce-based, no unsafe-inline scripts. Next.js
 * picks the nonce up from the `x-nonce` request header and applies it to its
 * own inline bootstrap scripts. `connect-src` stays 'self' + the Supabase
 * host, because the browser talks to Storage directly via signed URLs.
 *
 * This also makes every page dynamically rendered — acceptable here: the app
 * is tiny and every meaningful page depends on request state anyway.
 */
export function middleware(request: NextRequest): NextResponse {
  const nonce = btoa(crypto.getRandomValues(new Uint8Array(16)).join("-")).slice(0, 24);

  const supabaseOrigin = (() => {
    try {
      return new URL(process.env.SUPABASE_URL ?? "").origin;
    } catch {
      return "";
    }
  })();

  // Dev tooling (HMR, source maps) needs eval; never allowed in production.
  const devEval = process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";

  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${devEval}`,
    `style-src 'self' 'unsafe-inline'`, // styled-jsx/Tailwind inline styles
    `img-src 'self' blob: data:`,
    `font-src 'self'`,
    `connect-src 'self' ${supabaseOrigin}`.trim(),
    `worker-src 'self' blob:`, // PDF.js worker
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

export const config = {
  // API routes return JSON — CSP is for rendered pages only.
  matcher: [{ source: "/((?!api|_next/static|_next/image|favicon.ico).*)" }],
};
