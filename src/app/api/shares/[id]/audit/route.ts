import { ApiError, clientIp, errorResponse, jsonResponse } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/ratelimit";
import { getShare, isExhausted, isExpired, requireManagementToken } from "@/lib/server/shares";
import { wispDb } from "@/lib/server/supabase";

export const runtime = "nodejs";

/** Management-token-gated audit trail + share status for /manage (SPEC §8). */
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
    if (!share) return jsonResponse({ error: "Not found", kind: "gone" }, 404);
    requireManagementToken(req, share);

    const { data: entries, error } = await wispDb()
      .from("access_log")
      .select("ts, ip_hash, user_agent, action, result")
      .eq("share_id", id)
      .order("ts", { ascending: false })
      .limit(200);
    if (error) throw new Error(`access_log read failed: ${error.message}`);

    return jsonResponse({
      share: {
        id: share.id,
        createdAt: share.created_at,
        expiresAt: share.expires_at,
        expired: isExpired(share),
        exhausted: isExhausted(share),
        remainingViews: share.policy.maxViews,
        requiresPassword: share.policy.password,
      },
      entries: entries ?? [],
    });
  } catch (error) {
    return errorResponse(error);
  }
}
