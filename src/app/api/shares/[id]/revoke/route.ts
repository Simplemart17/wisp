import { deleteShare, revokeRecipient } from "@/lib/server/db/shares";
import { removeBlobsStrict } from "@/lib/server/db/storage";
import { enforceRateLimit, errorResponse, jsonResponse, readJsonBody } from "@/lib/server/http";
import { getManageableParent, requireManagementAccess } from "@/lib/server/shares";

export const runtime = "nodejs";

/**
 * Revoke (SPEC §8), management-gated. Whole share: hard-delete the blob + all
 * rows (children + audit cascade). One recipient (body.linkId): revoke that
 * link and delete its child row; the shared blob stays.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    await enforceRateLimit(req, "revoke", 10, 60 * 1000);

    const share = await getManageableParent(id);
    await requireManagementAccess(req, share);

    const body = await readJsonBody(req).catch(() => ({}) as Record<string, unknown>);

    if (typeof body.linkId === "string") {
      const revoked = await revokeRecipient(id, body.linkId);
      if (revoked.length === 0) {
        return jsonResponse({ error: "No such recipient link", kind: "gone" }, 404);
      }
      await deleteShare(body.linkId);
      return jsonResponse({ ok: true, scope: "recipient" });
    }

    await removeBlobsStrict([share.ciphertextRef]);
    await deleteShare(id);
    return jsonResponse({ ok: true, scope: "share" });
  } catch (error) {
    return errorResponse(error);
  }
}
