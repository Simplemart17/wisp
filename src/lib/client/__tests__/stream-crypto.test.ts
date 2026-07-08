/**
 * The headline STREAM path — encrypt a Blob chunk-by-chunk, decrypt it back —
 * previously had no direct tests despite being what every share round-trips
 * through. Chunk-boundary arithmetic (exact multiples, empty sources, the
 * held-back final chunk) is exactly where streaming code goes wrong silently.
 */
import { describe, expect, it } from "vitest";

import { WispCryptoError, fromBase64Url } from "@/lib/crypto";
import {
  createEncryptedShareFromBlob,
  decryptBlob,
  encryptBlob,
  openEncryptedShareBlob,
} from "../stream-crypto";

const CHUNK = 1024; // small test chunk so multi-chunk paths stay fast

function bytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = (i * 31 + 7) % 256;
  return out;
}

const METADATA = { name: "doc.bin", type: "application/octet-stream", size: 0 };

describe("encryptBlob/decryptBlob round trip", () => {
  // Sizes chosen around the chunk boundary: empty, sub-chunk, exact multiple
  // (the "skipped remainder" case), and straddling several chunks.
  it.each([0, 1, CHUNK - 1, CHUNK, CHUNK * 3, CHUNK * 3 + 17])(
    "round-trips %i bytes",
    async (size) => {
      const plain = bytes(size);
      const share = await createEncryptedShareFromBlob({
        source: new Blob([plain as BlobPart]),
        metadata: { ...METADATA, size },
        chunkSize: CHUNK,
      });
      const opened = await openEncryptedShareBlob({
        linkKey: share.linkKey,
        ciphertext: share.ciphertext,
        encryptedMetadata: share.encryptedMetadata,
      });
      expect(opened.metadata.size).toBe(size);
      expect(new Uint8Array(await opened.blob.arrayBuffer())).toEqual(plain);
    },
  );

  it("round-trips under a password", async () => {
    const plain = bytes(CHUNK * 2 + 5);
    const share = await createEncryptedShareFromBlob({
      source: new Blob([plain as BlobPart]),
      metadata: { ...METADATA, size: plain.length },
      password: "correct horse",
      chunkSize: CHUNK,
    });
    expect(share.wrappedCek).not.toBeNull();
    const opened = await openEncryptedShareBlob({
      linkKey: share.linkKey,
      ciphertext: share.ciphertext,
      encryptedMetadata: share.encryptedMetadata,
      wrappedCek: share.wrappedCek,
      kdfSalt: share.kdfSalt,
      kdfParams: share.kdfParams,
      password: "correct horse",
    });
    expect(new Uint8Array(await opened.blob.arrayBuffer())).toEqual(plain);
  });

  it("rejects a wrong password without opening anything", async () => {
    const share = await createEncryptedShareFromBlob({
      source: new Blob([bytes(64) as BlobPart]),
      metadata: { ...METADATA, size: 64 },
      password: "right",
      chunkSize: CHUNK,
    });
    await expect(
      openEncryptedShareBlob({
        linkKey: share.linkKey,
        ciphertext: share.ciphertext,
        encryptedMetadata: share.encryptedMetadata,
        wrappedCek: share.wrappedCek,
        kdfSalt: share.kdfSalt,
        kdfParams: share.kdfParams,
        password: "wrong",
      }),
    ).rejects.toBeInstanceOf(WispCryptoError);
  });

  it("rejects tampered ciphertext", async () => {
    const share = await createEncryptedShareFromBlob({
      source: new Blob([bytes(CHUNK + 100) as BlobPart]),
      metadata: { ...METADATA, size: CHUNK + 100 },
      chunkSize: CHUNK,
    });
    const raw = new Uint8Array(await share.ciphertext.arrayBuffer());
    raw[raw.length - 1] ^= 0xff; // flip one bit inside the final chunk's tag
    await expect(
      openEncryptedShareBlob({
        linkKey: share.linkKey,
        ciphertext: new Blob([raw as BlobPart]),
        encryptedMetadata: share.encryptedMetadata,
      }),
    ).rejects.toBeInstanceOf(WispCryptoError);
  });

  it("rejects truncated ciphertext", async () => {
    const cek = fromBase64Url("A".repeat(43)); // 32 zero-ish bytes, any key works pre-header-check
    await expect(decryptBlob(cek, new Blob([new Uint8Array(4) as BlobPart]), "text/plain"))
      .rejects.toMatchObject({ code: "INVALID_FORMAT" });
  });

  it("swapping two ciphertext chunks fails authentication (nonce sequence)", async () => {
    const plain = bytes(CHUNK * 2); // exactly two chunks
    const cekShare = await createEncryptedShareFromBlob({
      source: new Blob([plain as BlobPart]),
      metadata: { ...METADATA, size: plain.length },
      chunkSize: CHUNK,
    });
    const raw = new Uint8Array(await cekShare.ciphertext.arrayBuffer());
    const headerEnd = raw.length - 2 * (CHUNK + 16); // 2 sealed chunks of chunk+tag
    const a = raw.slice(headerEnd, headerEnd + CHUNK + 16);
    const b = raw.slice(headerEnd + CHUNK + 16);
    const swapped = new Uint8Array(raw.length);
    swapped.set(raw.slice(0, headerEnd));
    swapped.set(b, headerEnd);
    swapped.set(a, headerEnd + b.length);
    await expect(
      openEncryptedShareBlob({
        linkKey: cekShare.linkKey,
        ciphertext: new Blob([swapped as BlobPart]),
        encryptedMetadata: cekShare.encryptedMetadata,
      }),
    ).rejects.toBeInstanceOf(WispCryptoError);
  });

  it("re-encrypting the same content yields different ciphertext (fresh keys)", async () => {
    const plain = bytes(256);
    const one = await createEncryptedShareFromBlob({
      source: new Blob([plain as BlobPart]),
      metadata: { ...METADATA, size: 256 },
      chunkSize: CHUNK,
    });
    const two = await createEncryptedShareFromBlob({
      source: new Blob([plain as BlobPart]),
      metadata: { ...METADATA, size: 256 },
      chunkSize: CHUNK,
    });
    expect(one.linkKey).not.toBe(two.linkKey);
    expect(new Uint8Array(await one.ciphertext.arrayBuffer())).not.toEqual(
      new Uint8Array(await two.ciphertext.arrayBuffer()),
    );
  });

  it("encryptBlob output layout is header + per-chunk tag overhead", async () => {
    const plain = bytes(CHUNK * 2 + 10); // 3 chunks
    const secrets = await createEncryptedShareFromBlob({
      source: new Blob([plain as BlobPart]),
      metadata: { ...METADATA, size: plain.length },
      chunkSize: CHUNK,
    });
    // 12-byte header + 3 chunks, each +16-byte GCM tag
    expect(secrets.ciphertext.size).toBe(12 + plain.length + 3 * 16);
  });

  it("decryptBlob applies the requested content type", async () => {
    const share = await createEncryptedShareFromBlob({
      source: new Blob([bytes(8) as BlobPart]),
      metadata: { name: "n.txt", type: "text/plain", size: 8 },
      chunkSize: CHUNK,
    });
    const opened = await openEncryptedShareBlob({
      linkKey: share.linkKey,
      ciphertext: share.ciphertext,
      encryptedMetadata: share.encryptedMetadata,
    });
    expect(opened.blob.type).toBe("text/plain");
  });

  it("rejects a malformed link key as INVALID_FORMAT", async () => {
    await expect(
      openEncryptedShareBlob({
        linkKey: "not!!valid##base64url",
        ciphertext: new Blob([bytes(64) as BlobPart]),
        encryptedMetadata: bytes(32),
      }),
    ).rejects.toMatchObject({ code: "INVALID_FORMAT" });
  });
});

describe("encryptBlob primitives", () => {
  it("empty source still produces one sealed (empty) final chunk", async () => {
    const share = await createEncryptedShareFromBlob({
      source: new Blob([]),
      metadata: { ...METADATA, size: 0 },
      chunkSize: CHUNK,
    });
    expect(share.ciphertext.size).toBe(12 + 16); // header + tag over zero bytes
  });

  it("encryptBlob and decryptBlob agree for a raw CEK", async () => {
    const cek = crypto.getRandomValues(new Uint8Array(32));
    const plain = bytes(CHUNK + 3);
    const sealed = await encryptBlob(cek, new Blob([plain as BlobPart]), CHUNK);
    const opened = await decryptBlob(cek, sealed, "application/octet-stream");
    expect(new Uint8Array(await opened.arrayBuffer())).toEqual(plain);
  });
});
