/**
 * Share policy validation (SPEC §4). All fields arrive from the client, so
 * everything is checked. `recipients` is returned separately — it drives row
 * creation (per-recipient links), it is never stored inside the policy JSON.
 */
import type { KdfParams } from "@/lib/crypto";
import { isValidEmail, normalizeEmail } from "./email";
import { ApiError } from "./http";
import { BASE64URL_RE, base64UrlByteLength } from "./validation";
import { BLOB_PATH_RE } from "./tokens";
import { MAX_ENCRYPTED_METADATA_BYTES } from "./supabase";

export const EXPIRY_OPTIONS: Record<string, number> = {
  "1h": 60 * 60,
  "24h": 24 * 60 * 60,
  "7d": 7 * 24 * 60 * 60,
  "30d": 30 * 24 * 60 * 60,
};

const MAX_VIEWS_CAP = 100;
export const MAX_RECIPIENTS = 20;
const WRAPPED_CEK_BYTES = 60; // 12 nonce + 32 key + 16 tag
const KDF_SALT_BYTES = 16;

export interface SharePolicy {
  expiresIn: keyof typeof EXPIRY_OPTIONS;
  maxViews: number | null;
  password: boolean;
  requireIdentity: boolean; // server-enforced email OTP gate
  requireSignature: boolean; // cryptographic ECDSA envelope + server-attested identity
  viewOnly: boolean; // client-honored: no download affordance
  watermark: boolean; // client-honored: burned into the rendered canvas
  notifyEmail: string | null; // notify-on-open target (sender-provided)
}

export interface ValidatedCreateShare {
  ciphertextRef: string;
  encryptedMetadata: string; // base64url
  wrappedCek: string | null;
  kdfSalt: string | null;
  kdfParams: KdfParams | null;
  policy: SharePolicy;
  /** Normalized, deduplicated recipient emails (empty unless requireIdentity). */
  recipients: string[];
  expiresAt: Date;
}


function requireBase64Url(value: unknown, field: string, exactBytes?: number): string {
  if (typeof value !== "string" || value.length === 0 || !BASE64URL_RE.test(value)) {
    throw new ApiError(400, `${field} must be a base64url string`);
  }
  if (exactBytes !== undefined && base64UrlByteLength(value) !== exactBytes) {
    throw new ApiError(400, `${field} has unexpected length`);
  }
  return value;
}

// Mirrors the client-side validateKdfParams bounds without importing the
// browser crypto module (which drags hash-wasm into the server bundle).
function validateKdfParams(value: unknown): KdfParams {
  const p = value as Record<string, unknown>;
  const ok =
    typeof p === "object" &&
    p !== null &&
    p.algorithm === "argon2id" &&
    p.version === 19 &&
    Number.isInteger(p.iterations) &&
    (p.iterations as number) >= 1 &&
    (p.iterations as number) <= 64 &&
    Number.isInteger(p.memorySize) &&
    (p.memorySize as number) <= 1 << 20 &&
    Number.isInteger(p.parallelism) &&
    (p.parallelism as number) >= 1 &&
    (p.parallelism as number) <= 16 &&
    (p.memorySize as number) >= 8 * (p.parallelism as number) &&
    Number.isInteger(p.hashLength) &&
    (p.hashLength as number) >= 16 &&
    (p.hashLength as number) <= 64;
  if (!ok) throw new ApiError(400, "kdfParams out of range");
  return {
    algorithm: "argon2id",
    version: p.version as number,
    iterations: p.iterations as number,
    memorySize: p.memorySize as number,
    parallelism: p.parallelism as number,
    hashLength: p.hashLength as number,
  };
}

function parseRecipients(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ApiError(400, "requireIdentity needs at least one recipient email");
  }
  if (value.length > MAX_RECIPIENTS) {
    throw new ApiError(400, `At most ${MAX_RECIPIENTS} recipients per share`);
  }
  const normalized = new Set<string>();
  for (const entry of value) {
    const trimmed = typeof entry === "string" ? entry.trim() : entry;
    if (!isValidEmail(trimmed)) {
      throw new ApiError(400, "recipients must be valid email addresses");
    }
    normalized.add(normalizeEmail(trimmed));
  }
  return [...normalized];
}

export function parseCreateShare(body: Record<string, unknown>): ValidatedCreateShare {
  const ciphertextRef = body.ciphertextRef;
  if (typeof ciphertextRef !== "string" || !BLOB_PATH_RE.test(ciphertextRef)) {
    throw new ApiError(400, "ciphertextRef is not a valid blob path");
  }

  const encryptedMetadata = requireBase64Url(body.encryptedMetadata, "encryptedMetadata");
  if (base64UrlByteLength(encryptedMetadata) > MAX_ENCRYPTED_METADATA_BYTES) {
    throw new ApiError(400, "encryptedMetadata too large");
  }

  const hasWrap = body.wrappedCek !== undefined && body.wrappedCek !== null;
  const hasSalt = body.kdfSalt !== undefined && body.kdfSalt !== null;
  const hasParams = body.kdfParams !== undefined && body.kdfParams !== null;
  if (hasWrap !== hasSalt || hasWrap !== hasParams) {
    throw new ApiError(400, "wrappedCek, kdfSalt and kdfParams must be provided together");
  }
  const wrappedCek = hasWrap
    ? requireBase64Url(body.wrappedCek, "wrappedCek", WRAPPED_CEK_BYTES)
    : null;
  const kdfSalt = hasWrap ? requireBase64Url(body.kdfSalt, "kdfSalt", KDF_SALT_BYTES) : null;
  const kdfParams = hasWrap ? validateKdfParams(body.kdfParams) : null;

  const rawPolicy = body.policy;
  if (typeof rawPolicy !== "object" || rawPolicy === null) {
    throw new ApiError(400, "policy is required");
  }
  const p = rawPolicy as Record<string, unknown>;

  if (typeof p.expiresIn !== "string" || !(p.expiresIn in EXPIRY_OPTIONS)) {
    throw new ApiError(
      400,
      `policy.expiresIn must be one of ${Object.keys(EXPIRY_OPTIONS).join(", ")}`,
    );
  }
  if (
    p.maxViews !== null &&
    p.maxViews !== undefined &&
    (!Number.isInteger(p.maxViews) || (p.maxViews as number) < 1 || (p.maxViews as number) > MAX_VIEWS_CAP)
  ) {
    throw new ApiError(400, `policy.maxViews must be null or an integer 1..${MAX_VIEWS_CAP}`);
  }
  for (const flag of ["requireIdentity", "requireSignature", "viewOnly", "watermark"] as const) {
    if (p[flag] !== undefined && typeof p[flag] !== "boolean") {
      throw new ApiError(400, `policy.${flag} must be a boolean`);
    }
  }
  if (p.requireSignature === true && p.requireIdentity !== true) {
    // A signature without a verified signer is close to meaningless.
    throw new ApiError(400, "requireSignature needs requireIdentity");
  }
  if (p.notifyEmail !== undefined && p.notifyEmail !== null && !isValidEmail(p.notifyEmail)) {
    throw new ApiError(400, "policy.notifyEmail must be a valid email address");
  }

  const requireIdentity = p.requireIdentity === true;
  const recipients = requireIdentity ? parseRecipients(body.recipients) : [];

  return {
    ciphertextRef,
    encryptedMetadata,
    wrappedCek,
    kdfSalt,
    kdfParams,
    policy: {
      expiresIn: p.expiresIn as keyof typeof EXPIRY_OPTIONS,
      maxViews: (p.maxViews as number | undefined) ?? null,
      password: wrappedCek !== null,
      requireIdentity,
      requireSignature: p.requireSignature === true,
      viewOnly: p.viewOnly === true,
      watermark: p.watermark === true,
      notifyEmail: (p.notifyEmail as string | undefined) ? normalizeEmail(p.notifyEmail as string) : null,
    },
    recipients,
    expiresAt: new Date(Date.now() + EXPIRY_OPTIONS[p.expiresIn] * 1000),
  };
}
