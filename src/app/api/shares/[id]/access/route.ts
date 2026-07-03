import { timingSafeEqual } from "node:crypto";

import { logAccess } from "@/lib/server/audit";
import { sendEmail, isValidEmail, normalizeEmail } from "@/lib/server/email";
import { ApiError, clientIp, errorResponse, jsonResponse, readJsonBody } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/ratelimit";
import { type RecipientRow, type ShareRow, getRecipientByLink, getShare, isExpired } from "@/lib/server/shares";
import { CIPHERTEXT_BUCKET, pgHexToBase64Url, wispDb } from "@/lib/server/supabase";
import { hashIp, sha256Base64Url } from "@/lib/server/tokens";

export const runtime = "nodejs";

const SIGNED_URL_TTL_SECONDS = 60;
const OTP_MAX_ATTEMPTS = 5;

interface OtpRow {
  id: string;
  code_hash: string;
  expires_at: string;
  attempts: number;
  consumed: boolean;
}

/**
 * OTP verification (SPEC §8): constant-time compare against the latest live
 * code, attempt-capped, single-use. Every failure is uniform to the caller.
 */
async function verifyOtp(shareId: string, emailHash: string, code: string): Promise<boolean> {
  const db = wispDb();
  const { data, error } = await db
    .from("otp_codes")
    .select("id, code_hash, expires_at, attempts, consumed")
    .eq("share_id", shareId)
    .eq("email_hash", emailHash)
    .eq("consumed", false)
    .gt("expires_at", new Date().toISOString())
    .lt("attempts", OTP_MAX_ATTEMPTS)
    .order("expires_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`otp lookup failed: ${error.message}`);

  const row = (data as OtpRow[] | null)?.[0];
  if (!row) return false;

  const presented = Buffer.from(sha256Base64Url(code), "base64url");
  const stored = Buffer.from(row.code_hash, "base64url");
  const matches = presented.length === stored.length && timingSafeEqual(presented, stored);

  if (!matches) {
    await db.from("otp_codes").update({ attempts: row.attempts + 1 }).eq("id", row.id);
    return false;
  }
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

/** Enforce identity + view limits; throws ApiError on deny (already logged). */
async function passGates(
  req: Request,
  share: ShareRow,
  body: Record<string, unknown>,
): Promise<GateResult> {
  const db = wispDb();

  if (share.policy.requireIdentity) {
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

    return {
      recipient,
      verifiedEmail: email,
      remainingViews: (data as number) === -1 ? null : (data as number),
    };
  }

  // Anonymous share: global view limit on the share row itself.
  if (share.policy.maxViews !== null) {
    const { data, error } = await db.rpc("consume_view", { p_share_id: share.id });
    if (error) throw new Error(`consume_view failed: ${error.message}`);
    if (data === null) {
      const result = isExpired(share) ? "expired" : "exhausted";
      await logAccess(req, share.id, "view", result);
      throw new ApiError(410, "No views remain on this share", result);
    }
    return { recipient: null, verifiedEmail: null, remainingViews: data as number };
  }
  return { recipient: null, verifiedEmail: null, remainingViews: null };
}

/**
 * The gate (SPEC §8): enforce expiry, identity (OTP) and view limits
 * atomically, then release a short-lived signed URL plus the key-wrap
 * material. The password is never sent here — it only unlocks the CEK
 * client-side.
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

    const gate = await passGates(req, share, body);

    const { data: signed, error: signError } = await wispDb()
      .storage.from(CIPHERTEXT_BUCKET)
      .createSignedUrl(share.ciphertext_ref, SIGNED_URL_TTL_SECONDS);
    if (signError || !signed) {
      throw new Error(`createSignedUrl failed: ${signError?.message}`);
    }

    const accessId = await logAccess(req, parentId, "view", "allowed", gate.recipient?.id);

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
