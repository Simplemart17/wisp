import { listAccessLog, listSignatureTimes } from "@/lib/server/db/access";
import { listRecipientStatus } from "@/lib/server/db/shares";
import { enforceRateLimit, errorResponse, jsonResponse } from "@/lib/server/http";
import { getManageableParent, requireManagementAccess } from "@/lib/server/shares";
import { toAuditReport } from "@/lib/server/views";

export const runtime = "nodejs";

/** Management-gated audit trail + share status for /manage (SPEC §8). */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    await enforceRateLimit(req, "audit", 30, 60 * 1000);

    const share = await getManageableParent(id);
    await requireManagementAccess(req, share);

    const entries = await listAccessLog(id);
    const recipients = share.policy.requireIdentity ? await listRecipientStatus(id) : [];
    const signedAt = share.policy.requireSignature
      ? await listSignatureTimes(id)
      : new Map<string, string>();

    return jsonResponse(toAuditReport(share, recipients, entries, signedAt));
  } catch (error) {
    return errorResponse(error);
  }
}
