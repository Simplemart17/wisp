/**
 * Single, typed surface for every environment variable the server reads, so
 * the raw `process.env.X` strings live in exactly one place and misconfig is
 * caught here rather than deep in a handler. Getters read lazily so tests and
 * dev can change the environment between calls.
 *
 * NEXT_PUBLIC_* values are build-time-inlined public config; they are only
 * read here from server/edge code (middleware, layout), never client bundles.
 */
export const env = {
  get supabaseUrl(): string | undefined {
    return process.env.SUPABASE_URL || undefined;
  },
  get supabaseSecretKey(): string | undefined {
    return process.env.SUPABASE_SECRET_KEY || undefined;
  },
  /** Salt for hashed audit IPs; undefined → a random per-process fallback. */
  get ipSalt(): string | undefined {
    return process.env.WISP_IP_SALT || undefined;
  },
  /** Trusted reverse-proxy count for spoof-resistant client IP (default 1). */
  get trustedProxyDepth(): number {
    const n = Number.parseInt(process.env.WISP_TRUSTED_PROXY_DEPTH ?? "1", 10);
    return Number.isInteger(n) ? n : 1;
  },
  /** Bearer secret that enables POST /api/sweep; undefined → endpoint 404s. */
  get sweepSecret(): string | undefined {
    return process.env.WISP_SWEEP_SECRET || undefined;
  },
  get resendApiKey(): string | undefined {
    return process.env.RESEND_API_KEY || undefined;
  },
  get emailFrom(): string {
    return process.env.WISP_EMAIL_FROM ?? "Wisp <onboarding@resend.dev>";
  },
  get clerkPublishableKey(): string | undefined {
    return process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || undefined;
  },
  get clerkSecretKey(): string | undefined {
    return process.env.CLERK_SECRET_KEY || undefined;
  },
  /** Sender accounts (SPEC §5b) are active only when BOTH Clerk keys are set. */
  get clerkEnabled(): boolean {
    return Boolean(this.clerkPublishableKey && this.clerkSecretKey);
  },
  get isDev(): boolean {
    return process.env.NODE_ENV === "development";
  },
  get isProd(): boolean {
    return process.env.NODE_ENV === "production";
  },
};

/** Supabase URL + secret key, throwing a clear error if either is missing. */
export function requireSupabase(): { url: string; secretKey: string } {
  const { supabaseUrl, supabaseSecretKey } = env;
  if (!supabaseUrl || !supabaseSecretKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY must be set");
  }
  return { url: supabaseUrl, secretKey: supabaseSecretKey };
}
