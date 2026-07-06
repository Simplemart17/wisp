/**
 * Rate limiting (SPEC §10), kept behind this one function.
 *
 * Primary path: a durable fixed-window counter in Postgres (one atomic RPC
 * per checked request), so limits survive container restarts and hold across
 * multiple instances. Keys are salted-hashed before they leave the process —
 * raw client IPs never reach the database, same policy as the audit log.
 *
 * Fallback: the original in-memory sliding window, used only when Supabase
 * isn't configured (unit tests, offline dev) — never in production, where
 * boot validation guarantees the database env exists.
 */
import { consumeRateLimit } from "./db/ratelimit";
import { env } from "./env";
import { hashIp } from "./tokens";

export async function rateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
): Promise<boolean> {
  if (!env.supabaseUrl || !env.supabaseSecretKey) {
    return rateLimitMemory(key, maxRequests, windowMs);
  }
  // A failed RPC throws through to the route's uniform 500 — with the
  // database down every subsequent query fails anyway, so there is no
  // fail-open window to exploit.
  return consumeRateLimit(hashIp(key), maxRequests, windowMs);
}

// ── In-memory fallback (single process only) ────────────────────────────────

const buckets = new Map<string, number[]>();
const MAX_BUCKETS = 10_000;
const EVICT_BATCH = 1_000;

export function rateLimitMemory(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();
  // Bound memory by evicting the OLDEST-inserted keys, not clearing everything
  // — a full clear would let an attacker flush all live limits by spraying
  // unique keys. Map preserves insertion order, so the first entries are oldest.
  if (buckets.size > MAX_BUCKETS) {
    let evicted = 0;
    for (const k of buckets.keys()) {
      buckets.delete(k);
      if (++evicted >= EVICT_BATCH) break;
    }
  }

  const cutoff = now - windowMs;
  const recent = (buckets.get(key) ?? []).filter((ts) => ts > cutoff);
  if (recent.length >= maxRequests) {
    buckets.set(key, recent);
    return false;
  }
  recent.push(now);
  buckets.set(key, recent);
  return true;
}
