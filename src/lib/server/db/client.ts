/**
 * Low-level data-access primitives. Only the repository modules in this folder
 * import these — route handlers and services go through the repositories, so
 * supabase-js, PostgREST row shapes, and the bytea `\x`-hex transport never
 * leak past this boundary (and a non-Supabase backend could be swapped in
 * here without touching callers).
 */
export { wispDb, CIPHERTEXT_BUCKET } from "../supabase";

/** base64url → PostgREST bytea literal. */
export function toPgBytea(base64url: string): string {
  return `\\x${Buffer.from(base64url, "base64url").toString("hex")}`;
}

/** PostgREST bytea literal → base64url (null passes through). */
export function fromPgBytea(pgHex: string | null): string | null {
  if (pgHex === null) return null;
  if (!pgHex.startsWith("\\x")) throw new Error("Unexpected bytea encoding from PostgREST");
  return Buffer.from(pgHex.slice(2), "hex").toString("base64url");
}

/** Uniform wrapper so callers get a clear error instead of a raw PostgREST one. */
export function dbError(context: string, message: string | undefined): Error {
  return new Error(`${context}: ${message ?? "unknown error"}`);
}
