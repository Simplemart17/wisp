/**
 * Signature submission service (SPEC §9). Verifies the single-use signing
 * ticket, stores the sealed envelope, burns the ticket, logs, and notifies.
 */
import { sendEmail } from "../email";
import { ApiError } from "../http";
import { clearSignTicket, insertAccessLog, insertSignature } from "../db/access";
import { findRecipientByLink } from "../db/shares";
import { type ShareRecord, isExpired } from "../shares";
import { tokenMatchesHash } from "../tokens";

export interface SignContext {
  ticket: string;
  encryptedEnvelope: string; // base64url
  ipHash: string;
}

export type SignOutcome = { ok: true; signedAt: string } | { ok: false; kind: "already_signed" };

export async function submitSignature(share: ShareRecord, ctx: SignContext): Promise<SignOutcome> {
  if (isExpired(share)) throw new ApiError(410, "This share has expired", "expired");

  const recipient = await findRecipientByLink(share.id);
  if (!recipient || recipient.revoked) throw new ApiError(404, "Not found", "gone");

  const ticketValid =
    recipient.signTicketHash !== null &&
    recipient.signTicketExpiresAt !== null &&
    new Date(recipient.signTicketExpiresAt).getTime() > Date.now() &&
    tokenMatchesHash(ctx.ticket, recipient.signTicketHash);
  if (!ticketValid) {
    throw new ApiError(403, "Signing ticket is invalid or expired — reopen the share", "ticket");
  }

  const parentId = share.parentShareId ?? share.id;
  const result = await insertSignature(parentId, recipient.id, ctx.encryptedEnvelope, ctx.ipHash);
  if (result === "duplicate") return { ok: false, kind: "already_signed" };

  await clearSignTicket(recipient.id); // single-use
  await insertAccessLog({
    shareId: parentId,
    recipientId: recipient.id,
    ipHash: ctx.ipHash,
    userAgent: "",
    action: "sign",
    result: "allowed",
  });

  if (share.policy.notifyEmail) {
    void sendEmail({
      to: share.policy.notifyEmail,
      subject: "Your Wisp document was signed",
      text:
        `${recipient.emailHint ?? "A recipient"} just signed the document in share ${parentId}.\n` +
        `Open the share link to verify the signature cryptographically, or the management link for the audit trail.`,
    }).catch((err) => console.error("[wisp] sign notification failed:", err));
  }

  return { ok: true, signedAt: new Date().toISOString() };
}
