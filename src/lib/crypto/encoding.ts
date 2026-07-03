/**
 * Byte/string helpers shared across the crypto core.
 *
 * Base64url (RFC 4648 §5, unpadded) is the wire encoding for anything that
 * travels in a URL — most importantly the link-key in the URL fragment.
 */

const BASE64URL_RE = /^[A-Za-z0-9_-]*$/;

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(text: string): Uint8Array {
  if (!BASE64URL_RE.test(text)) {
    throw new Error("Invalid base64url string");
  }
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function utf8Encode(text: string): Uint8Array<ArrayBuffer> {
  return textEncoder.encode(text) as Uint8Array<ArrayBuffer>;
}

export function utf8Decode(bytes: Uint8Array): string {
  return textDecoder.decode(bytes);
}

export function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

// getRandomValues rejects requests over 65536 bytes, so fill in slabs.
const RANDOM_SLAB = 65536;

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let offset = 0; offset < length; offset += RANDOM_SLAB) {
    crypto.getRandomValues(bytes.subarray(offset, offset + RANDOM_SLAB));
  }
  return bytes;
}
