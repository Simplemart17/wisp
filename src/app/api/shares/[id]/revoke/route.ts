import { ApiError, clientIp, errorResponse, jsonResponse, readJsonBody } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/ratelimit";
import { getShare, requireManagementToken } from "@/lib/server/shares";
import { CIPHERTEXT_BUCKET, wispDb } from "@/lib/server/supabase";

export const runtime = "nodejs";

/**
 * Revoke (SPEC §8), management-token-gated. Two scopes:
 * - Whole share: hard-delete the blob and every row (children + audit cascade).
 * - One recipient (body.linkId, identity shares): kill that link only — mark
 *   the recipient revoked and delete their child row; the shared blob stays.
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
    if (!share || share.parent_share_id !== null) {
      // Child ids are not directly manageable — the parent's manage link is.
      return jsonResponse({ error: "Not found", kind: "gone" }, 404);
    }
    requireManagementToken(req, share);

    const body = await readJsonBody(req).catch(() => ({}) as Record<string, unknown>);
    const db = wispDb();

    if (typeof body.linkId === "string") {
      const { data, error } = await db
        .from("recipients")
        .update({ revoked: true })
        .eq("share_id", id)
        .eq("link_id", body.linkId)
        .select("link_id");
      if (error) throw new Error(`recipient revoke failed: ${error.message}`);
      if ((data ?? []).length === 0) {
        return jsonResponse({ error: "No such recipient link", kind: "gone" }, 404);
      }
      const { error: childError } = await db.from("shares").delete().eq("id", body.linkId);
      if (childError) throw new Error(`child delete failed: ${childError.message}`);
      return jsonResponse({ ok: true, scope: "recipient" });
    }

    const { error: blobError } = await db.storage
      .from(CIPHERTEXT_BUCKET)
      .remove([share.ciphertext_ref]);
    if (blobError) throw new Error(`blob delete failed: ${blobError.message}`);

    const { error: rowError } = await db.from("shares").delete().eq("id", id);
    if (rowError) throw new Error(`share delete failed: ${rowError.message}`);

    return jsonResponse({ ok: true, scope: "share" });
  } catch (error) {
    return errorResponse(error);
  }
}
