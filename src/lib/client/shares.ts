/**
 * Browser-side share flows: all crypto happens here (via the crypto core);
 * the API only ever sees ciphertext, wrap records and policy.
 */
import {
  type KdfParams,
  type ShareMetadata,
  createEncryptedShare,
  fromBase64Url,
  openEncryptedShare,
  toBase64Url,
} from "@/lib/crypto";

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

function postJson<T>(url: string, body: unknown): Promise<T> {
  return requestJson<T>(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export type CreateStep = "encrypting" | "uploading" | "registering";

export interface CreateShareOptions {
  data: Uint8Array;
  metadata: ShareMetadata;
  password?: string;
  expiresIn: string;
  maxViews: number | null;
  onStep?: (step: CreateStep) => void;
}

export interface ShareReceipt {
  id: string;
  shareUrl: string;
  manageUrl: string;
}

export async function createShareFlow(options: CreateShareOptions): Promise<ShareReceipt> {
  options.onStep?.("encrypting");
  const encrypted = await createEncryptedShare({
    data: options.data,
    metadata: options.metadata,
    password: options.password || undefined,
  });

  options.onStep?.("uploading");
  const upload = await postJson<{ path: string; url: string }>("/api/uploads", {
    size: encrypted.ciphertext.length,
  });
  const put = await fetch(upload.url, {
    method: "PUT",
    headers: { "content-type": "application/octet-stream" },
    body: encrypted.ciphertext as unknown as BodyInit,
  });
  if (!put.ok) {
    throw new ShareApiError(put.status, null, "Uploading the encrypted content failed");
  }

  options.onStep?.("registering");
  const created = await postJson<{ id: string; managementToken: string }>("/api/shares", {
    ciphertextRef: upload.path,
    encryptedMetadata: toBase64Url(encrypted.encryptedMetadata),
    wrappedCek: encrypted.wrappedCek ? toBase64Url(encrypted.wrappedCek) : null,
    kdfSalt: encrypted.kdfSalt ? toBase64Url(encrypted.kdfSalt) : null,
    kdfParams: encrypted.kdfParams,
    policy: { expiresIn: options.expiresIn, maxViews: options.maxViews },
  });

  const origin = window.location.origin;
  return {
    id: created.id,
    shareUrl: `${origin}/s/${created.id}#${encrypted.linkKey}`,
    manageUrl: `${origin}/manage/${created.id}#${created.managementToken}`,
  };
}

export interface ShareStatus {
  requiresPassword: boolean;
  expired: boolean;
  exhausted: boolean;
}

export function fetchShareStatus(id: string): Promise<ShareStatus> {
  return requestJson<ShareStatus>(`/api/shares/${id}`);
}

/**
 * Everything needed to decrypt, fetched in one go. Kept by the viewer so a
 * mistyped password can be retried WITHOUT consuming another view.
 */
export interface AccessedShare {
  ciphertext: Uint8Array;
  encryptedMetadata: Uint8Array;
  wrappedCek: Uint8Array | null;
  kdfSalt: Uint8Array | null;
  kdfParams: KdfParams | null;
  remainingViews: number | null;
}

export async function accessShare(id: string): Promise<AccessedShare> {
  const payload = await postJson<{
    url: string;
    encryptedMetadata: string;
    wrappedCek: string | null;
    kdfSalt: string | null;
    kdfParams: KdfParams | null;
    remainingViews: number | null;
  }>(`/api/shares/${id}/access`, {});

  const blobRes = await fetch(payload.url);
  if (!blobRes.ok) {
    throw new ShareApiError(blobRes.status, null, "Downloading the encrypted content failed");
  }
  return {
    ciphertext: new Uint8Array(await blobRes.arrayBuffer()),
    encryptedMetadata: fromBase64Url(payload.encryptedMetadata),
    wrappedCek: payload.wrappedCek ? fromBase64Url(payload.wrappedCek) : null,
    kdfSalt: payload.kdfSalt ? fromBase64Url(payload.kdfSalt) : null,
    kdfParams: payload.kdfParams,
    remainingViews: payload.remainingViews,
  };
}

export interface OpenedShare {
  data: Uint8Array;
  metadata: ShareMetadata;
}

/** Local decryption only — safe to retry with a corrected password. */
export function decryptAccessedShare(
  accessed: AccessedShare,
  linkKey: string,
  password?: string,
): Promise<OpenedShare> {
  return openEncryptedShare({
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
  };
  entries: AuditEntry[];
}

export function fetchAudit(id: string, managementToken: string): Promise<AuditReport> {
  return requestJson<AuditReport>(`/api/shares/${id}/audit`, {
    headers: { "x-management-token": managementToken },
  });
}

export async function revokeShare(id: string, managementToken: string): Promise<void> {
  await requestJson<{ ok: boolean }>(`/api/shares/${id}/revoke`, {
    method: "POST",
    headers: { "x-management-token": managementToken },
  });
}
