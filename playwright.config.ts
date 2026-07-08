import { defineConfig } from "@playwright/test";

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
  webServer: {
    command: "pnpm dev",
    // Health round-trips to the database, so this also gates on Supabase.
    url: "http://localhost:3000/api/health",
    reuseExistingServer: true,
    timeout: 90_000,
  },
});
