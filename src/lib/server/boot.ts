/**
 * Boot-time environment validation + background scheduling, called from
 * instrumentation.register(). A production container missing its critical
 * env must refuse to start — otherwise it boots, passes naive health checks,
 * and surfaces the misconfiguration as user-facing 500s on the first real
 * request.
 */
import { env } from "./env";
import { log } from "./log";
import { runSweep } from "./services/sweep";

export function assertBootEnv(): void {
  // Dev and tests intentionally run partial configs (e.g. no Clerk, console
  // email); lazy per-request errors are the better failure mode there.
  if (!env.isProd) return;

  const missing: string[] = [];
  if (!env.supabaseUrl) missing.push("SUPABASE_URL");
  if (!env.supabaseSecretKey) missing.push("SUPABASE_SECRET_KEY");
  // Without a stable salt, audit IP hashes AND durable rate-limit keys are
  // derived from a random per-process value: every restart/instance gets its
  // own buckets, silently multiplying the abuse budget. Not optional in prod.
  if (!env.ipSalt) missing.push("WISP_IP_SALT");
  if (missing.length > 0) {
    throw new Error(`Refusing to boot: missing required environment: ${missing.join(", ")}`);
  }

  log.info("boot.env_ok", {
    clerk: env.clerkEnabled,
    email: Boolean(env.resendApiKey),
    sweepEndpoint: Boolean(env.sweepSecret),
  });
}

const SWEEP_INTERVAL_MS = 5 * 60_000;
const SWEEP_BOOT_DELAY_MS = 30_000;
let sweeperStarted = false;

/**
 * In-process expiry sweeper — production only, so every deploy topology gets
 * expiry cleanup without remembering an external scheduler. POST /api/sweep
 * remains for operators who run their own cron (both are idempotent).
 */
export function startSweeper(): void {
  if (sweeperStarted || !env.isProd || !env.supabaseUrl || !env.supabaseSecretKey) return;
  sweeperStarted = true;
  const tick = () => {
    runSweep().catch((error) => log.error("sweep.failed", { error }));
  };
  setTimeout(tick, SWEEP_BOOT_DELAY_MS);
  setInterval(tick, SWEEP_INTERVAL_MS);
  log.info("sweep.scheduled", { intervalMs: SWEEP_INTERVAL_MS });
}
