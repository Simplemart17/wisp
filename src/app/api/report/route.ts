import { ApiError, clientIp, errorResponse, jsonResponse, readJsonBody } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/ratelimit";
import { wispDb } from "@/lib/server/supabase";
import { hashIp } from "@/lib/server/tokens";

export const runtime = "nodejs";

const REASONS = new Set(["illegal", "malware", "phishing", "other"]);

/**
 * Abuse reporting (SPEC §10): Wisp cannot scan ciphertext, so reports + rate
 * limits + upload caps are the mitigation. Reports land in wisp.reports for
 * the operator to review (and revoke via the DB if warranted).
 */
export async function POST(req: Request): Promise<Response> {
  try {
    if (!rateLimit(`report:${clientIp(req)}`, 5, 10 * 60 * 1000)) {
      throw new ApiError(429, "Too many reports, slow down");
    }

    const body = await readJsonBody(req);
    if (typeof body.reason !== "string" || !REASONS.has(body.reason)) {
      throw new ApiError(400, "reason must be one of: illegal, malware, phishing, other");
    }
    const shareId =
      typeof body.shareId === "string" && /^[A-Za-z0-9_-]{1,32}$/.test(body.shareId)
        ? body.shareId
        : null;
    const details = typeof body.details === "string" ? body.details.slice(0, 2000) : null;

    const { error } = await wispDb().from("reports").insert({
      share_id: shareId,
      reason: body.reason,
      details,
      ip_hash: hashIp(clientIp(req)),
    });
    if (error) throw new Error(`report insert failed: ${error.message}`);

    return jsonResponse({ ok: true }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
