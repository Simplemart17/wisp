import { ApiError } from "./http";
import type { SharePolicy } from "./policy";
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

/** Gate for /revoke and /audit: constant-time management-token check. */
export function requireManagementToken(req: Request, share: ShareRow): void {
  const presented = req.headers.get("x-management-token");
  if (!presented || !tokenMatchesHash(presented, share.management_token_hash)) {
    throw new ApiError(403, "Invalid management token");
  }
}
