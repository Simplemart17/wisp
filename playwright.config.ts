import { defineConfig, devices } from "@playwright/test";

/**
 * E2E against the real stack: `pnpm dev` + the local Supabase from
 * `supabase start` (the /api/health gate below fails fast if it isn't up).
 * WebCrypto needs a secure context, which localhost provides.
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  // Shares are stateful rows in a shared database — keep runs serial so
  // burn-after-read assertions can't race a parallel worker.
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  // Same flows at both form factors. The phone project (touch, 412px) covers
  // the recipient-ledger cards via the identity-share test and actionability
  // at phone width; dashboard cards need a Clerk session and stay uncovered.
  // Pixel 7 rather than an iPhone profile because only Chromium is installed
  // — which also means iOS-Safari-only behavior (focus auto-zoom) is beyond
  // any test here.
  projects: [
    { name: "desktop" },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "pnpm dev",
    // Health round-trips to the database, so this also gates on Supabase.
    url: "http://localhost:3000/api/health",
    reuseExistingServer: true,
    timeout: 90_000,
  },
});
