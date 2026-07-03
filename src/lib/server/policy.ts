/**
 * Share policy validation (SPEC §4 — Phase 1 subset: expiry, view limit,
 * password). All fields arrive from the client, so everything is checked.
 */
import { ApiError } from "./http";
import { BLOB_PATH_RE } from "./tokens";
import { MAX_ENCRYPTED_METADATA_BYTES } from "./supabase";

export const EXPIRY_OPTIONS: Record<string, number> = {
  "1h": 60 * 60,
  "24h": 24 * 60 * 60,
  "7d": 7 * 24 * 60 * 60,
  "30d": 30 * 24 * 60 * 60,
};

const MAX_VIEWS_CAP = 100;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
const WRAPPED_CEK_BYTES = 60; // 12 nonce + 32 key + 16 tag
const KDF_SALT_BYTES = 16;

export interface SharePolicy {
  expiresIn: keyof typeof EXPIRY_OPTIONS;
  maxViews: number | null;
  password: boolean;
}

export interface ValidatedCreateShare {
  ciphertextRef: string;
  encryptedMetadata: string; // base64url
  wrappedCek: string | null;
  kdfSalt: string | null;
  kdfParams: Record<string, unknown> | null;
  policy: SharePolicy;
  expiresAt: Date;
}

function base64UrlByteLength(value: string): number {
  return Math.floor((value.length * 3) / 4);
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
function validateKdfParams(value: unknown): Record<string, unknown> {
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
    algorithm: p.algorithm,
    version: p.version,
    iterations: p.iterations,
    memorySize: p.memorySize,
    parallelism: p.parallelism,
    hashLength: p.hashLength,
  };
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
  const { expiresIn, maxViews } = rawPolicy as Record<string, unknown>;
  if (typeof expiresIn !== "string" || !(expiresIn in EXPIRY_OPTIONS)) {
    throw new ApiError(400, `policy.expiresIn must be one of ${Object.keys(EXPIRY_OPTIONS).join(", ")}`);
  }
  if (
    maxViews !== null &&
    maxViews !== undefined &&
    (!Number.isInteger(maxViews) || (maxViews as number) < 1 || (maxViews as number) > MAX_VIEWS_CAP)
  ) {
    throw new ApiError(400, `policy.maxViews must be null or an integer 1..${MAX_VIEWS_CAP}`);
  }

  return {
    ciphertextRef,
    encryptedMetadata,
    wrappedCek,
    kdfSalt,
    kdfParams,
    policy: {
      expiresIn: expiresIn as keyof typeof EXPIRY_OPTIONS,
      maxViews: (maxViews as number | undefined) ?? null,
      password: wrappedCek !== null,
    },
    expiresAt: new Date(Date.now() + EXPIRY_OPTIONS[expiresIn] * 1000),
  };
}
