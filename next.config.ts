import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";

import { SENTRY_DSN, SENTRY_TUNNEL_ROUTE } from "./src/lib/shared/sentry";

const nextConfig: NextConfig = {
  reactCompiler: true,
  output: "standalone", // self-host packaging (Dockerfile)
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Fragment hygiene (SPEC §3): the #link-key must never leak via Referer.
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          // Browsers ignore HSTS on plain http, so this is safe for local
          // dev and intranet self-hosts while protecting every TLS deploy.
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          // allow-popups (not same-origin): Clerk's OAuth flows open popups
          // that must keep their opener to complete sign-in.
          { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
          },
        ],
      },
    ];
  },
};

// Error monitoring is opt-in (self-hosts run without it): the build is only
// touched when a DSN is configured. Source maps are uploaded when the build
// also has SENTRY_AUTH_TOKEN (+ SENTRY_ORG / SENTRY_PROJECT); without the
// token none are generated, so they can never end up publicly served.
export default SENTRY_DSN
  ? withSentryConfig(nextConfig, {
      authToken: process.env.SENTRY_AUTH_TOKEN,
      sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
      // Browser events go to our own origin and are relayed by
      // src/app/sentry-tunnel/route.ts, keeping the CSP's connect-src tight.
      tunnelRoute: SENTRY_TUNNEL_ROUTE,
      silent: !process.env.CI,
      telemetry: false,
    })
  : nextConfig;
