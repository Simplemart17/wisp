import {
  deleteShares,
  deleteStaleOtps,
  deleteStaleRateLimits,
  findSweepableShares,
} from "@/lib/server/db/maintenance";
import { removeBlobs } from "@/lib/server/db/storage";
import { env } from "@/lib/server/env";
import { errorResponse, jsonResponse } from "@/lib/server/http";
import { log } from "@/lib/server/log";
import { sha256Base64Url, tokenMatchesHash } from "@/lib/server/tokens";

export const runtime = "nodejs";

/**
 * Expiry sweeper (SPEC §8): deletes blobs + rows for expired or exhausted
 * shares — identity shares count as exhausted once every recipient link is
 * revoked or out of views. Driven by the compose `sweeper` sidecar (or any
 * cron with the bearer secret). Disabled (404) unless WISP_SWEEP_SECRET is
 * set.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    const secret = env.sweepSecret;
    const presented = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!secret || !presented || !tokenMatchesHash(presented, sha256Base64Url(secret))) {
      return jsonResponse({ error: "Not found", kind: null }, 404);
    }

    // Stale OTP codes and rate-limit windows have no blob to clean — delete directly.
    await deleteStaleOtps(new Date(Date.now() - 3600_000).toISOString());
    await deleteStaleRateLimits(new Date(Date.now() - 3600_000).toISOString());

    const stale = await findSweepableShares();
    if (stale.length > 0) {
      await removeBlobs(stale.map((s) => s.ciphertextRef));
      await deleteShares(stale.map((s) => s.id));
      log.info("sweep.reclaimed", { shares: stale.length });
    }

    return jsonResponse({ swept: stale.length });
  } catch (error) {
    return errorResponse(error);
  }
}
