/**
 * Chunked AES-256-GCM content encryption (SPEC §3), following the STREAM
 * construction so large files never need to fit in memory at once and the
 * overall stream — not just each chunk — is authenticated:
 *
 *   blob = header || chunk₀ || chunk₁ || … || chunkₙ
 *   header = version(1) || noncePrefix(7) || chunkSize(u32 BE)   — 12 bytes
 *   chunkᵢ = AES-GCM(contentKey, nonceᵢ, plaintextᵢ, aad=header)
 *   nonceᵢ = noncePrefix(7) || counter i (u32 BE) || finalFlag(1)
 *
 * The counter in the nonce defeats chunk reordering; the final-flag defeats
 * truncation at a chunk boundary; binding the header as AAD defeats header
 * tampering (e.g. lying about chunkSize). Every chunk is full `chunkSize`
 * bytes except the last, which may be 0..chunkSize.
 */
import { concatBytes, randomBytes } from "./encoding";
import { WispCryptoError } from "./errors";
import { GCM_TAG_LENGTH, deriveContentKeyBytes, importAesKey } from "./keys";

export const CONTENT_FORMAT_VERSION = 1;
export const DEFAULT_CHUNK_SIZE = 4 * 1024 * 1024; // 4 MiB
export const MAX_CHUNK_SIZE = 64 * 1024 * 1024; // refuse hostile headers beyond this
const NONCE_PREFIX_LENGTH = 7;
const HEADER_LENGTH = 12;
const MAX_COUNTER = 0xffffffff;

function buildHeader(noncePrefix: Uint8Array, chunkSize: number): Uint8Array {
  const header = new Uint8Array(HEADER_LENGTH);
  header[0] = CONTENT_FORMAT_VERSION;
  header.set(noncePrefix, 1);
  new DataView(header.buffer).setUint32(1 + NONCE_PREFIX_LENGTH, chunkSize);
  return header;
}

function buildNonce(noncePrefix: Uint8Array, counter: number, isFinal: boolean): Uint8Array {
  const nonce = new Uint8Array(12);
  nonce.set(noncePrefix, 0);
  new DataView(nonce.buffer).setUint32(NONCE_PREFIX_LENGTH, counter);
  nonce[11] = isFinal ? 1 : 0;
  return nonce;
}

function assertValidChunkSize(chunkSize: number): void {
  if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > MAX_CHUNK_SIZE) {
    throw new WispCryptoError("INVALID_FORMAT", `chunkSize must be 1..${MAX_CHUNK_SIZE}`);
  }
}

/**
 * Incremental encryptor for streaming uploads. Feed plaintext in exact
 * `chunkSize` pieces (any size allowed for the final one), in order.
 */
export class ChunkEncryptor {
  private counter = 0;
  private finished = false;

  private constructor(
    private readonly key: CryptoKey,
    readonly header: Uint8Array,
    private readonly noncePrefix: Uint8Array,
    readonly chunkSize: number,
  ) {}

  static async create(cek: Uint8Array, chunkSize = DEFAULT_CHUNK_SIZE): Promise<ChunkEncryptor> {
    assertValidChunkSize(chunkSize);
    const key = await importAesKey(await deriveContentKeyBytes(cek), ["encrypt"]);
    const noncePrefix = randomBytes(NONCE_PREFIX_LENGTH);
    return new ChunkEncryptor(key, buildHeader(noncePrefix, chunkSize), noncePrefix, chunkSize);
  }

  async seal(plaintext: Uint8Array, isFinal: boolean): Promise<Uint8Array> {
    if (this.finished) {
      throw new WispCryptoError("INVALID_FORMAT", "Encryptor already sealed its final chunk");
    }
    if (isFinal ? plaintext.length > this.chunkSize : plaintext.length !== this.chunkSize) {
      throw new WispCryptoError(
        "INVALID_FORMAT",
        "Non-final chunks must be exactly chunkSize; the final chunk at most chunkSize",
      );
    }
    if (this.counter > MAX_COUNTER) {
      throw new WispCryptoError("INVALID_FORMAT", "Chunk counter overflow");
    }
    const nonce = buildNonce(this.noncePrefix, this.counter, isFinal);
    this.counter += 1;
    this.finished = isFinal;
    const sealed = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: nonce as BufferSource,
        additionalData: this.header as BufferSource,
      },
      this.key,
      plaintext as BufferSource,
    );
    return new Uint8Array(sealed);
  }
}

/**
 * Incremental decryptor. `open` chunks in order; the caller derives chunk
 * boundaries from `chunkSize` (+ GCM tag) exactly as `decryptContent` does.
 */
export class ChunkDecryptor {
  private counter = 0;
  private finished = false;

  private constructor(
    private readonly key: CryptoKey,
    private readonly header: Uint8Array,
    private readonly noncePrefix: Uint8Array,
    readonly chunkSize: number,
  ) {}

  static async create(cek: Uint8Array, header: Uint8Array): Promise<ChunkDecryptor> {
    if (header.length !== HEADER_LENGTH) {
      throw new WispCryptoError("INVALID_FORMAT", "Content header must be 12 bytes");
    }
    if (header[0] !== CONTENT_FORMAT_VERSION) {
      throw new WispCryptoError("UNSUPPORTED_VERSION", `Unknown content version ${header[0]}`);
    }
    const chunkSize = new DataView(
      header.buffer,
      header.byteOffset + 1 + NONCE_PREFIX_LENGTH,
    ).getUint32(0);
    assertValidChunkSize(chunkSize);
    const key = await importAesKey(await deriveContentKeyBytes(cek), ["decrypt"]);
    const noncePrefix = header.slice(1, 1 + NONCE_PREFIX_LENGTH);
    return new ChunkDecryptor(key, header.slice(), noncePrefix, chunkSize);
  }

  get isFinished(): boolean {
    return this.finished;
  }

  async open(sealed: Uint8Array, isFinal: boolean): Promise<Uint8Array> {
    if (this.finished) {
      throw new WispCryptoError("INVALID_FORMAT", "Decryptor already consumed its final chunk");
    }
    const nonce = buildNonce(this.noncePrefix, this.counter, isFinal);
    this.counter += 1;
    this.finished = isFinal;
    try {
      const plain = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: nonce as BufferSource,
          additionalData: this.header as BufferSource,
        },
        this.key,
        sealed as BufferSource,
      );
      return new Uint8Array(plain);
    } catch {
      throw new WispCryptoError(
        "DECRYPT_FAILED",
        "Content authentication failed — wrong key or tampered data",
      );
    }
  }
}

/** One-shot convenience for payloads that fit in memory. */
export async function encryptContent(
  cek: Uint8Array,
  plaintext: Uint8Array,
  chunkSize = DEFAULT_CHUNK_SIZE,
): Promise<Uint8Array> {
  const encryptor = await ChunkEncryptor.create(cek, chunkSize);
  const parts: Uint8Array[] = [encryptor.header];
  for (let offset = 0; ; offset += chunkSize) {
    const isFinal = offset + chunkSize >= plaintext.length;
    parts.push(await encryptor.seal(plaintext.slice(offset, offset + chunkSize), isFinal));
    if (isFinal) break;
  }
  return concatBytes(...parts);
}

/** One-shot counterpart to {@link encryptContent}. */
export async function decryptContent(cek: Uint8Array, blob: Uint8Array): Promise<Uint8Array> {
  if (blob.length < HEADER_LENGTH + GCM_TAG_LENGTH) {
    throw new WispCryptoError("INVALID_FORMAT", "Ciphertext too short");
  }
  const decryptor = await ChunkDecryptor.create(cek, blob.slice(0, HEADER_LENGTH));
  const sealedChunkLength = decryptor.chunkSize + GCM_TAG_LENGTH;

  const parts: Uint8Array[] = [];
  for (let offset = HEADER_LENGTH; ; ) {
    const remaining = blob.length - offset;
    if (remaining < GCM_TAG_LENGTH) {
      throw new WispCryptoError("INVALID_FORMAT", "Truncated ciphertext chunk");
    }
    const isFinal = remaining <= sealedChunkLength;
    const take = isFinal ? remaining : sealedChunkLength;
    parts.push(await decryptor.open(blob.slice(offset, offset + take), isFinal));
    offset += take;
    if (isFinal) break;
  }
  return concatBytes(...parts);
}
