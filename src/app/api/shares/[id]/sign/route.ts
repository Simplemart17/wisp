import { ApiError, clientIp, enforceRateLimit, errorResponse, jsonResponse, readJsonBody } from "@/lib/server/http";
import { submitSignature } from "@/lib/server/services/signing";
import { getShare } from "@/lib/server/shares";
import { hashIp } from "@/lib/server/tokens";
import { BASE64URL_RE } from "@/lib/server/validation";

export const runtime = "nodejs";

const MAX_ENVELOPE_BYTES = 8192;

/**
 * Store a signature envelope (SPEC §9). Authorization is the single-use
 * signing ticket minted by /access after the OTP gate — see the signing
 * service. The envelope is sealed client-side; the server stores it opaquely.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    await enforceRateLimit(req, "sign", 10, 10 * 60 * 1000);

    const body = await readJsonBody(req);
    const { ticket, encryptedEnvelope } = body;
    if (typeof ticket !== "string" || ticket.length < 20) {
      throw new ApiError(400, "A signing ticket is required");
    }
    if (
      typeof encryptedEnvelope !== "string" ||
      !BASE64URL_RE.test(encryptedEnvelope) ||
      encryptedEnvelope.length > (MAX_ENVELOPE_BYTES * 4) / 3 + 4 ||
      encryptedEnvelope.length < 40
    ) {
      throw new ApiError(400, "encryptedEnvelope is malformed");
    }

    const share = await getShare(id);
    if (!share || !share.policy.requireSignature) {
      return jsonResponse({ error: "Not found", kind: "gone" }, 404);
    }

    const outcome = await submitSignature(share, {
      ticket,
      encryptedEnvelope,
      ipHash: hashIp(clientIp(req)),
    });
    if (!outcome.ok) return jsonResponse({ error: "Already signed", kind: outcome.kind }, 409);
    return jsonResponse({ ok: true, signedAt: outcome.signedAt }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
