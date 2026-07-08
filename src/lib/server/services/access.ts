/**
 * Access gate service (SPEC §8). Extracted from the route handler so the
 * domain logic — OTP verification, view-consume ordering, signing-ticket mint,
 * notify — is testable without Request/Response and has one home.
 */
import { timingSafeEqual } from "node:crypto";

import type { AccessResponseDto } from "@/lib/shared/api";
import { isValidEmail, normalizeEmail, sendEmail } from "../email";
import { ApiError } from "../http";
import { log as serverLog } from "../log";
import {
  claimOtpAttempt,
  consumeOtp,
  insertAccessLog,
  listSignatures,
  setSignTicket,
} from "../db/access";
import {
  type RecipientRecord,
  consumeRecipientView,
  consumeShareView,
  findRecipientByLink,
  markRecipientVerified,
} from "../db/shares";
import { createSignedDownloadUrl } from "../db/storage";
import { type ShareRecord, isExpired } from "../shares";
import { generateManagementToken, hashIp, sha256Base64Url } from "../tokens";
import { toSigningEnvelopes } from "../views";

const SIGNED_URL_TTL_SECONDS = 60;
const SIGN_TICKET_TTL_MS = 15 * 60 * 1000;

export interface AccessContext {
  ip: string;
  userAgent: string;
  email?: unknown;
  code?: unknown;
}

/** Constant-time OTP check against the atomically-claimed live code. */
async function verifyOtp(shareId: string, emailHash: string, code: string): Promise<boolean> {
  const claim = await claimOtpAttempt(shareId, emailHash);
  if (!claim) return false;
  const presented = Buffer.from(sha256Base64Url(code), "base64url");
  const stored = Buffer.from(claim.codeHash, "base64url");
  if (presented.length !== stored.length || !timingSafeEqual(presented, stored)) return false;
  return consumeOtp(claim.id);
}

function log(
  ctx: AccessContext,
  shareId: string,
  action: "view" | "otp_fail",
  result: "allowed" | "denied" | "expired" | "exhausted",
  recipientId: string | null,
) {
  return insertAccessLog({
    shareId,
    recipientId,
    ipHash: hashIp(ctx.ip),
    userAgent: ctx.userAgent.slice(0, 256),
    action,
    result,
  });
}

async function verifyIdentity(
  share: ShareRecord,
  parentId: string,
  ctx: AccessContext,
): Promise<{ recipient: RecipientRecord | null; verifiedEmail: string | null }> {
  if (!share.policy.requireIdentity) return { recipient: null, verifiedEmail: null };

  const recipient = await findRecipientByLink(share.id);
  if (!recipient || recipient.revoked) throw new ApiError(404, "Not found", "gone");

  if (!isValidEmail(ctx.email) || typeof ctx.code !== "string" || !/^\d{6}$/.test(ctx.code)) {
    throw new ApiError(401, "Enter your email and the 6-digit code", "otp_required");
  }
  const email = normalizeEmail(ctx.email);
  const allowlisted = sha256Base64Url(email) === recipient.emailHash;
  // Verify even for non-allowlisted emails so timing stays uniform.
  const otpOk = await verifyOtp(share.id, sha256Base64Url(email), ctx.code);
  if (!allowlisted || !otpOk) {
    await log(ctx, parentId, "otp_fail", "denied", recipient.id);
    throw new ApiError(401, "That code didn't work — request a fresh one", "otp_invalid");
  }
  return { recipient, verifiedEmail: email };
}

async function consumeView(
  share: ShareRecord,
  parentId: string,
  recipient: RecipientRecord | null,
  ctx: AccessContext,
): Promise<number | null> {
  if (recipient) {
    const data = await consumeRecipientView(share.id);
    if (data === null) {
      await log(ctx, parentId, "view", "exhausted", recipient.id);
      throw new ApiError(410, "No views remain on this link", "exhausted");
    }
    await markRecipientVerified(recipient.id);
    return data === -1 ? null : data;
  }
  if (share.policy.maxViews !== null) {
    const data = await consumeShareView(share.id);
    if (data === null) {
      const result = isExpired(share) ? "expired" : "exhausted";
      await log(ctx, share.id, "view", result, null);
      throw new ApiError(410, "No views remain on this share", result);
    }
    return data;
  }
  return null;
}

async function buildSigning(
  share: ShareRecord,
  parentId: string,
  recipientId: string | null,
): Promise<AccessResponseDto["signing"]> {
  if (!share.policy.requireSignature) return null;
  const signatures = await listSignatures(parentId);
  const alreadySigned = signatures.some((s) => s.recipientId === recipientId);

  let ticket: string | null = null;
  if (recipientId && !alreadySigned) {
    ticket = generateManagementToken();
    await setSignTicket(
      recipientId,
      sha256Base64Url(ticket),
      new Date(Date.now() + SIGN_TICKET_TTL_MS).toISOString(),
    );
  }
  return { required: true, ticket, alreadySigned, envelopes: toSigningEnvelopes(signatures) };
}

/**
 * Run the full gate and produce the access response, or throw ApiError on any
 * deny (already logged). Consuming a view is deferred until AFTER the signed
 * URL is minted, so a storage failure can't burn a one-time view.
 */
export async function accessShare(share: ShareRecord, ctx: AccessContext): Promise<AccessResponseDto> {
  const parentId = share.parentShareId ?? share.id;

  if (isExpired(share)) {
    await log(ctx, parentId, "view", "expired", null);
    throw new ApiError(410, "This share has expired", "expired");
  }

  const { recipient, verifiedEmail } = await verifyIdentity(share, parentId, ctx);
  const url = await createSignedDownloadUrl(share.ciphertextRef, SIGNED_URL_TTL_SECONDS);
  const remainingViews = await consumeView(share, parentId, recipient, ctx);

  const accessId = await log(ctx, parentId, "view", "allowed", recipient?.id ?? null);
  const signing = await buildSigning(share, parentId, recipient?.id ?? null);

  if (share.policy.notifyEmail) {
    const who = verifiedEmail ?? "someone with the link";
    void sendEmail({
      to: share.policy.notifyEmail,
      subject: "Your Wisp share was opened",
      text:
        `Your share ${parentId} was just opened by ${who}.\n` +
        `Manage it (audit log, revoke) with your management link.`,
    }).catch((err) => serverLog.error("email.notify_open_failed", { error: err, shareId: parentId }));
  }

  return {
    url,
    encryptedMetadata: share.encryptedMetadata,
    wrappedCek: share.wrappedCek,
    kdfSalt: share.kdfSalt,
    kdfParams: share.kdfParams,
    remainingViews,
    signing,
    viewOnly: share.policy.viewOnly,
    watermark: share.policy.watermark
      ? { email: verifiedEmail, ipHash: hashIp(ctx.ip), accessId, linkId: share.id }
      : null,
  };
}
