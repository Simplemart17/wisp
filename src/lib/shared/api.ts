/**
 * Wire contracts shared by the Route Handlers (producers) and the client
 * (consumers), so the two can't drift on field names or shapes. All camelCase
 * — no database column names cross the network.
 */
import type { KdfParams } from "@/lib/crypto";

// ── Status / access ─────────────────────────────────────────────────────────

export interface ShareStatusDto {
  requiresPassword: boolean;
  requiresIdentity: boolean;
  expired: boolean;
  exhausted: boolean;
  /** Whether opening consumes one of a limited number of views (never the count). */
  hasViewLimit: boolean;
}

export interface WatermarkDto {
  email: string | null;
  ipHash: string;
  accessId: number | null;
  linkId: string;
}

export interface SignatureRecordDto {
  encryptedEnvelope: string | null; // base64url, sealed under the CEK subkey
  signedAt: string;
  emailHint: string | null;
}

export interface SigningStateDto {
  required: boolean;
  /** Single-use ticket for THIS recipient; null when not theirs to sign. */
  ticket: string | null;
  alreadySigned: boolean;
  envelopes: SignatureRecordDto[];
}

export interface AccessResponseDto {
  url: string;
  encryptedMetadata: string; // base64url
  wrappedCek: string | null;
  kdfSalt: string | null;
  kdfParams: KdfParams | null;
  remainingViews: number | null;
  signing: SigningStateDto | null;
  viewOnly: boolean;
  watermark: WatermarkDto | null;
}

// ── Create ──────────────────────────────────────────────────────────────────

export interface CreateShareResponseDto {
  id: string;
  managementToken: string;
  recipientLinks: Array<{ email: string; linkId: string }>;
}

// ── Audit / manage ──────────────────────────────────────────────────────────

export interface AuditEntryDto {
  ts: string;
  ipHash: string | null;
  userAgent: string | null;
  action: string;
  result: string;
  /** Verified recipient this event belongs to (identity shares). */
  emailHint: string | null;
}

export interface RecipientStatusDto {
  linkId: string;
  emailHint: string | null;
  viewsRemaining: number | null;
  verifiedAt: string | null;
  revoked: boolean;
  signedAt: string | null;
}

export interface ManagedShareDto {
  id: string;
  createdAt: string;
  expiresAt: string | null;
  expired: boolean;
  exhausted: boolean;
  remainingViews: number | null;
  requiresPassword: boolean;
  requiresIdentity: boolean;
  requiresSignature: boolean;
  viewOnly: boolean;
  watermark: boolean;
}

export interface AuditReportDto {
  share: ManagedShareDto;
  recipients: RecipientStatusDto[];
  entries: AuditEntryDto[];
  /** Pass as ?before= to fetch the next (older) page; null = no more. */
  entriesNextCursor: string | null;
}

// ── My shares (dashboard) ────────────────────────────────────────────────────

export interface MyShareDto {
  id: string;
  createdAt: string;
  expiresAt: string | null;
  expired: boolean;
  policy: {
    maxViews: number | null;
    password: boolean;
    requireIdentity: boolean;
    viewOnly: boolean;
    watermark: boolean;
  };
}

export interface MySharesResponseDto {
  shares: MyShareDto[];
  /** Pass as ?before= to fetch the next (older) page; null = no more. */
  nextCursor: string | null;
}
