import { errorResponse, jsonResponse } from "@/lib/server/http";
import { CIPHERTEXT_BUCKET, wispDb } from "@/lib/server/supabase";
import { sha256Base64Url, tokenMatchesHash } from "@/lib/server/tokens";

export const runtime = "nodejs";

/**
 * Expiry sweeper (SPEC §8): deletes blobs + rows for expired or exhausted
 * shares. Called by pg_cron via pg_net (see the migration file) or any cron
 * with the bearer secret. Disabled entirely unless WISP_SWEEP_SECRET is set.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    const secret = process.env.WISP_SWEEP_SECRET;
    const presented = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!secret || !presented || !tokenMatchesHash(presented, sha256Base64Url(secret))) {
      return jsonResponse({ error: "Not found", kind: null }, 404);
    }

    const db = wispDb();
    // Stale OTP codes have no blob to clean — delete directly.
    await db.from("otp_codes").delete().lt("expires_at", new Date(Date.now() - 3600_000).toISOString());

    // NOTE: `policy->>maxViews.eq.0` only matches ANONYMOUS shares, whose global
    // counter reaches 0. Identity shares track views per recipient
    // (recipients.views_remaining) and never decrement the parent's policy, so
    // a fully-exhausted identity share is reclaimed on EXPIRY, not exhaustion.
    // Expiry still bounds retention; tightening this to exhaustion needs an
    // aggregate over recipients (future RPC).
    const { data, error } = await db
      .from("shares")
      .select("id, ciphertext_ref")
      .is("parent_share_id", null) // children share the parent's blob + cascade
      .or(`expires_at.lt.${new Date().toISOString()},policy->>maxViews.eq.0`)
      .limit(500);
    if (error) throw new Error(`sweep query failed: ${error.message}`);

    const stale = data ?? [];
    if (stale.length > 0) {
      const { error: blobError } = await db.storage
        .from(CIPHERTEXT_BUCKET)
        .remove(stale.map((s) => s.ciphertext_ref));
      if (blobError) console.error("[wisp] sweep blob delete failed:", blobError.message);

      const { error: rowError } = await db
        .from("shares")
        .delete()
        .in("id", stale.map((s) => s.id));
      if (rowError) throw new Error(`sweep row delete failed: ${rowError.message}`);
    }

    return jsonResponse({ swept: stale.length });
  } catch (error) {
    return errorResponse(error);
  }
}
