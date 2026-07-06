/**
 * View-model mappers: the single place domain records become API DTOs, so the
 * "what a share looks like over the wire" shape has one owner.
 */
import type { AuditReportDto, ManagedShareDto, RecipientStatusDto } from "@/lib/shared/api";
import type { AuditEntryRecord, SignatureRecord } from "./db/access";
import type { RecipientStatusRow } from "./db/shares";
import type { ShareRecord } from "./shares";
import { isExhausted, isExpired } from "./shares";

export function toManagedShare(share: ShareRecord): ManagedShareDto {
  return {
    id: share.id,
    createdAt: share.createdAt,
    expiresAt: share.expiresAt,
    expired: isExpired(share),
    exhausted: isExhausted(share),
    remainingViews: share.viewsRemaining,
    requiresPassword: share.policy.password,
    requiresIdentity: share.policy.requireIdentity,
    requiresSignature: share.policy.requireSignature,
    viewOnly: share.policy.viewOnly,
    watermark: share.policy.watermark,
  };
}

export function toAuditReport(
  share: ShareRecord,
  recipients: Array<RecipientStatusRow & { id: string }>,
  entries: AuditEntryRecord[],
  signedAtByRecipient: Map<string, string>,
  entriesHaveMore: boolean,
): AuditReportDto {
  const recipientDtos: RecipientStatusDto[] = recipients.map((r) => ({
    linkId: r.link_id,
    emailHint: r.email_hint,
    viewsRemaining: r.views_remaining,
    verifiedAt: r.verified_at,
    revoked: r.revoked,
    signedAt: signedAtByRecipient.get(r.id) ?? null,
  }));
  return {
    share: toManagedShare(share),
    recipients: recipientDtos,
    entries: entries.map((e) => ({
      ts: e.ts,
      ipHash: e.ipHash,
      userAgent: e.userAgent,
      action: e.action,
      result: e.result,
      emailHint: e.emailHint,
    })),
    entriesNextCursor:
      entriesHaveMore && entries.length > 0 ? entries[entries.length - 1].ts : null,
  };
}

export function toSigningEnvelopes(signatures: SignatureRecord[]) {
  return signatures.map((s) => ({
    encryptedEnvelope: s.encryptedEnvelope,
    signedAt: s.signedAt,
    emailHint: s.emailHint,
  }));
}
