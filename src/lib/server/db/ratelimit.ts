/**
 * Durable rate-limit counter (wisp.rate_limits + consume_rate_limit RPC).
 */
import { wispDb } from "./client";

/** Atomic fixed-window consume; true = still within budget. */
export async function consumeRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
): Promise<boolean> {
  const { data, error } = await wispDb().rpc("consume_rate_limit", {
    p_key: key,
    p_max: maxRequests,
    p_window_ms: windowMs,
  });
  if (error) throw new Error(`consume_rate_limit failed: ${error.message}`);
  return data as boolean;
}
