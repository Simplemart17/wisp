import { ApiError, clientIp, errorResponse, jsonResponse, readJsonBody } from "@/lib/server/http";
import { parseCreateShare } from "@/lib/server/policy";
import { rateLimit } from "@/lib/server/ratelimit";
import { senderUserId } from "@/lib/server/sender-auth";
import { CIPHERTEXT_BUCKET, bytesToPgHex, wispDb } from "@/lib/server/supabase";
import { emailHint } from "@/lib/server/email";
import {
  generateManagementToken,
  generateShareId,
  sha256Base64Url,
} from "@/lib/server/tokens";

export const runtime = "nodejs";

/**
 * Step 2 of share creation (SPEC §8): persist the share record referencing an
 * already-uploaded ciphertext blob. For identity shares, mint one child share
 * row + recipient row per email — every access then maps to exactly one
 * identity, and each recipient is individually revocable.
 *
 * The management token is returned exactly once; only its hash is stored.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    if (!rateLimit(`shares:${clientIp(req)}`, 20, 10 * 60 * 1000)) {
      throw new ApiError(429, "Too many shares created, slow down");
    }

    const input = parseCreateShare(await readJsonBody(req));
    const id = generateShareId();
    const managementToken = generateManagementToken();
    // Clerk-signed-in senders get share history (SPEC §5b); null = anonymous.
    const ownerUserId = await senderUserId();

    const baseRow = {
      owner_user_id: ownerUserId,
      ciphertext_ref: input.ciphertextRef,
      wrapped_cek: input.wrappedCek === null ? null : bytesToPgHex(input.wrappedCek),
      kdf_salt: input.kdfSalt === null ? null : bytesToPgHex(input.kdfSalt),
      kdf_params: input.kdfParams,
      encrypted_metadata: bytesToPgHex(input.encryptedMetadata),
      policy: input.policy,
      management_token_hash: sha256Base64Url(managementToken),
      expires_at: input.expiresAt.toISOString(),
    };

    const db = wispDb();
    const { error } = await db.from("shares").insert({ id, ...baseRow });
    if (error) throw new Error(`share insert failed: ${error.message}`);

    // These inserts are not one transaction (PostgREST), so on any later
    // failure we best-effort roll back: deleting the parent cascades to child
    // shares + recipients, and we drop the already-uploaded blob so it isn't
    // orphaned (the sweeper only tracks live share rows).
    const rollback = async () => {
      try {
        await db.storage.from(CIPHERTEXT_BUCKET).remove([input.ciphertextRef]);
      } catch {
        /* best-effort */
      }
      try {
        await db.from("shares").delete().eq("id", id);
      } catch {
        /* best-effort */
      }
    };

    let recipientLinks: Array<{ email: string; linkId: string }> = [];
    try {
      if (input.policy.requireIdentity) {
        recipientLinks = input.recipients.map((email) => ({ email, linkId: generateShareId() }));

        const { error: childError } = await db.from("shares").insert(
          recipientLinks.map((r) => ({ id: r.linkId, ...baseRow, parent_share_id: id })),
        );
        if (childError) throw new Error(`child share insert failed: ${childError.message}`);

        const { error: recipientError } = await db.from("recipients").insert(
          recipientLinks.map((r) => ({
            share_id: id,
            link_id: r.linkId,
            email_hash: sha256Base64Url(r.email),
            email_hint: emailHint(r.email),
            views_remaining: input.policy.maxViews, // null = unlimited, per recipient
          })),
        );
        if (recipientError) throw new Error(`recipients insert failed: ${recipientError.message}`);
      }
    } catch (partial) {
      await rollback();
      throw partial;
    }

    return jsonResponse({ id, managementToken, recipientLinks }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
