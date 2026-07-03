import { ApiError, clientIp, errorResponse, jsonResponse } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/ratelimit";
import { getShare, requireManagementToken } from "@/lib/server/shares";
import { CIPHERTEXT_BUCKET, wispDb } from "@/lib/server/supabase";

export const runtime = "nodejs";

/**
 * Revoke (SPEC §8): management-token-gated hard delete of the blob and all
 * rows (access_log cascades). After this the ciphertext is unreachable even
 * for holders of a valid link + password.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    if (!rateLimit(`revoke:${clientIp(req)}`, 10, 60 * 1000)) {
      throw new ApiError(429, "Too many attempts, slow down");
    }

    const share = await getShare(id);
    if (!share) return jsonResponse({ error: "Not found", kind: "gone" }, 404);
    requireManagementToken(req, share);

    const db = wispDb();
    const { error: blobError } = await db.storage
      .from(CIPHERTEXT_BUCKET)
      .remove([share.ciphertext_ref]);
    if (blobError) throw new Error(`blob delete failed: ${blobError.message}`);

    const { error: rowError } = await db.from("shares").delete().eq("id", id);
    if (rowError) throw new Error(`share delete failed: ${rowError.message}`);

    return jsonResponse({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
