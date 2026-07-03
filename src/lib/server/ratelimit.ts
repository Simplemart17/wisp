/**
 * In-memory sliding-window rate limiter (SPEC §10).
 *
 * Suitable for a single Node process (dev, self-host, single Vercel region
 * with low traffic). On multi-instance serverless this under-counts — swap
 * for a durable store (e.g. Upstash/Redis or a Postgres counter) before real
 * production traffic. Kept behind this one function so that swap is local.
 */
const buckets = new Map<string, number[]>();
const MAX_BUCKETS = 10_000;
const EVICT_BATCH = 1_000;

export function rateLimit(key: string, maxRequests: number, windowMs: number): boolean {
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
