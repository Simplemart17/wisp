/**
 * Boot-time environment validation, called from instrumentation.register().
 * A production container missing its critical env must refuse to start —
 * otherwise it boots, passes naive health checks, and surfaces the
 * misconfiguration as user-facing 500s on the first real request.
 */
import { env } from "./env";
import { log } from "./log";

export function assertBootEnv(): void {
  // Dev and tests intentionally run partial configs (e.g. no Clerk, console
  // email); lazy per-request errors are the better failure mode there.
  if (!env.isProd) return;

  const missing: string[] = [];
  if (!env.supabaseUrl) missing.push("SUPABASE_URL");
  if (!env.supabaseSecretKey) missing.push("SUPABASE_SECRET_KEY");
  if (missing.length > 0) {
    throw new Error(`Refusing to boot: missing required environment: ${missing.join(", ")}`);
  }

  if (!env.ipSalt) {
    log.warn("boot.no_ip_salt", {
      hint: "audit IP hashes will not correlate across restarts; set WISP_IP_SALT",
    });
  }
  if (!env.sweepSecret) {
    log.warn("boot.no_sweep_secret", {
      hint: "expiry sweeper disabled; expired blobs will accumulate — set WISP_SWEEP_SECRET",
    });
  }
  log.info("boot.env_ok", {
    clerk: env.clerkEnabled,
    email: Boolean(env.resendApiKey),
    sweeper: Boolean(env.sweepSecret),
  });
}
