/**
 * Streaming crypto for large files (SPEC §11 Phase 3): the plaintext is read
 * chunk-by-chunk from a Blob/File stream and sealed incrementally, so peak
 * memory stays near one chunk instead of the whole file — both directions.
 * Output accumulates as Blob parts (non-contiguous), never one giant buffer.
 */
import {
  ChunkDecryptor,
  ChunkEncryptor,
  DEFAULT_CHUNK_SIZE,
  WispCryptoError,
  fromBase64Url,
  toBase64Url,
  type KdfParams,
  createShareSecrets,
  recoverCek,
  type ShareMetadata,
  decryptMetadata,
  encryptMetadata,
} from "@/lib/crypto";

const GCM_TAG_LENGTH = 16;
const HEADER_LENGTH = 12;

async function* blobChunks(source: Blob, chunkSize: number): AsyncGenerator<Uint8Array> {
  const reader = source.stream().getReader();
  let pending = new Uint8Array(0);
  let yielded = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    let merged: Uint8Array;
    if (pending.length === 0) {
      merged = value;
    } else {
      merged = new Uint8Array(pending.length + value.length);
      merged.set(pending);
      merged.set(value, pending.length);
    }
    let offset = 0;
    while (merged.length - offset >= chunkSize) {
      yield merged.slice(offset, offset + chunkSize);
      yielded = true;
      offset += chunkSize;
    }
    pending = merged.slice(offset);
  }
  // Trailing remainder — skipped when the source was an exact multiple of
  // chunkSize (the last full chunk then becomes the final one), but an empty
  // source still yields one empty chunk.
  if (pending.length > 0 || !yielded) yield pending;
}

/** Encrypt a Blob/File without materializing it in memory. */
export async function encryptBlob(
  cek: Uint8Array,
  source: Blob,
  chunkSize = DEFAULT_CHUNK_SIZE,
): Promise<Blob> {
  const encryptor = await ChunkEncryptor.create(cek, chunkSize);
  const parts: BlobPart[] = [encryptor.header as BlobPart];

  // Hold one chunk back so the last one can be sealed with the final flag.
  let held: Uint8Array | null = null;
  for await (const chunk of blobChunks(source, chunkSize)) {
    if (held) parts.push((await encryptor.seal(held, false)) as BlobPart);
    held = chunk;
  }
  parts.push((await encryptor.seal(held ?? new Uint8Array(0), true)) as BlobPart);
  return new Blob(parts, { type: "application/octet-stream" });
}

/** Decrypt a ciphertext Blob chunk-by-chunk back into a typed Blob. */
export async function decryptBlob(cek: Uint8Array, ciphertext: Blob, type: string): Promise<Blob> {
  if (ciphertext.size < HEADER_LENGTH + GCM_TAG_LENGTH) {
    throw new WispCryptoError("INVALID_FORMAT", "Ciphertext too short");
  }
  const header = new Uint8Array(await ciphertext.slice(0, HEADER_LENGTH).arrayBuffer());
  const decryptor = await ChunkDecryptor.create(cek, header);
  const sealedLength = decryptor.chunkSize + GCM_TAG_LENGTH;

  const parts: BlobPart[] = [];
  for (let offset = HEADER_LENGTH; ; ) {
    const remaining = ciphertext.size - offset;
    if (remaining < GCM_TAG_LENGTH) {
      throw new WispCryptoError("INVALID_FORMAT", "Truncated ciphertext chunk");
    }
    const isFinal = remaining <= sealedLength;
    const take = isFinal ? remaining : sealedLength;
    const sealed = new Uint8Array(await ciphertext.slice(offset, offset + take).arrayBuffer());
    parts.push((await decryptor.open(sealed, isFinal)) as BlobPart);
    offset += take;
    if (isFinal) break;
  }
  return new Blob(parts, { type });
}

export interface EncryptedShareBlobs {
  linkKey: string;
  ciphertext: Blob;
  encryptedMetadata: Uint8Array;
  wrappedCek: Uint8Array | null;
  kdfSalt: Uint8Array | null;
  kdfParams: KdfParams | null;
}

/** Streaming counterpart of createEncryptedShare — sender side. */
export async function createEncryptedShareFromBlob(input: {
  source: Blob;
  metadata: ShareMetadata;
  password?: string;
  chunkSize?: number;
}): Promise<EncryptedShareBlobs> {
  const secrets = await createShareSecrets(input.password || undefined);
  const [ciphertext, encryptedMetadata] = await Promise.all([
    encryptBlob(secrets.cek, input.source, input.chunkSize ?? DEFAULT_CHUNK_SIZE),
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

/** Streaming counterpart of openEncryptedShare — recipient side. */
export async function openEncryptedShareBlob(input: {
  linkKey: string;
  ciphertext: Blob;
  encryptedMetadata: Uint8Array;
  wrappedCek?: Uint8Array | null;
  kdfSalt?: Uint8Array | null;
  kdfParams?: KdfParams | null;
  password?: string;
}): Promise<{ blob: Blob; metadata: ShareMetadata }> {
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
  const blob = await decryptBlob(cek, input.ciphertext, metadata.type);
  return { blob, metadata };
}
