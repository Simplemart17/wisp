/**
 * Wisp crypto core — Phase 0 (SPEC §3, §11).
 *
 * Everything in this module runs in the browser (and in Node for tests).
 * Nothing here performs I/O: callers upload/download the opaque byte blobs
 * and keep `linkKey` in the URL fragment, which never reaches a server.
 */
import { fromBase64Url, toBase64Url } from "./encoding";
import { WispCryptoError } from "./errors";
import { DEFAULT_CHUNK_SIZE, decryptContent, encryptContent } from "./content";
import { type KdfParams, createShareSecrets, recoverCek } from "./keys";
import { type ShareMetadata, decryptMetadata, encryptMetadata } from "./metadata";

export { toBase64Url, fromBase64Url, concatBytes, randomBytes } from "./encoding";
export { WispCryptoError, type WispCryptoErrorCode } from "./errors";
export {
  KEY_LENGTH,
  KDF_SALT_LENGTH,
  DEFAULT_KDF_PARAMS,
  type KdfParams,
  type ShareSecrets,
  createShareSecrets,
  recoverCek,
  validateKdfParams,
} from "./keys";
export {
  CONTENT_FORMAT_VERSION,
  DEFAULT_CHUNK_SIZE,
  MAX_CHUNK_SIZE,
  ChunkEncryptor,
  ChunkDecryptor,
  encryptContent,
  decryptContent,
} from "./content";
export { type ShareMetadata, encryptMetadata, decryptMetadata } from "./metadata";

/** Client-side result of preparing a share: upload the blobs, keep the fragment. */
export interface EncryptedShare {
  /** Base64url link-key for the URL fragment (`/s/<id>#<linkKey>`). Never uploaded. */
  linkKey: string;
  /** Chunked AES-GCM blob → private Storage bucket (`ciphertext_ref`). */
  ciphertext: Uint8Array;
  /** → `shares.encrypted_metadata`. */
  encryptedMetadata: Uint8Array;
  /** → `shares.wrapped_cek` (null when no password). */
  wrappedCek: Uint8Array | null;
  /** → `shares.kdf_salt`. */
  kdfSalt: Uint8Array | null;
  /** → `shares.kdf_params`. */
  kdfParams: KdfParams | null;
}

export interface CreateShareInput {
  data: Uint8Array;
  metadata: ShareMetadata;
  password?: string;
  chunkSize?: number;
  kdfParams?: KdfParams;
}

/** Sender side: encrypt content + metadata and produce the fragment secret. */
export async function createEncryptedShare(input: CreateShareInput): Promise<EncryptedShare> {
  const secrets = await createShareSecrets(input.password, input.kdfParams);
  const chunkSize = input.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const [ciphertext, encryptedMetadata] = await Promise.all([
    encryptContent(secrets.cek, input.data, chunkSize),
    encryptMetadata(secrets.cek, input.metadata),
  ]);
  return {
    linkKey: toBase64Url(secrets.linkKey),
    ciphertext,
    encryptedMetadata,
    wrappedCek: secrets.wrappedCek,
    kdfSalt: secrets.kdfSalt,
    kdfParams: secrets.kdfParams,
  };
}

export interface OpenShareInput {
  /** Base64url link-key taken from the URL fragment. */
  linkKey: string;
  ciphertext: Uint8Array;
  encryptedMetadata: Uint8Array;
  /** Server-stored wrap record; present only for password shares. */
  wrappedCek?: Uint8Array | null;
  kdfSalt?: Uint8Array | null;
  kdfParams?: KdfParams | null;
  password?: string;
}

export interface OpenedShare {
  data: Uint8Array;
  metadata: ShareMetadata;
}

/** Recipient side: rebuild the CEK and decrypt everything locally. */
export async function openEncryptedShare(input: OpenShareInput): Promise<OpenedShare> {
  let linkKey: Uint8Array;
  try {
    linkKey = fromBase64Url(input.linkKey);
  } catch {
    throw new WispCryptoError("INVALID_FORMAT", "Link key is not valid base64url");
  }
  const cek = await recoverCek({
    linkKey,
    wrappedCek: input.wrappedCek,
    kdfSalt: input.kdfSalt,
    kdfParams: input.kdfParams,
    password: input.password,
  });
  const metadata = await decryptMetadata(cek, input.encryptedMetadata);
  const data = await decryptContent(cek, input.ciphertext);
  return { data, metadata };
}
