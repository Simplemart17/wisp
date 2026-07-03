import { insertReport } from "@/lib/server/db/maintenance";
import { ApiError, clientIp, enforceRateLimit, errorResponse, jsonResponse, readJsonBody } from "@/lib/server/http";
import { hashIp } from "@/lib/server/tokens";
import { SHARE_ID_RE } from "@/lib/server/validation";

export const runtime = "nodejs";

const REASONS = new Set(["illegal", "malware", "phishing", "other"]);

/**
 * Abuse reporting (SPEC §10): Wisp cannot scan ciphertext, so reports + rate
 * limits + upload caps are the mitigation. Reports land in wisp.reports for
 * the operator to review (and revoke via the DB if warranted).
 */
export async function POST(req: Request): Promise<Response> {
  try {
    enforceRateLimit(req, "report", 5, 10 * 60 * 1000);

    const body = await readJsonBody(req);
    if (typeof body.reason !== "string" || !REASONS.has(body.reason)) {
      throw new ApiError(400, "reason must be one of: illegal, malware, phishing, other");
    }
    const shareId =
      typeof body.shareId === "string" && SHARE_ID_RE.test(body.shareId) ? body.shareId : null;
    const details = typeof body.details === "string" ? body.details.slice(0, 2000) : null;

    await insertReport({ shareId, reason: body.reason, details, ipHash: hashIp(clientIp(req)) });
    return jsonResponse({ ok: true }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
