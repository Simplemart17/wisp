import { describe, expect, it } from "vitest";

import { randomBytes, utf8Encode } from "../encoding";
import { deriveMetaKeyBytes, importAesKey } from "../keys";
import { type ShareMetadata, decryptMetadata, encryptMetadata } from "../metadata";

const cek = randomBytes(32);

const sample: ShareMetadata = {
  name: "秘密-döcument 🔒.pdf",
  size: 1_234_567,
  type: "application/pdf",
};

describe("metadata", () => {
  it("round-trips, including unicode filenames", async () => {
    const blob = await encryptMetadata(cek, sample);
    expect(await decryptMetadata(cek, blob)).toEqual(sample);
  });

  it("hides the filename from the ciphertext", async () => {
    const blob = await encryptMetadata(cek, sample);
    const needle = utf8Encode("pdf");
    const haystack = Array.from(blob);
    // naive subsequence scan — the plaintext must not appear anywhere
    const found = haystack.some((_, i) =>
      needle.every((b, j) => haystack[i + j] === b),
    );
    expect(found).toBe(false);
  });

  it("rejects tampered metadata", async () => {
    const blob = await encryptMetadata(cek, sample);
    blob[blob.length - 1] ^= 0x01;
    await expect(decryptMetadata(cek, blob)).rejects.toMatchObject({ code: "DECRYPT_FAILED" });
  });

  it("rejects the wrong key", async () => {
    const blob = await encryptMetadata(cek, sample);
    await expect(decryptMetadata(randomBytes(32), blob)).rejects.toMatchObject({
      code: "DECRYPT_FAILED",
    });
  });

  it("rejects blobs too short to be valid", async () => {
    await expect(decryptMetadata(cek, randomBytes(10))).rejects.toMatchObject({
      code: "INVALID_FORMAT",
    });
  });

  it("rejects well-encrypted JSON of the wrong shape", async () => {
    // Encrypt a JSON array with the real metadata key — decryption succeeds,
    // shape validation must still refuse it.
    const key = await importAesKey(await deriveMetaKeyBytes(cek), ["encrypt"]);
    const nonce = randomBytes(12);
    const sealed = new Uint8Array(
      await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv: nonce as BufferSource,
          additionalData: utf8Encode("wisp/v1/meta") as BufferSource,
        },
        key,
        utf8Encode(JSON.stringify([1, 2, 3])) as BufferSource,
      ),
    );
    const blob = new Uint8Array(nonce.length + sealed.length);
    blob.set(nonce);
    blob.set(sealed, nonce.length);
    await expect(decryptMetadata(cek, blob)).rejects.toMatchObject({ code: "INVALID_FORMAT" });
  });
});
