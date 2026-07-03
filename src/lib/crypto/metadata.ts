/**
 * Encrypted share metadata (SPEC §3): filename, size and content-type are
 * sealed with a subkey of the CEK so the server never learns them.
 *
 *   blob = nonce(12) || AES-GCM(metaKey, nonce, utf8(JSON), aad="wisp/v1/meta")
 */
import { concatBytes, randomBytes, utf8Decode, utf8Encode } from "./encoding";
import { WispCryptoError } from "./errors";
import { GCM_NONCE_LENGTH, GCM_TAG_LENGTH, deriveMetaKeyBytes, importAesKey } from "./keys";

const AAD_META = utf8Encode("wisp/v1/meta");

export interface ShareMetadata {
  /** Original filename, or a caller-chosen title for text shares. */
  name: string;
  /** Plaintext size in bytes. */
  size: number;
  /** MIME type, e.g. "application/pdf" or "text/plain". */
  type: string;
}

function assertShareMetadata(value: unknown): asserts value is ShareMetadata {
  const meta = value as ShareMetadata;
  const ok =
    typeof meta === "object" &&
    meta !== null &&
    typeof meta.name === "string" &&
    typeof meta.type === "string" &&
    Number.isFinite(meta.size) &&
    meta.size >= 0;
  if (!ok) {
    throw new WispCryptoError("INVALID_FORMAT", "Decrypted metadata has unexpected shape");
  }
}

export async function encryptMetadata(
  cek: Uint8Array,
  metadata: ShareMetadata,
): Promise<Uint8Array> {
  const key = await importAesKey(await deriveMetaKeyBytes(cek), ["encrypt"]);
  const nonce = randomBytes(GCM_NONCE_LENGTH);
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce as BufferSource, additionalData: AAD_META as BufferSource },
    key,
    utf8Encode(JSON.stringify(metadata)) as BufferSource,
  );
  return concatBytes(nonce, new Uint8Array(sealed));
}

export async function decryptMetadata(cek: Uint8Array, blob: Uint8Array): Promise<ShareMetadata> {
  if (blob.length < GCM_NONCE_LENGTH + GCM_TAG_LENGTH) {
    throw new WispCryptoError("INVALID_FORMAT", "Encrypted metadata too short");
  }
  const key = await importAesKey(await deriveMetaKeyBytes(cek), ["decrypt"]);
  const nonce = blob.slice(0, GCM_NONCE_LENGTH);
  const sealed = blob.slice(GCM_NONCE_LENGTH);

  let plain: Uint8Array;
  try {
    plain = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: nonce as BufferSource, additionalData: AAD_META as BufferSource },
        key,
        sealed as BufferSource,
      ),
    );
  } catch {
    throw new WispCryptoError(
      "DECRYPT_FAILED",
      "Metadata authentication failed — wrong key or tampered data",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(utf8Decode(plain));
  } catch {
    throw new WispCryptoError("INVALID_FORMAT", "Decrypted metadata is not valid JSON");
  }
  assertShareMetadata(parsed);
  return { name: parsed.name, size: parsed.size, type: parsed.type };
}
