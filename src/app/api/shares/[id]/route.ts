import { ApiError, clientIp, errorResponse, jsonResponse } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/ratelimit";
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
    if (!rateLimit(`status:${clientIp(req)}`, 120, 10 * 60 * 1000)) {
      throw new ApiError(429, "Too many requests, slow down");
    }
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
