import { ApiError, clientIp, errorResponse, jsonResponse } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/ratelimit";
import { getShare, isExhausted, isExpired, requireManagementToken } from "@/lib/server/shares";
import { wispDb } from "@/lib/server/supabase";

export const runtime = "nodejs";

/**
 * Management-token-gated audit trail + share status for /manage (SPEC §8).
 * For identity shares, includes the per-recipient links with masked email
 * hints, and each log entry carries the recipient it belongs to.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    if (!rateLimit(`audit:${clientIp(req)}`, 30, 60 * 1000)) {
      throw new ApiError(429, "Too many attempts, slow down");
    }

    const share = await getShare(id);
    if (!share || share.parent_share_id !== null) {
      return jsonResponse({ error: "Not found", kind: "gone" }, 404);
    }
    requireManagementToken(req, share);

    const db = wispDb();
    const { data: entries, error } = await db
      .from("access_log")
      .select("ts, ip_hash, user_agent, action, result, recipients(email_hint)")
      .eq("share_id", id)
      .order("ts", { ascending: false })
      .limit(200);
    if (error) throw new Error(`access_log read failed: ${error.message}`);

    let recipients: unknown[] = [];
    if (share.policy.requireIdentity) {
      const { data, error: recipientsError } = await db
        .from("recipients")
        .select("link_id, email_hint, views_remaining, verified_at, revoked")
        .eq("share_id", id)
        .order("email_hint");
      if (recipientsError) throw new Error(`recipients read failed: ${recipientsError.message}`);
      recipients = data ?? [];
    }

    return jsonResponse({
      share: {
        id: share.id,
        createdAt: share.created_at,
        expiresAt: share.expires_at,
        expired: isExpired(share),
        exhausted: isExhausted(share),
        remainingViews: share.policy.maxViews,
        requiresPassword: share.policy.password,
        requiresIdentity: share.policy.requireIdentity,
        viewOnly: share.policy.viewOnly,
        watermark: share.policy.watermark,
      },
      recipients,
      entries: entries ?? [],
    });
  } catch (error) {
    return errorResponse(error);
  }
}
