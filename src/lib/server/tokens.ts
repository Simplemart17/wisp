/**
 * Server-side identifiers and token hashing (SPEC §10: store hashes, not raw
 * values, for management tokens and IPs; opaque high-entropy share ids).
 */
import { createHash, randomBytes as nodeRandomBytes, timingSafeEqual } from "node:crypto";

function base64Url(buf: Buffer): string {
  return buf.toString("base64url");
}

/** 96-bit opaque share id → 16 URL-safe chars. */
export function generateShareId(): string {
  return base64Url(nodeRandomBytes(12));
}

/** Unguessable path inside the private bucket. */
export function generateBlobPath(): string {
  return `blobs/${base64Url(nodeRandomBytes(18))}.bin`;
}

export const BLOB_PATH_RE = /^blobs\/[A-Za-z0-9_-]{24}\.bin$/;

/** 256-bit management secret, shown to the sender exactly once. */
export function generateManagementToken(): string {
  return base64Url(nodeRandomBytes(32));
}

export function sha256Base64Url(value: string): string {
  return base64Url(createHash("sha256").update(value).digest());
}

/** Constant-time check of a presented token against a stored hash. */
export function tokenMatchesHash(presented: string, storedHash: string): boolean {
  const presentedDigest = createHash("sha256").update(presented).digest();
  const stored = Buffer.from(storedHash, "base64url");
  return stored.length === presentedDigest.length && timingSafeEqual(presentedDigest, stored);
}

/** Salted, truncated IP hash for the audit log — attributable, not reversible. */
export function hashIp(ip: string): string {
  const salt = process.env.WISP_IP_SALT ?? "wisp-dev-salt";
  return base64Url(createHash("sha256").update(`${salt}:${ip}`).digest()).slice(0, 16);
}
