import { ApiError, clientIp, errorResponse, jsonResponse, readJsonBody } from "@/lib/server/http";
import { parseCreateShare } from "@/lib/server/policy";
import { rateLimit } from "@/lib/server/ratelimit";
import { bytesToPgHex, wispDb } from "@/lib/server/supabase";
import { generateManagementToken, generateShareId, sha256Base64Url } from "@/lib/server/tokens";

export const runtime = "nodejs";

/**
 * Step 2 of share creation (SPEC §8): persist the share record referencing an
 * already-uploaded ciphertext blob. Returns the share id and the sender's
 * management token — the token is returned exactly once; only its hash is
 * stored.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    if (!rateLimit(`shares:${clientIp(req)}`, 20, 10 * 60 * 1000)) {
      throw new ApiError(429, "Too many shares created, slow down");
    }

    const input = parseCreateShare(await readJsonBody(req));
    const id = generateShareId();
    const managementToken = generateManagementToken();

    const { error } = await wispDb().from("shares").insert({
      id,
      ciphertext_ref: input.ciphertextRef,
      wrapped_cek: input.wrappedCek === null ? null : bytesToPgHex(input.wrappedCek),
      kdf_salt: input.kdfSalt === null ? null : bytesToPgHex(input.kdfSalt),
      kdf_params: input.kdfParams,
      encrypted_metadata: bytesToPgHex(input.encryptedMetadata),
      policy: input.policy,
      management_token_hash: sha256Base64Url(managementToken),
      expires_at: input.expiresAt.toISOString(),
    });
    if (error) throw new Error(`share insert failed: ${error.message}`);

    return jsonResponse({ id, managementToken }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
