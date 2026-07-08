/**
 * Reports + the expiry sweeper's data access.
 */
import { wispDb } from "./client";

export async function insertReport(entry: {
  shareId: string | null;
  reason: string;
  details: string | null;
  ipHash: string;
}): Promise<void> {
  const { error } = await wispDb().from("reports").insert({
    share_id: entry.shareId,
    reason: entry.reason,
    details: entry.details,
    ip_hash: entry.ipHash,
  });
  if (error) throw new Error(`report insert failed: ${error.message}`);
}

export async function deleteStaleOtps(olderThanIso: string): Promise<void> {
  await wispDb().from("otp_codes").delete().lt("expires_at", olderThanIso);
}

/** GC for the durable rate-limit windows (largest live window is 10 min). */
export async function deleteStaleRateLimits(olderThanIso: string): Promise<void> {
  await wispDb().from("rate_limits").delete().lt("window_start", olderThanIso);
}

/**
 * Parent shares that are expired or fully exhausted — including identity
 * shares whose every recipient link is revoked or out of views (the
 * find_sweepable_shares RPC owns the predicate).
 */
export async function findSweepableShares(): Promise<
  Array<{ id: string; ciphertextRef: string }>
> {
  const { data, error } = await wispDb().rpc("find_sweepable_shares");
  if (error) throw new Error(`sweep query failed: ${error.message}`);
  return ((data ?? []) as Array<{ id: string; ciphertext_ref: string }>).map((s) => ({
    id: s.id,
    ciphertextRef: s.ciphertext_ref,
  }));
}

export async function deleteShares(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await wispDb().from("shares").delete().in("id", ids);
  if (error) throw new Error(`sweep row delete failed: ${error.message}`);
}
