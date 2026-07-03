export type WispCryptoErrorCode =
  | "INVALID_FORMAT" // malformed blob, bad header, wrong lengths
  | "UNSUPPORTED_VERSION" // format version this client doesn't understand
  | "PASSWORD_REQUIRED" // share is password-protected but none was supplied
  | "DECRYPT_FAILED"; // auth tag mismatch: wrong key/password or tampered data

/**
 * All failures in the crypto core throw this, with a machine-readable code.
 *
 * Note: AES-GCM cannot distinguish "wrong password", "wrong link-key" and
 * "tampered ciphertext" — all three surface as DECRYPT_FAILED. UI copy must
 * not over-claim which one happened.
 */
export class WispCryptoError extends Error {
  constructor(
    public readonly code: WispCryptoErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WispCryptoError";
  }
}
