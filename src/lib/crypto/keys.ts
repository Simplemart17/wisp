/**
 * Wisp secret model (SPEC §3).
 *
 * - A random 256-bit link-key travels in the URL fragment and never reaches
 *   the server.
 * - Without a password, the CEK is derived from the link-key alone (HKDF), so
 *   nothing key-related is stored server-side (`wrapped_cek` is null).
 * - With a password, the CEK is random and wrapped under a KEK derived from
 *   BOTH the link-key and Argon2id(password). The server stores only
 *   `wrapped_cek` + `kdf_salt` + `kdf_params`; neither a leaked link nor a
 *   known password alone can recover the CEK.
 */
import { argon2id } from "hash-wasm";

import { concatBytes, randomBytes, utf8Encode } from "./encoding";
import { WispCryptoError } from "./errors";

export const KEY_LENGTH = 32;
export const KDF_SALT_LENGTH = 16;
export const GCM_NONCE_LENGTH = 12;
export const GCM_TAG_LENGTH = 16;

const INFO_CEK = "wisp/v1/cek";
const INFO_KEK = "wisp/v1/kek";
const INFO_CONTENT_KEY = "wisp/v1/content-key";
const INFO_META_KEY = "wisp/v1/meta-key";
const AAD_WRAP = utf8Encode("wisp/v1/wrap");

export interface KdfParams {
  algorithm: "argon2id";
  version: number; // argon2 version (19 = 0x13)
  iterations: number;
  memorySize: number; // KiB
  parallelism: number;
  hashLength: number; // bytes
}

export const DEFAULT_KDF_PARAMS: KdfParams = {
  algorithm: "argon2id",
  version: 19,
  iterations: 3,
  memorySize: 65536, // 64 MiB
  parallelism: 4,
  hashLength: 32,
};

// Bounds accepted at decrypt time. kdf_params come from the server, so a
// hostile record must not be able to OOM the recipient's tab (huge memory)
// or silently weaken the KDF below sane floors.
const KDF_LIMITS = {
  minIterations: 1,
  maxIterations: 64,
  maxMemorySize: 1 << 20, // 1 GiB in KiB
  maxParallelism: 16,
  minHashLength: 16,
  maxHashLength: 64,
};

export function validateKdfParams(params: KdfParams): void {
  const ok =
    params.algorithm === "argon2id" &&
    params.version === 19 &&
    Number.isInteger(params.iterations) &&
    params.iterations >= KDF_LIMITS.minIterations &&
    params.iterations <= KDF_LIMITS.maxIterations &&
    Number.isInteger(params.memorySize) &&
    params.memorySize >= 8 * params.parallelism &&
    params.memorySize <= KDF_LIMITS.maxMemorySize &&
    Number.isInteger(params.parallelism) &&
    params.parallelism >= 1 &&
    params.parallelism <= KDF_LIMITS.maxParallelism &&
    Number.isInteger(params.hashLength) &&
    params.hashLength >= KDF_LIMITS.minHashLength &&
    params.hashLength <= KDF_LIMITS.maxHashLength;
  if (!ok) {
    throw new WispCryptoError("INVALID_FORMAT", "Unsupported or out-of-range KDF parameters");
  }
}

async function hkdf(ikm: Uint8Array, info: string, length = KEY_LENGTH): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm as BufferSource, "HKDF", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: utf8Encode(info) },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

export async function importAesKey(
  raw: Uint8Array,
  usages: KeyUsage[] = ["encrypt", "decrypt"],
): Promise<CryptoKey> {
  if (raw.length !== KEY_LENGTH) {
    throw new WispCryptoError("INVALID_FORMAT", `AES key must be ${KEY_LENGTH} bytes`);
  }
  return crypto.subtle.importKey("raw", raw as BufferSource, { name: "AES-GCM" }, false, usages);
}

/** Subkey for content chunks — domain-separated from the metadata subkey. */
export function deriveContentKeyBytes(cek: Uint8Array): Promise<Uint8Array> {
  return hkdf(cek, INFO_CONTENT_KEY);
}

/** Subkey for the encrypted filename/size/type record. */
export function deriveMetaKeyBytes(cek: Uint8Array): Promise<Uint8Array> {
  return hkdf(cek, INFO_META_KEY);
}

async function deriveArgon2Key(
  password: string,
  salt: Uint8Array,
  params: KdfParams,
): Promise<Uint8Array> {
  validateKdfParams(params);
  const out = await argon2id({
    password,
    salt,
    iterations: params.iterations,
    parallelism: params.parallelism,
    memorySize: params.memorySize,
    hashLength: params.hashLength,
    outputType: "binary",
  });
  return out as Uint8Array;
}

/** Everything created client-side when a share is made. */
export interface ShareSecrets {
  /** Fragment secret — goes after `#` in the URL, never uploaded. */
  linkKey: Uint8Array;
  /** Content encryption key — never uploaded, never persisted. */
  cek: Uint8Array;
  /** Uploaded to the server; null when the share has no password. */
  wrappedCek: Uint8Array | null;
  kdfSalt: Uint8Array | null;
  kdfParams: KdfParams | null;
}

export async function createShareSecrets(
  password?: string,
  kdfParams: KdfParams = DEFAULT_KDF_PARAMS,
): Promise<ShareSecrets> {
  const linkKey = randomBytes(KEY_LENGTH);

  if (!password) {
    const cek = await hkdf(linkKey, INFO_CEK);
    return { linkKey, cek, wrappedCek: null, kdfSalt: null, kdfParams: null };
  }

  const cek = randomBytes(KEY_LENGTH);
  const kdfSalt = randomBytes(KDF_SALT_LENGTH);
  const argonKey = await deriveArgon2Key(password, kdfSalt, kdfParams);
  const kekBytes = await hkdf(concatBytes(linkKey, argonKey), INFO_KEK);
  const kek = await importAesKey(kekBytes, ["encrypt"]);

  const nonce = randomBytes(GCM_NONCE_LENGTH);
  const wrapped = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce as BufferSource, additionalData: AAD_WRAP as BufferSource },
      kek,
      cek as BufferSource,
    ),
  );
  return { linkKey, cek, wrappedCek: concatBytes(nonce, wrapped), kdfSalt, kdfParams };
}

export interface RecoverCekInput {
  linkKey: Uint8Array;
  wrappedCek?: Uint8Array | null;
  kdfSalt?: Uint8Array | null;
  kdfParams?: KdfParams | null;
  password?: string;
}

/**
 * Recipient side: rebuild the CEK from the fragment link-key plus, when the
 * share is password-protected, the password and the server-stored wrap record.
 */
export async function recoverCek(input: RecoverCekInput): Promise<Uint8Array> {
  if (input.linkKey.length !== KEY_LENGTH) {
    throw new WispCryptoError("INVALID_FORMAT", `Link key must be ${KEY_LENGTH} bytes`);
  }

  if (!input.wrappedCek || input.wrappedCek.length === 0) {
    return hkdf(input.linkKey, INFO_CEK);
  }

  if (!input.password) {
    throw new WispCryptoError("PASSWORD_REQUIRED", "This share requires a password");
  }
  if (!input.kdfSalt || !input.kdfParams) {
    throw new WispCryptoError("INVALID_FORMAT", "Password share is missing KDF salt or params");
  }
  if (input.wrappedCek.length !== GCM_NONCE_LENGTH + KEY_LENGTH + GCM_TAG_LENGTH) {
    throw new WispCryptoError("INVALID_FORMAT", "Wrapped key has unexpected length");
  }

  const argonKey = await deriveArgon2Key(input.password, input.kdfSalt, input.kdfParams);
  const kekBytes = await hkdf(concatBytes(input.linkKey, argonKey), INFO_KEK);
  const kek = await importAesKey(kekBytes, ["decrypt"]);

  const nonce = input.wrappedCek.slice(0, GCM_NONCE_LENGTH);
  const sealed = input.wrappedCek.slice(GCM_NONCE_LENGTH);
  try {
    const cek = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonce as BufferSource, additionalData: AAD_WRAP as BufferSource },
      kek,
      sealed as BufferSource,
    );
    return new Uint8Array(cek);
  } catch {
    throw new WispCryptoError(
      "DECRYPT_FAILED",
      "Could not unlock the key — wrong password, wrong link, or corrupted data",
    );
  }
}
