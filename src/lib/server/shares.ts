import { ApiError } from "./http";
import type { SharePolicy } from "./policy";
import { senderUserId } from "./sender-auth";
import { wispDb } from "./supabase";
import { tokenMatchesHash } from "./tokens";
import { SHARE_ID_RE } from "./validation";

/** Row shape as PostgREST returns it (bytea columns arrive as \x-hex strings). */
export interface ShareRow {
  id: string;
  ciphertext_ref: string;
  wrapped_cek: string | null;
  kdf_salt: string | null;
  kdf_params: Record<string, unknown> | null;
  encrypted_metadata: string;
  policy: SharePolicy;
  management_token_hash: string;
  parent_share_id: string | null;
  owner_user_id: string | null;
  created_at: string;
  expires_at: string | null;
}

export async function getShare(id: string): Promise<ShareRow | null> {
  if (!SHARE_ID_RE.test(id)) return null;
  const { data, error } = await wispDb().from("shares").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`shares lookup failed: ${error.message}`);
  return data as ShareRow | null;
}

/**
 * Load a top-level (parent) share for management routes, rejecting unknown ids
 * and per-recipient child links (children are managed via their parent's
 * link). Shared by revoke/audit/send-links so the gate is defined once.
 */
export async function getManageableParent(id: string): Promise<ShareRow> {
  const share = await getShare(id);
  if (!share || share.parent_share_id !== null) {
    throw new ApiError(404, "Not found", "gone");
  }
  return share;
}

/** True once the ISO timestamp is at or past now (null = never expires). */
export function isExpiredAt(expiresAt: string | null): boolean {
  return expiresAt !== null && new Date(expiresAt).getTime() <= Date.now();
}

export function isExpired(share: ShareRow): boolean {
  return isExpiredAt(share.expires_at);
}

export function isExhausted(share: ShareRow): boolean {
  return share.policy.maxViews !== null && share.policy.maxViews <= 0;
}

/**
 * Gate for /revoke, /audit and /send-links (SPEC §8): EITHER the management
 * token (constant-time hash check) OR a Clerk session whose user owns the
 * share. Anonymous shares are token-only by construction.
 */
export async function requireManagementAccess(req: Request, share: ShareRow): Promise<void> {
  const presented = req.headers.get("x-management-token");
  if (presented && tokenMatchesHash(presented, share.management_token_hash)) return;

  const userId = await senderUserId();
  if (userId !== null && share.owner_user_id === userId) return;

  throw new ApiError(403, "Invalid management token");
}

export interface RecipientRow {
  id: string;
  share_id: string;
  email_hash: string;
  email_hint: string | null;
  link_id: string;
  views_remaining: number | null;
  verified_at: string | null;
  revoked: boolean;
}

/** Recipient record for a per-recipient link (identity shares only). */
export async function getRecipientByLink(linkId: string): Promise<RecipientRow | null> {
  const { data, error } = await wispDb()
    .from("recipients")
    .select("*")
    .eq("link_id", linkId)
    .maybeSingle();
  if (error) throw new Error(`recipients lookup failed: ${error.message}`);
  return data as RecipientRow | null;
}
