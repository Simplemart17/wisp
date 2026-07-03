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
    const { data, error } = await db
      .from("shares")
      .select("id, ciphertext_ref")
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
