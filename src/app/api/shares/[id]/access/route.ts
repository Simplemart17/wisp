import { logAccess } from "@/lib/server/audit";
import { ApiError, clientIp, errorResponse, jsonResponse } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/ratelimit";
import { getShare, isExpired } from "@/lib/server/shares";
import { CIPHERTEXT_BUCKET, pgHexToBase64Url, wispDb } from "@/lib/server/supabase";

export const runtime = "nodejs";

const SIGNED_URL_TTL_SECONDS = 60;

/**
 * The gate (SPEC §8): enforce expiry and view limits atomically, then release
 * a short-lived signed URL plus the key-wrap material. The password is never
 * sent here — it only ever unlocks the CEK client-side.
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

    const share = await getShare(id);
    if (!share) return jsonResponse({ error: "Not found", kind: "gone" }, 404);

    if (isExpired(share)) {
      await logAccess(req, id, "view", "expired");
      return jsonResponse({ error: "This share has expired", kind: "expired" }, 410);
    }

    let remainingViews: number | null = null;
    if (share.policy.maxViews !== null) {
      // Atomic decrement-if-positive; no row updated → deny.
      const { data, error } = await wispDb().rpc("consume_view", { p_share_id: id });
      if (error) throw new Error(`consume_view failed: ${error.message}`);
      if (data === null) {
        const result = isExpired(share) ? "expired" : "exhausted";
        await logAccess(req, id, "view", result);
        return jsonResponse(
          { error: "No views remain on this share", kind: result },
          410,
        );
      }
      remainingViews = data as number;
    }

    const { data: signed, error: signError } = await wispDb()
      .storage.from(CIPHERTEXT_BUCKET)
      .createSignedUrl(share.ciphertext_ref, SIGNED_URL_TTL_SECONDS);
    if (signError || !signed) {
      throw new Error(`createSignedUrl failed: ${signError?.message}`);
    }

    await logAccess(req, id, "view", "allowed");

    return jsonResponse({
      url: signed.signedUrl,
      encryptedMetadata: pgHexToBase64Url(share.encrypted_metadata),
      wrappedCek: pgHexToBase64Url(share.wrapped_cek),
      kdfSalt: pgHexToBase64Url(share.kdf_salt),
      kdfParams: share.kdf_params,
      remainingViews,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
