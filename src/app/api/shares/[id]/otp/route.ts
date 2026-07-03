import { randomInt } from "node:crypto";

import { insertOtp, invalidateLiveOtps } from "@/lib/server/db/access";
import { isValidEmail, normalizeEmail, sendEmail } from "@/lib/server/email";
import { ApiError, clientIp, errorResponse, jsonResponse, readJsonBody } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/ratelimit";
import { getRecipientByLink, getShare, isExpired } from "@/lib/server/shares";
import { sha256Base64Url } from "@/lib/server/tokens";

export const runtime = "nodejs";

const OTP_TTL_MS = 10 * 60 * 1000;

/**
 * Recipient OTP request (SPEC §8): generate a 6-digit code, store only its
 * hash (short expiry, attempt-capped), and email it — but ONLY to the address
 * on this link's allowlist. The response is identical whether or not the
 * email matched, so the endpoint can't be used to probe the allowlist.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const ip = clientIp(req);
    if (!rateLimit(`otp:${ip}`, 10, 10 * 60 * 1000) || !rateLimit(`otp:${ip}:${id}`, 5, 10 * 60 * 1000)) {
      throw new ApiError(429, "Too many code requests, slow down");
    }

    const body = await readJsonBody(req);
    if (!isValidEmail(body.email)) throw new ApiError(400, "A valid email is required");
    const email = normalizeEmail(body.email);

    const share = await getShare(id);
    // Uniform response from here down — reveal nothing about the share or list.
    const uniform = () => jsonResponse({ ok: true });

    if (!share || isExpired(share) || !share.policy.requireIdentity) return uniform();
    const recipient = await getRecipientByLink(id);
    if (!recipient || recipient.revoked) return uniform();
    if (sha256Base64Url(email) !== recipient.emailHash) return uniform();

    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    // Retire any earlier live codes so exactly one is valid at a time.
    await invalidateLiveOtps(id, recipient.emailHash);
    await insertOtp(
      id,
      recipient.emailHash,
      sha256Base64Url(code),
      new Date(Date.now() + OTP_TTL_MS).toISOString(),
    );

    await sendEmail({
      to: email,
      subject: `${code} is your Wisp verification code`,
      text:
        `Someone shared an encrypted item with you on Wisp.\n\n` +
        `Your verification code is: ${code}\n\n` +
        `It expires in 10 minutes. If you weren't expecting this, ignore this email.`,
    });

    return uniform();
  } catch (error) {
    return errorResponse(error);
  }
}
