import { listAccessLog, listSignatureTimes } from "@/lib/server/db/access";
import { listRecipientStatus } from "@/lib/server/db/shares";
import {
  ApiError,
  enforceRateLimit,
  errorResponse,
  jsonResponse,
  parseBeforeCursor,
} from "@/lib/server/http";
import { getManageableParent, requireManagementAccess } from "@/lib/server/shares";
import { toAuditReport } from "@/lib/server/views";

export const runtime = "nodejs";

const ENTRIES_PAGE_SIZE = 100;

/**
 * Management-gated audit trail + share status for /manage (SPEC §8).
 * Entries paginate newest-first: pass ?before=<entriesNextCursor> for the
 * next page (share/recipients ride along unchanged — they're cheap).
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    await enforceRateLimit(req, "audit", 30, 60 * 1000);

    const share = await getManageableParent(id);
    await requireManagementAccess(req, share);

    const before = parseBeforeCursor(req);
    if (before && !/^\d+$/.test(before.id)) {
      throw new ApiError(400, "before must be a cursor returned by a previous page");
    }

    const { entries, hasMore } = await listAccessLog(id, {
      limit: ENTRIES_PAGE_SIZE,
      before,
    });
    const recipients = share.policy.requireIdentity ? await listRecipientStatus(id) : [];
    const signedAt = share.policy.requireSignature
      ? await listSignatureTimes(id)
      : new Map<string, string>();

    return jsonResponse(toAuditReport(share, recipients, entries, signedAt, hasMore));
  } catch (error) {
    return errorResponse(error);
  }
}
