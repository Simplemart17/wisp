import type { NextConfig } from "next";

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

export default nextConfig;
