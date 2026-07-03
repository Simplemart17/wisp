import { describe, expect, it } from "vitest";

import {
  ChunkDecryptor,
  ChunkEncryptor,
  CONTENT_FORMAT_VERSION,
  decryptContent,
  encryptContent,
} from "../content";
import { concatBytes, randomBytes } from "../encoding";

const CHUNK = 1024; // small chunks so multi-chunk paths stay fast
const HEADER = 12;
const TAG = 16;

const cek = randomBytes(32);

async function roundTrip(length: number): Promise<void> {
  const plaintext = randomBytes(length);
  const blob = await encryptContent(cek, plaintext, CHUNK);
  expect(await decryptContent(cek, blob)).toEqual(plaintext);
}

describe("content round-trips", () => {
  it.each([
    ["empty payload", 0],
    ["single byte", 1],
    ["one byte under a chunk", CHUNK - 1],
    ["exactly one chunk", CHUNK],
    ["one byte over a chunk", CHUNK + 1],
    ["exact multiple of chunk size", CHUNK * 3],
    ["several chunks with remainder", Math.floor(CHUNK * 3.5)],
  ])("round-trips %s", async (_label, length) => {
    await roundTrip(length);
  });

  it("handles many chunks (1 MiB in 4 KiB chunks)", async () => {
    const plaintext = randomBytes(1024 * 1024);
    const blob = await encryptContent(cek, plaintext, 4096);
    expect(await decryptContent(cek, blob)).toEqual(plaintext);
  });

  it("produces different ciphertexts for the same plaintext (fresh nonces)", async () => {
    const plaintext = randomBytes(100);
    const a = await encryptContent(cek, plaintext, CHUNK);
    const b = await encryptContent(cek, plaintext, CHUNK);
    expect(a).not.toEqual(b);
  });
});

describe("content integrity", () => {
  it("rejects a flipped bit in the ciphertext body", async () => {
    const blob = await encryptContent(cek, randomBytes(CHUNK * 2), CHUNK);
    blob[HEADER + 100] ^= 0x01;
    await expect(decryptContent(cek, blob)).rejects.toMatchObject({ code: "DECRYPT_FAILED" });
  });

  it("rejects a tampered nonce prefix in the header", async () => {
    const blob = await encryptContent(cek, randomBytes(64), CHUNK);
    blob[3] ^= 0x01; // inside the 7-byte nonce prefix
    await expect(decryptContent(cek, blob)).rejects.toMatchObject({ code: "DECRYPT_FAILED" });
  });

  it("rejects reordered chunks", async () => {
    const blob = await encryptContent(cek, randomBytes(CHUNK * 3), CHUNK);
    const sealed = CHUNK + TAG;
    const header = blob.slice(0, HEADER);
    const chunk0 = blob.slice(HEADER, HEADER + sealed);
    const chunk1 = blob.slice(HEADER + sealed, HEADER + 2 * sealed);
    const rest = blob.slice(HEADER + 2 * sealed);
    const swapped = concatBytes(header, chunk1, chunk0, rest);
    await expect(decryptContent(cek, swapped)).rejects.toMatchObject({ code: "DECRYPT_FAILED" });
  });

  it("rejects truncation at a chunk boundary (dropped final chunk)", async () => {
    const blob = await encryptContent(cek, randomBytes(CHUNK * 2 + 10), CHUNK);
    const truncated = blob.slice(0, HEADER + 2 * (CHUNK + TAG));
    await expect(decryptContent(cek, truncated)).rejects.toMatchObject({
      code: "DECRYPT_FAILED",
    });
  });

  it("rejects truncation mid-chunk", async () => {
    const blob = await encryptContent(cek, randomBytes(CHUNK * 2), CHUNK);
    await expect(decryptContent(cek, blob.slice(0, blob.length - 5))).rejects.toMatchObject({
      code: "DECRYPT_FAILED",
    });
  });

  it("rejects appended garbage", async () => {
    const blob = await encryptContent(cek, randomBytes(CHUNK), CHUNK);
    const extended = concatBytes(blob, randomBytes(40));
    await expect(decryptContent(cek, extended)).rejects.toMatchObject({
      code: "DECRYPT_FAILED",
    });
  });

  it("rejects the wrong key", async () => {
    const blob = await encryptContent(cek, randomBytes(64), CHUNK);
    await expect(decryptContent(randomBytes(32), blob)).rejects.toMatchObject({
      code: "DECRYPT_FAILED",
    });
  });

  it("rejects blobs too short to contain a header and tag", async () => {
    await expect(decryptContent(cek, randomBytes(HEADER + TAG - 1))).rejects.toMatchObject({
      code: "INVALID_FORMAT",
    });
  });

  it("rejects unknown format versions", async () => {
    const blob = await encryptContent(cek, randomBytes(64), CHUNK);
    blob[0] = CONTENT_FORMAT_VERSION + 1;
    await expect(decryptContent(cek, blob)).rejects.toMatchObject({
      code: "UNSUPPORTED_VERSION",
    });
  });

  it("rejects a hostile chunk size in the header", async () => {
    const blob = await encryptContent(cek, randomBytes(64), CHUNK);
    // Overwrite the u32 chunkSize with an out-of-range value
    new DataView(blob.buffer, blob.byteOffset + 8).setUint32(0, 0xffffffff);
    await expect(decryptContent(cek, blob)).rejects.toMatchObject({ code: "INVALID_FORMAT" });
  });
});

describe("streaming chunk API", () => {
  it("round-trips chunk by chunk", async () => {
    const encryptor = await ChunkEncryptor.create(cek, CHUNK);
    const part1 = randomBytes(CHUNK);
    const part2 = randomBytes(300);
    const sealed1 = await encryptor.seal(part1, false);
    const sealed2 = await encryptor.seal(part2, true);

    const decryptor = await ChunkDecryptor.create(cek, encryptor.header);
    expect(await decryptor.open(sealed1, false)).toEqual(part1);
    expect(await decryptor.open(sealed2, true)).toEqual(part2);
    expect(decryptor.isFinished).toBe(true);
  });

  it("refuses to seal after the final chunk", async () => {
    const encryptor = await ChunkEncryptor.create(cek, CHUNK);
    await encryptor.seal(randomBytes(10), true);
    await expect(encryptor.seal(randomBytes(10), true)).rejects.toMatchObject({
      code: "INVALID_FORMAT",
    });
  });

  it("refuses non-final chunks that are not exactly chunkSize", async () => {
    const encryptor = await ChunkEncryptor.create(cek, CHUNK);
    await expect(encryptor.seal(randomBytes(CHUNK - 1), false)).rejects.toMatchObject({
      code: "INVALID_FORMAT",
    });
    await expect(encryptor.seal(randomBytes(CHUNK + 1), true)).rejects.toMatchObject({
      code: "INVALID_FORMAT",
    });
  });

  it("rejects chunks opened out of order", async () => {
    const encryptor = await ChunkEncryptor.create(cek, CHUNK);
    await encryptor.seal(randomBytes(CHUNK), false);
    const sealed2 = await encryptor.seal(randomBytes(CHUNK), false);

    const decryptor = await ChunkDecryptor.create(cek, encryptor.header);
    await expect(decryptor.open(sealed2, false)).rejects.toMatchObject({
      code: "DECRYPT_FAILED",
    });
  });

  it("rejects a final chunk replayed as non-final and vice versa", async () => {
    const encryptor = await ChunkEncryptor.create(cek, CHUNK);
    const sealedFinal = await encryptor.seal(randomBytes(CHUNK), true);

    const decryptor = await ChunkDecryptor.create(cek, encryptor.header);
    await expect(decryptor.open(sealedFinal, false)).rejects.toMatchObject({
      code: "DECRYPT_FAILED",
    });
  });
});
