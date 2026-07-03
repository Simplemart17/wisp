/**
 * Shared server-side validation primitives, so the same rules aren't
 * re-expressed (and allowed to drift) across route handlers and helpers.
 */

/** Opaque share id: 96-bit token → 16 URL-safe base64url chars. */
export const SHARE_ID_RE = /^[A-Za-z0-9_-]{16}$/;

/** Unpadded base64url payload. */
export const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

/** Byte length an unpadded base64url string decodes to. */
export function base64UrlByteLength(value: string): number {
  return Math.floor((value.length * 3) / 4);
}
