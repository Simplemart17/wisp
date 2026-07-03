/**
 * Share-creation service (SPEC §8). Persists the share (and, for identity
 * shares, one child link + recipient per email) and best-effort rolls back a
 * partial failure. Extracted from the route so the multi-step orchestration is
 * testable and has one home.
 */
import { emailHint } from "../email";
import type { ValidatedCreateShare } from "../policy";
import {
  type ShareContent,
  deleteShare,
  insertChildShares,
  insertRecipients,
  insertShare,
} from "../db/shares";
import { removeBlobs } from "../db/storage";
import { generateManagementToken, generateShareId, sha256Base64Url } from "../tokens";

export interface CreateShareResult {
  id: string;
  managementToken: string;
  recipientLinks: Array<{ email: string; linkId: string }>;
}

export async function createShare(
  input: ValidatedCreateShare,
  ownerUserId: string | null,
): Promise<CreateShareResult> {
  const id = generateShareId();
  const managementToken = generateManagementToken();

  const content: ShareContent = {
    ciphertextRef: input.ciphertextRef,
    wrappedCek: input.wrappedCek,
    kdfSalt: input.kdfSalt,
    kdfParams: input.kdfParams,
    encryptedMetadata: input.encryptedMetadata,
    policy: input.policy,
    managementTokenHash: sha256Base64Url(managementToken),
    expiresAt: input.expiresAt.toISOString(),
    ownerUserId,
  };

  await insertShare(id, content);

  // Not one transaction (PostgREST): on any later failure, delete the parent
  // (cascades to children + recipients) and drop the orphaned blob.
  const rollback = async () => {
    await removeBlobs([input.ciphertextRef]);
    await deleteShare(id).catch(() => {});
  };

  let recipientLinks: Array<{ email: string; linkId: string }> = [];
  try {
    if (input.policy.requireIdentity) {
      recipientLinks = input.recipients.map((email) => ({ email, linkId: generateShareId() }));
      await insertChildShares(
        id,
        recipientLinks.map((r) => r.linkId),
      );
      await insertRecipients(
        recipientLinks.map((r) => ({
          shareId: id,
          linkId: r.linkId,
          emailHash: sha256Base64Url(r.email),
          emailHint: emailHint(r.email),
          viewsRemaining: input.policy.maxViews, // null = unlimited, per recipient
        })),
      );
    }
  } catch (partial) {
    await rollback();
    throw partial;
  }

  return { id, managementToken, recipientLinks };
}
