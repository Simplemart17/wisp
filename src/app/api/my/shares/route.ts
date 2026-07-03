import { listOwnedShares } from "@/lib/server/db/shares";
import { errorResponse, jsonResponse } from "@/lib/server/http";
import { senderUserId } from "@/lib/server/sender-auth";
import { isExpiredAt } from "@/lib/server/shares";
import type { MyShareDto } from "@/lib/shared/api";

export const runtime = "nodejs";

/**
 * "My shares" (SPEC §5b): the signed-in sender's share history. Anonymous
 * shares are invisible here by design — they carry no owner.
 */
export async function GET(): Promise<Response> {
  try {
    const userId = await senderUserId();
    if (!userId) return jsonResponse({ error: "Sign in required", kind: "unauthorized" }, 401);

    const shares: MyShareDto[] = (await listOwnedShares(userId)).map((s) => ({
      id: s.id,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      expired: isExpiredAt(s.expiresAt),
      policy: {
        maxViews: s.policy.maxViews,
        password: s.policy.password,
        requireIdentity: s.policy.requireIdentity,
        viewOnly: s.policy.viewOnly,
        watermark: s.policy.watermark,
      },
    }));
    return jsonResponse({ shares });
  } catch (error) {
    return errorResponse(error);
  }
}
