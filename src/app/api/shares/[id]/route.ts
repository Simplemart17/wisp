import { enforceRateLimit, errorResponse, jsonResponse } from "@/lib/server/http";
import { getRecipientByLink, getShare, isExhausted, isExpired } from "@/lib/server/shares";
import type { ShareStatusDto } from "@/lib/shared/api";

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
    await enforceRateLimit(req, "status", 120, 10 * 60 * 1000);
    const { id } = await params;
    const share = await getShare(id);
    if (!share) return jsonResponse({ error: "Not found", kind: "gone" }, 404);

    let exhausted = isExhausted(share);
    let hasViewLimit = share.viewsRemaining !== null;
    if (share.policy.requireIdentity) {
      const recipient = await getRecipientByLink(id);
      if (!recipient || recipient.revoked) {
        return jsonResponse({ error: "Not found", kind: "gone" }, 404);
      }
      exhausted = recipient.viewsRemaining !== null && recipient.viewsRemaining <= 0;
      hasViewLimit = recipient.viewsRemaining !== null;
    }

    const status: ShareStatusDto = {
      requiresPassword: share.wrappedCek !== null,
      requiresIdentity: share.policy.requireIdentity,
      expired: isExpired(share),
      exhausted,
      hasViewLimit,
    };
    return jsonResponse(status);
  } catch (error) {
    return errorResponse(error);
  }
}
