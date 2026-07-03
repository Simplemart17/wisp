/**
 * Browser-side share flows: all crypto happens here (via the crypto core);
 * the API only ever sees ciphertext, wrap records and policy.
 */
import { type KdfParams, type ShareMetadata, fromBase64Url, toBase64Url } from "@/lib/crypto";
import { createEncryptedShareFromBlob, openEncryptedShareBlob } from "./stream-crypto";

export class ShareApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly kind: string | null,
    message: string,
  ) {
    super(message);
    this.name = "ShareApiError";
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    let kind: string | null = null;
    try {
      const body = (await res.json()) as { error?: string; kind?: string | null };
      if (body.error) message = body.error;
      kind = body.kind ?? null;
    } catch {
      // non-JSON error body — keep defaults
    }
    throw new ShareApiError(res.status, kind, message);
  }
  return (await res.json()) as T;
}

function postJson<T>(url: string, body: unknown, headers?: Record<string, string>): Promise<T> {
  return requestJson<T>(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

export type CreateStep = "encrypting" | "uploading" | "registering" | "notifying";

export interface CreateShareOptions {
  /** File/Blob sources are encrypted chunk-by-chunk — never fully in memory. */
  data: Uint8Array | Blob;
  metadata: ShareMetadata;
  password?: string;
  expiresIn: string;
  maxViews: number | null;
  requireIdentity?: boolean;
  recipients?: string[];
  viewOnly?: boolean;
  watermark?: boolean;
  notifyEmail?: string | null;
  /** Email each recipient their unique link after creation (identity shares). */
  sendEmails?: boolean;
  onStep?: (step: CreateStep) => void;
}

export interface RecipientLink {
  email: string;
  url: string;
}

export interface ShareReceipt {
  id: string;
  shareUrl: string;
  manageUrl: string;
  /** Per-recipient links (identity shares) — the share id differs per person. */
  recipientLinks: RecipientLink[];
  emailsSent: number;
}

export async function createShareFlow(options: CreateShareOptions): Promise<ShareReceipt> {
  options.onStep?.("encrypting");
  const source =
    options.data instanceof Blob ? options.data : new Blob([options.data as BlobPart]);
  const encrypted = await createEncryptedShareFromBlob({
    source,
    metadata: options.metadata,
    password: options.password || undefined,
  });

  options.onStep?.("uploading");
  const upload = await postJson<{ path: string; url: string }>("/api/uploads", {
    size: encrypted.ciphertext.size,
  });
  const put = await fetch(upload.url, {
    method: "PUT",
    headers: { "content-type": "application/octet-stream" },
    body: encrypted.ciphertext,
  });
  if (!put.ok) {
    throw new ShareApiError(put.status, null, "Uploading the encrypted content failed");
  }

  options.onStep?.("registering");
  const created = await postJson<{
    id: string;
    managementToken: string;
    recipientLinks: Array<{ email: string; linkId: string }>;
  }>("/api/shares", {
    ciphertextRef: upload.path,
    encryptedMetadata: toBase64Url(encrypted.encryptedMetadata),
    wrappedCek: encrypted.wrappedCek ? toBase64Url(encrypted.wrappedCek) : null,
    kdfSalt: encrypted.kdfSalt ? toBase64Url(encrypted.kdfSalt) : null,
    kdfParams: encrypted.kdfParams,
    policy: {
      expiresIn: options.expiresIn,
      maxViews: options.maxViews,
      requireIdentity: options.requireIdentity === true,
      viewOnly: options.viewOnly === true,
      watermark: options.watermark === true,
      notifyEmail: options.notifyEmail || null,
    },
    recipients: options.recipients ?? [],
  });

  const origin = window.location.origin;
  const recipientLinks = created.recipientLinks.map((r) => ({
    email: r.email,
    url: `${origin}/s/${r.linkId}#${encrypted.linkKey}`,
  }));

  let emailsSent = 0;
  if (options.sendEmails && recipientLinks.length > 0) {
    options.onStep?.("notifying");
    const sent = await postJson<{ sent: number }>(
      `/api/shares/${created.id}/send-links`,
      { links: recipientLinks },
      { "x-management-token": created.managementToken },
    );
    emailsSent = sent.sent;
  }

  return {
    id: created.id,
    shareUrl: `${origin}/s/${created.id}#${encrypted.linkKey}`,
    manageUrl: `${origin}/manage/${created.id}#${created.managementToken}`,
    recipientLinks,
    emailsSent,
  };
}

export interface ShareStatus {
  requiresPassword: boolean;
  requiresIdentity: boolean;
  expired: boolean;
  exhausted: boolean;
}

export function fetchShareStatus(id: string): Promise<ShareStatus> {
  return requestJson<ShareStatus>(`/api/shares/${id}`);
}

/** Ask the server to email a one-time code (identity shares). Always "ok". */
export async function requestOtp(id: string, email: string): Promise<void> {
  await postJson<{ ok: boolean }>(`/api/shares/${id}/otp`, { email });
}

export interface WatermarkPayload {
  email: string | null;
  ipHash: string;
  accessId: number | null;
  linkId: string;
}

/**
 * Everything needed to decrypt, fetched in one go. Kept by the viewer so a
 * mistyped password can be retried WITHOUT consuming another view.
 */
export interface AccessedShare {
  ciphertext: Blob;
  encryptedMetadata: Uint8Array;
  wrappedCek: Uint8Array | null;
  kdfSalt: Uint8Array | null;
  kdfParams: KdfParams | null;
  remainingViews: number | null;
  viewOnly: boolean;
  watermark: WatermarkPayload | null;
}

export interface AccessCredentials {
  email?: string;
  code?: string;
}

export async function accessShare(id: string, credentials?: AccessCredentials): Promise<AccessedShare> {
  const payload = await postJson<{
    url: string;
    encryptedMetadata: string;
    wrappedCek: string | null;
    kdfSalt: string | null;
    kdfParams: KdfParams | null;
    remainingViews: number | null;
    viewOnly: boolean;
    watermark: WatermarkPayload | null;
  }>(`/api/shares/${id}/access`, credentials ?? {});

  const blobRes = await fetch(payload.url);
  if (!blobRes.ok) {
    throw new ShareApiError(blobRes.status, null, "Downloading the encrypted content failed");
  }
  return {
    ciphertext: await blobRes.blob(),
    encryptedMetadata: fromBase64Url(payload.encryptedMetadata),
    wrappedCek: payload.wrappedCek ? fromBase64Url(payload.wrappedCek) : null,
    kdfSalt: payload.kdfSalt ? fromBase64Url(payload.kdfSalt) : null,
    kdfParams: payload.kdfParams,
    remainingViews: payload.remainingViews,
    viewOnly: payload.viewOnly,
    watermark: payload.watermark,
  };
}

export interface OpenedShare {
  /** Decrypted content as a typed Blob (never one giant contiguous buffer). */
  blob: Blob;
  metadata: ShareMetadata;
}

/** Local decryption only — safe to retry with a corrected password. */
export function decryptAccessedShare(
  accessed: AccessedShare,
  linkKey: string,
  password?: string,
): Promise<OpenedShare> {
  return openEncryptedShareBlob({
    linkKey,
    ciphertext: accessed.ciphertext,
    encryptedMetadata: accessed.encryptedMetadata,
    wrappedCek: accessed.wrappedCek,
    kdfSalt: accessed.kdfSalt,
    kdfParams: accessed.kdfParams,
    password,
  });
}

export interface AuditEntry {
  ts: string;
  ip_hash: string | null;
  user_agent: string | null;
  action: string;
  result: string;
  recipients: { email_hint: string | null } | null;
}

export interface RecipientStatus {
  link_id: string;
  email_hint: string | null;
  views_remaining: number | null;
  verified_at: string | null;
  revoked: boolean;
}

export interface AuditReport {
  share: {
    id: string;
    createdAt: string;
    expiresAt: string | null;
    expired: boolean;
    exhausted: boolean;
    remainingViews: number | null;
    requiresPassword: boolean;
    requiresIdentity: boolean;
    viewOnly: boolean;
    watermark: boolean;
  };
  recipients: RecipientStatus[];
  entries: AuditEntry[];
}

/** Without a token, the request rides on the Clerk session cookie (owners). */
export function fetchAudit(id: string, managementToken?: string): Promise<AuditReport> {
  return requestJson<AuditReport>(`/api/shares/${id}/audit`, {
    headers: managementToken ? { "x-management-token": managementToken } : undefined,
  });
}

export async function revokeShare(id: string, managementToken?: string, linkId?: string): Promise<void> {
  await postJson<{ ok: boolean }>(
    `/api/shares/${id}/revoke`,
    linkId ? { linkId } : {},
    managementToken ? { "x-management-token": managementToken } : undefined,
  );
}
