import { timingSafeEqual } from "node:crypto";

import { logAccess } from "@/lib/server/audit";
import { sendEmail, isValidEmail, normalizeEmail } from "@/lib/server/email";
import { ApiError, clientIp, errorResponse, jsonResponse, readJsonBody } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/ratelimit";
import { type RecipientRow, type ShareRow, getRecipientByLink, getShare, isExpired } from "@/lib/server/shares";
import { CIPHERTEXT_BUCKET, pgHexToBase64Url, wispDb } from "@/lib/server/supabase";
import { generateManagementToken, hashIp, sha256Base64Url } from "@/lib/server/tokens";

export const runtime = "nodejs";

const SIGNED_URL_TTL_SECONDS = 60;
const SIGN_TICKET_TTL_MS = 15 * 60 * 1000;

/**
 * OTP verification (SPEC §8): constant-time compare against the newest live
 * code, attempt-capped, single-use. The attempt increment + cap check run
 * atomically in claim_otp_attempt() so a burst of concurrent requests cannot
 * bypass the cap. Every failure is uniform to the caller.
 */
async function verifyOtp(shareId: string, emailHash: string, code: string): Promise<boolean> {
  const db = wispDb();
  // Atomically consumes one of the ≤5 attempts and returns the code hash to
  // compare; no row means expired / none / cap reached — all "denied".
  const { data, error } = await db.rpc("claim_otp_attempt", {
    p_share_id: shareId,
    p_email_hash: emailHash,
  });
  if (error) throw new Error(`otp claim failed: ${error.message}`);

  const row = (data as Array<{ id: string; code_hash: string }> | null)?.[0];
  if (!row) return false;

  const presented = Buffer.from(sha256Base64Url(code), "base64url");
  const stored = Buffer.from(row.code_hash, "base64url");
  const matches = presented.length === stored.length && timingSafeEqual(presented, stored);
  if (!matches) return false;

  // Single-use: the conditional update loses gracefully on a concurrent race.
  const { data: consumed, error: consumeError } = await db
    .from("otp_codes")
    .update({ consumed: true })
    .eq("id", row.id)
    .eq("consumed", false)
    .select("id");
  if (consumeError) throw new Error(`otp consume failed: ${consumeError.message}`);
  return (consumed ?? []).length === 1;
}

interface GateResult {
  recipient: RecipientRow | null;
  verifiedEmail: string | null;
  remainingViews: number | null;
}

/**
 * Identity gate only (OTP): no view is consumed here, so that the irreversible
 * consume can be deferred until AFTER the signed URL is minted — a storage
 * hiccup then denies without burning a one-time view.
 */
async function verifyIdentity(
  req: Request,
  share: ShareRow,
  body: Record<string, unknown>,
): Promise<{ recipient: RecipientRow | null; verifiedEmail: string | null }> {
  if (!share.policy.requireIdentity) {
    return { recipient: null, verifiedEmail: null };
  }
  const recipient = await getRecipientByLink(share.id);
  if (!recipient || recipient.revoked) {
    throw new ApiError(404, "Not found", "gone");
  }
  if (!isValidEmail(body.email) || typeof body.code !== "string" || !/^\d{6}$/.test(body.code)) {
    throw new ApiError(401, "Enter your email and the 6-digit code", "otp_required");
  }
  const email = normalizeEmail(body.email);
  const allowlisted = sha256Base64Url(email) === recipient.email_hash;
  // Verify even for non-allowlisted emails so timing stays uniform.
  const otpOk = await verifyOtp(share.id, sha256Base64Url(email), body.code);
  if (!allowlisted || !otpOk) {
    await logAccess(req, share.parent_share_id ?? share.id, "otp_fail", "denied", recipient.id);
    throw new ApiError(401, "That code didn't work — request a fresh one", "otp_invalid");
  }
  return { recipient, verifiedEmail: email };
}

/** Atomically consume one view; throws exhausted on deny (already logged). */
async function consumeView(
  req: Request,
  share: ShareRow,
  recipient: RecipientRow | null,
): Promise<number | null> {
  const db = wispDb();
  if (recipient) {
    const { data, error } = await db.rpc("consume_recipient_view", { p_link_id: share.id });
    if (error) throw new Error(`consume_recipient_view failed: ${error.message}`);
    if (data === null) {
      await logAccess(req, share.parent_share_id ?? share.id, "view", "exhausted", recipient.id);
      throw new ApiError(410, "No views remain on this link", "exhausted");
    }
    await db
      .from("recipients")
      .update({ verified_at: new Date().toISOString() })
      .eq("id", recipient.id)
      .is("verified_at", null);
    return (data as number) === -1 ? null : (data as number);
  }

  if (share.policy.maxViews !== null) {
    const { data, error } = await db.rpc("consume_view", { p_share_id: share.id });
    if (error) throw new Error(`consume_view failed: ${error.message}`);
    if (data === null) {
      const result = isExpired(share) ? "expired" : "exhausted";
      await logAccess(req, share.id, "view", result);
      throw new ApiError(410, "No views remain on this share", result);
    }
    return data as number;
  }
  return null;
}

/**
 * The gate (SPEC §8): enforce expiry and identity (OTP), then — only once the
 * signed URL is in hand — atomically consume a view and release the key-wrap
 * material. Consuming last means a storage failure can't spend a one-time
 * view. The password is never sent here; it only unlocks the CEK client-side.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const ip = clientIp(req);
    if (!rateLimit(`access:${ip}`, 60, 10 * 60 * 1000) || !rateLimit(`access:${ip}:${id}`, 10, 60 * 1000)) {
      throw new ApiError(429, "Too many attempts, slow down");
    }

    const body = await readJsonBody(req);
    const share = await getShare(id);
    if (!share) return jsonResponse({ error: "Not found", kind: "gone" }, 404);

    const parentId = share.parent_share_id ?? share.id;
    if (isExpired(share)) {
      await logAccess(req, parentId, "view", "expired");
      return jsonResponse({ error: "This share has expired", kind: "expired" }, 410);
    }

    const identity = await verifyIdentity(req, share, body);

    const { data: signed, error: signError } = await wispDb()
      .storage.from(CIPHERTEXT_BUCKET)
      .createSignedUrl(share.ciphertext_ref, SIGNED_URL_TTL_SECONDS);
    if (signError || !signed) {
      throw new Error(`createSignedUrl failed: ${signError?.message}`);
    }

    // Irreversible step, deferred to the latest safe moment.
    const remainingViews = await consumeView(req, share, identity.recipient);
    const gate: GateResult = { ...identity, remainingViews };

    const accessId = await logAccess(req, parentId, "view", "allowed", gate.recipient?.id);

    // Document signing (policy.requireSignature): hand the verified recipient
    // a single-use ticket for POST /sign, and give every authorized viewer
    // the sealed envelopes so they can verify signatures locally.
    let signing: {
      required: boolean;
      ticket: string | null;
      alreadySigned: boolean;
      envelopes: Array<{ encryptedEnvelope: string | null; signedAt: string; emailHint: string | null }>;
    } | null = null;
    if (share.policy.requireSignature) {
      const db = wispDb();
      const { data: rows, error: sigError } = await db
        .from("signatures")
        .select("recipient_id, encrypted_envelope, created_at, recipients(email_hint)")
        .eq("share_id", parentId);
      if (sigError) throw new Error(`signatures read failed: ${sigError.message}`);

      const envelopes = (rows ?? []).map((row) => ({
        encryptedEnvelope: pgHexToBase64Url(row.encrypted_envelope as string),
        signedAt: row.created_at as string,
        emailHint:
          (row.recipients as unknown as { email_hint: string | null } | null)?.email_hint ?? null,
      }));
      const alreadySigned = (rows ?? []).some((row) => row.recipient_id === gate.recipient?.id);

      let ticket: string | null = null;
      if (gate.recipient && !alreadySigned) {
        ticket = generateManagementToken();
        const { error: ticketError } = await db
          .from("recipients")
          .update({
            sign_ticket_hash: sha256Base64Url(ticket),
            sign_ticket_expires_at: new Date(Date.now() + SIGN_TICKET_TTL_MS).toISOString(),
          })
          .eq("id", gate.recipient.id);
        if (ticketError) throw new Error(`sign ticket update failed: ${ticketError.message}`);
      }
      signing = { required: true, ticket, alreadySigned, envelopes };
    }

    if (share.policy.notifyEmail) {
      const who = gate.verifiedEmail ?? "someone with the link";
      void sendEmail({
        to: share.policy.notifyEmail,
        subject: "Your Wisp share was opened",
        text:
          `Your share ${parentId} was just opened by ${who}.\n` +
          `Manage it (audit log, revoke) with your management link.`,
      }).catch((err) => console.error("[wisp] notify-on-open failed:", err));
    }

    return jsonResponse({
      url: signed.signedUrl,
      encryptedMetadata: pgHexToBase64Url(share.encrypted_metadata),
      wrappedCek: pgHexToBase64Url(share.wrapped_cek),
      kdfSalt: pgHexToBase64Url(share.kdf_salt),
      kdfParams: share.kdf_params,
      remainingViews: gate.remainingViews,
      signing,
      viewOnly: share.policy.viewOnly,
      watermark: share.policy.watermark
        ? {
            email: gate.verifiedEmail, // null on anonymous shares → link id is stamped
            ipHash: hashIp(ip),
            accessId,
            linkId: share.id,
          }
        : null,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
