import { enforceRateLimit, errorResponse, jsonResponse } from "@/lib/server/http";
import { getRecipientByLink, getShare, isExhausted, isExpired } from "@/lib/server/shares";

export const runtime = "nodejs";

/**
 * Pre-access status for the viewer's interstitial: whether the share still
 * exists, and which gates (password, identity) stand in front of it.
 * Deliberately minimal — nothing is consumed or logged here.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    enforceRateLimit(req, "status", 120, 10 * 60 * 1000);
    const { id } = await params;
    const share = await getShare(id);
    if (!share) return jsonResponse({ error: "Not found", kind: "gone" }, 404);

    let exhausted = isExhausted(share);
    if (share.policy.requireIdentity) {
      const recipient = await getRecipientByLink(id);
      if (!recipient || recipient.revoked) {
        return jsonResponse({ error: "Not found", kind: "gone" }, 404);
      }
      exhausted = recipient.views_remaining !== null && recipient.views_remaining <= 0;
    }

    return jsonResponse({
      requiresPassword: share.wrapped_cek !== null,
      requiresIdentity: share.policy.requireIdentity,
      expired: isExpired(share),
      exhausted,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
