import { listOwnedShares } from "@/lib/server/db/shares";
import { ApiError, errorResponse, jsonResponse, parseBeforeCursor } from "@/lib/server/http";
import { senderUserId } from "@/lib/server/sender-auth";
import { isExpiredAt } from "@/lib/server/shares";
import { SHARE_ID_RE } from "@/lib/server/validation";
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

    const before = parseBeforeCursor(req);
    if (before && !SHARE_ID_RE.test(before.id)) {
      throw new ApiError(400, "before must be a cursor returned by a previous page");
    }

    const { shares, hasMore } = await listOwnedShares(userId, {
      limit: PAGE_SIZE,
      before,
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
    const last = dtos[dtos.length - 1];
    const body: MySharesResponseDto = {
      shares: dtos,
      nextCursor: hasMore && last ? `${last.createdAt}|${last.id}` : null,
    };
    return jsonResponse(body);
  } catch (error) {
    return errorResponse(error);
  }
}
