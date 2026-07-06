import { listOwnedShares } from "@/lib/server/db/shares";
import { ApiError, errorResponse, jsonResponse } from "@/lib/server/http";
import { senderUserId } from "@/lib/server/sender-auth";
import { isExpiredAt } from "@/lib/server/shares";
import type { MyShareDto, MySharesResponseDto } from "@/lib/shared/api";

export const runtime = "nodejs";

const PAGE_SIZE = 50;

/**
 * "My shares" (SPEC §5b): the signed-in sender's share history, paginated
 * newest-first (?before=<nextCursor> for older pages — the old fixed
 * limit(100) silently dropped a prolific sender's older shares). Anonymous
 * shares are invisible here by design — they carry no owner.
 */
export async function GET(req: Request): Promise<Response> {
  try {
    const userId = await senderUserId();
    if (!userId) return jsonResponse({ error: "Sign in required", kind: "unauthorized" }, 401);

    const beforeParam = new URL(req.url).searchParams.get("before");
    if (beforeParam !== null && Number.isNaN(Date.parse(beforeParam))) {
      throw new ApiError(400, "before must be an ISO timestamp");
    }

    const { shares, hasMore } = await listOwnedShares(userId, {
      limit: PAGE_SIZE,
      before: beforeParam ?? undefined,
    });
    const dtos: MyShareDto[] = shares.map((s) => ({
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
    const body: MySharesResponseDto = {
      shares: dtos,
      nextCursor: hasMore && dtos.length > 0 ? dtos[dtos.length - 1].createdAt : null,
    };
    return jsonResponse(body);
  } catch (error) {
    return errorResponse(error);
  }
}
