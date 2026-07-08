/**
 * Domain layer over the shares/recipients repository: re-exports the record
 * lookups under stable names and adds the pure policy predicates + the
 * management-access gate. Routes and services import from here, not from the
 * data layer directly.
 */
import { ApiError } from "./http";
import { senderUserId } from "./sender-auth";
import { tokenMatchesHash } from "./tokens";
import type { ShareRecord } from "./db/shares";
import {
  findManageableParent,
  findRecipientByLink,
  findShare,
  listRecipientStatus,
} from "./db/shares";

export type { ShareRecord, RecipientRecord } from "./db/shares";

export const getShare = findShare;
export const getManageableParent = findManageableParent;
export const getRecipientByLink = findRecipientByLink;

/** True once the ISO timestamp is at or past now (null = never expires). */
export function isExpiredAt(expiresAt: string | null): boolean {
  return expiresAt !== null && new Date(expiresAt).getTime() <= Date.now();
}

export function isExpired(share: ShareRecord): boolean {
  return isExpiredAt(share.expiresAt);
}

/** Anonymous shares track the live counter in viewsRemaining; null = unlimited. */
export function isExhausted(share: ShareRecord): boolean {
  return share.viewsRemaining !== null && share.viewsRemaining <= 0;
}

/**
 * Whether the sweeper's exhaustion clause matches this parent share — i.e. no
 * link (share-level or any recipient's) has views left. Mirrors the
 * find_sweepable_shares predicate so edit guards and the sweeper agree on
 * what "dead" means.
 */
export async function isFullyExhausted(share: ShareRecord): Promise<boolean> {
  if (!share.policy.requireIdentity) return isExhausted(share);
  const recipients = await listRecipientStatus(share.id);
  return (
    recipients.length > 0 &&
    recipients.every((r) => r.views_remaining !== null && r.views_remaining <= 0)
  );
}

/**
 * Gate for /revoke, /audit and /send-links (SPEC §8): EITHER the management
 * token (constant-time hash check) OR a Clerk session whose user owns the
 * share. Anonymous shares are token-only by construction.
 */
export async function requireManagementAccess(req: Request, share: ShareRecord): Promise<void> {
  const presented = req.headers.get("x-management-token");
  if (presented && tokenMatchesHash(presented, share.managementTokenHash)) return;

  const userId = await senderUserId();
  if (userId !== null && share.ownerUserId === userId) return;

  throw new ApiError(403, "Invalid management token");
}
