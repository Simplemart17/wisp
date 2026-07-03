import { ApiError } from "./http";
import type { SharePolicy } from "./policy";
import { senderUserId } from "./sender-auth";
import { wispDb } from "./supabase";
import { tokenMatchesHash } from "./tokens";

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

const SHARE_ID_RE = /^[A-Za-z0-9_-]{16}$/;

export async function getShare(id: string): Promise<ShareRow | null> {
  if (!SHARE_ID_RE.test(id)) return null;
  const { data, error } = await wispDb().from("shares").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`shares lookup failed: ${error.message}`);
  return data as ShareRow | null;
}

export function isExpired(share: ShareRow): boolean {
  return share.expires_at !== null && new Date(share.expires_at).getTime() <= Date.now();
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
