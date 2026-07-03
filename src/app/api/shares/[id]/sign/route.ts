import { logAccess } from "@/lib/server/audit";
import { sendEmail } from "@/lib/server/email";
import { ApiError, clientIp, errorResponse, jsonResponse, readJsonBody } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/ratelimit";
import { getRecipientByLink, getShare, isExpired } from "@/lib/server/shares";
import { bytesToPgHex, wispDb } from "@/lib/server/supabase";
import { hashIp, tokenMatchesHash } from "@/lib/server/tokens";

export const runtime = "nodejs";

const MAX_ENVELOPE_BYTES = 8192;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

/**
 * Store a signature envelope. Authorization is the single-use signing ticket
 * minted by /access after the OTP gate — so a signature can only follow a
 * verified, view-consuming open. The envelope is sealed client-side under a
 * CEK subkey: the server attests who/when, but cannot read what was signed.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    if (!rateLimit(`sign:${clientIp(req)}`, 10, 10 * 60 * 1000)) {
      throw new ApiError(429, "Too many attempts, slow down");
    }

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
    if (isExpired(share)) {
      return jsonResponse({ error: "This share has expired", kind: "expired" }, 410);
    }
    const recipient = await getRecipientByLink(id);
    if (!recipient || recipient.revoked) {
      return jsonResponse({ error: "Not found", kind: "gone" }, 404);
    }

    const recipientRow = recipient as typeof recipient & {
      sign_ticket_hash: string | null;
      sign_ticket_expires_at: string | null;
    };
    const ticketValid =
      recipientRow.sign_ticket_hash !== null &&
      recipientRow.sign_ticket_expires_at !== null &&
      new Date(recipientRow.sign_ticket_expires_at).getTime() > Date.now() &&
      tokenMatchesHash(ticket, recipientRow.sign_ticket_hash);
    if (!ticketValid) {
      throw new ApiError(403, "Signing ticket is invalid or expired — reopen the share", "ticket");
    }

    const db = wispDb();
    const parentId = share.parent_share_id ?? share.id;
    const { error: insertError } = await db.from("signatures").insert({
      share_id: parentId,
      recipient_id: recipient.id,
      encrypted_envelope: bytesToPgHex(encryptedEnvelope),
      ip_hash: hashIp(clientIp(req)),
    });
    if (insertError) {
      if (insertError.code === "23505") {
        return jsonResponse({ error: "Already signed", kind: "already_signed" }, 409);
      }
      throw new Error(`signature insert failed: ${insertError.message}`);
    }

    // Ticket is single-use.
    await db
      .from("recipients")
      .update({ sign_ticket_hash: null, sign_ticket_expires_at: null })
      .eq("id", recipient.id);

    await logAccess(req, parentId, "sign", "allowed", recipient.id);

    if (share.policy.notifyEmail) {
      void sendEmail({
        to: share.policy.notifyEmail,
        subject: "Your Wisp document was signed",
        text:
          `${recipient.email_hint ?? "A recipient"} just signed the document in share ${parentId}.\n` +
          `Open the share link to verify the signature cryptographically, or the management link for the audit trail.`,
      }).catch((err) => console.error("[wisp] sign notification failed:", err));
    }

    return jsonResponse({ ok: true, signedAt: new Date().toISOString() }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
