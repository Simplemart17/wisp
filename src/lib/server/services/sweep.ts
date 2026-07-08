/**
 * Expiry sweeper (SPEC §8): deletes blobs + rows for expired or exhausted
 * shares, plus stale OTP codes and rate-limit windows. Runs in-process on a
 * production timer (see boot.ts) so every topology — compose, plain
 * `docker run`, bare `next start` — honors the "expiry bounds reachability"
 * promise without an external scheduler; POST /api/sweep stays available for
 * operators who prefer their own cron. Concurrent passes are safe: deletes
 * are idempotent and blob removal is best-effort.
 */
import {
  deleteShares,
  deleteStaleOtps,
  deleteStaleRateLimits,
  findSweepableShares,
} from "../db/maintenance";
import { removeBlobs } from "../db/storage";
import { log } from "../log";

const STALE_CUTOFF_MS = 3600_000; // OTPs live 10 min, rate windows ≤10 min

/** One sweep pass; returns how many shares were reclaimed. */
export async function runSweep(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_CUTOFF_MS).toISOString();
  await deleteStaleOtps(cutoff);
  await deleteStaleRateLimits(cutoff);

  const stale = await findSweepableShares();
  if (stale.length > 0) {
    await removeBlobs(stale.map((s) => s.ciphertextRef));
    await deleteShares(stale.map((s) => s.id));
    log.info("sweep.reclaimed", { shares: stale.length });
  }
  return stale.length;
}
