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

/** Parent shares that are expired or fully exhausted (anonymous maxViews=0). */
export async function findSweepableShares(nowIso: string): Promise<
  Array<{ id: string; ciphertextRef: string }>
> {
  const { data, error } = await wispDb()
    .from("shares")
    .select("id, ciphertext_ref")
    .is("parent_share_id", null)
    // views_remaining=0 matches only exhausted ANONYMOUS shares (identity
    // shares track per-recipient counters and are reclaimed on expiry).
    .or(`expires_at.lt.${nowIso},views_remaining.eq.0`)
    .limit(500);
  if (error) throw new Error(`sweep query failed: ${error.message}`);
  return (data ?? []).map((s) => ({
    id: (s as { id: string }).id,
    ciphertextRef: (s as { ciphertext_ref: string }).ciphertext_ref,
  }));
}

export async function deleteShares(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await wispDb().from("shares").delete().in("id", ids);
  if (error) throw new Error(`sweep row delete failed: ${error.message}`);
}
