/**
 * End-to-end tests for the full share flow, simulating what the server would
 * store (ciphertext, encrypted metadata, wrap record) and what travels in the
 * URL fragment (the link-key).
 */
import { describe, expect, it } from "vitest";

import { utf8Encode as utf8ToBytes } from "../encoding";
import { createEncryptedShare, openEncryptedShare } from "../index";
import { TEST_KDF_PARAMS } from "./helpers";

describe("full share flow", () => {
  it("shares a text note with no password", async () => {
    const data = utf8ToBytes("meet at the usual place at 6");
    const share = await createEncryptedShare({
      data,
      metadata: { name: "note.txt", size: data.length, type: "text/plain" },
    });

    expect(share.wrappedCek).toBeNull();
    expect(share.linkKey).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes base64url

    // Simulate: server stores blobs; recipient gets id + fragment.
    const opened = await openEncryptedShare({
      linkKey: share.linkKey,
      ciphertext: share.ciphertext,
      encryptedMetadata: share.encryptedMetadata,
    });
    expect(opened.data).toEqual(data);
    expect(opened.metadata.name).toBe("note.txt");
  });

  it("shares a binary file with a password", async () => {
    const data = crypto.getRandomValues(new Uint8Array(50_000));
    const share = await createEncryptedShare({
      data,
      metadata: { name: "q3-financials.xlsx", size: data.length, type: "application/vnd.ms-excel" },
      password: "hunter2!",
      chunkSize: 4096,
      kdfParams: TEST_KDF_PARAMS,
    });

    expect(share.wrappedCek).not.toBeNull();
    const opened = await openEncryptedShare({
      linkKey: share.linkKey,
      ciphertext: share.ciphertext,
      encryptedMetadata: share.encryptedMetadata,
      wrappedCek: share.wrappedCek,
      kdfSalt: share.kdfSalt,
      kdfParams: share.kdfParams,
      password: "hunter2!",
    });
    expect(opened.data).toEqual(data);
    expect(opened.metadata.type).toBe("application/vnd.ms-excel");
  });

  it("a leaked link alone cannot open a password share", async () => {
    const data = utf8ToBytes("secret");
    const share = await createEncryptedShare({
      data,
      metadata: { name: "s.txt", size: data.length, type: "text/plain" },
      password: "pw",
      kdfParams: TEST_KDF_PARAMS,
    });

    await expect(
      openEncryptedShare({
        linkKey: share.linkKey,
        ciphertext: share.ciphertext,
        encryptedMetadata: share.encryptedMetadata,
        wrappedCek: share.wrappedCek,
        kdfSalt: share.kdfSalt,
        kdfParams: share.kdfParams,
      }),
    ).rejects.toMatchObject({ code: "PASSWORD_REQUIRED" });

    await expect(
      openEncryptedShare({
        linkKey: share.linkKey,
        ciphertext: share.ciphertext,
        encryptedMetadata: share.encryptedMetadata,
        wrappedCek: share.wrappedCek,
        kdfSalt: share.kdfSalt,
        kdfParams: share.kdfParams,
        password: "guess",
      }),
    ).rejects.toMatchObject({ code: "DECRYPT_FAILED" });
  });

  it("a corrupted fragment fails cleanly", async () => {
    const data = utf8ToBytes("hello");
    const share = await createEncryptedShare({
      data,
      metadata: { name: "n.txt", size: data.length, type: "text/plain" },
    });

    // Flip one character of the link-key to a guaranteed-different one.
    const flipped =
      share.linkKey.slice(0, 10) +
      (share.linkKey[10] === "A" ? "B" : "A") +
      share.linkKey.slice(11);
    await expect(
      openEncryptedShare({
        linkKey: flipped,
        ciphertext: share.ciphertext,
        encryptedMetadata: share.encryptedMetadata,
      }),
    ).rejects.toMatchObject({ code: "DECRYPT_FAILED" });

    await expect(
      openEncryptedShare({
        linkKey: "not base64url!!",
        ciphertext: share.ciphertext,
        encryptedMetadata: share.encryptedMetadata,
      }),
    ).rejects.toMatchObject({ code: "INVALID_FORMAT" });
  });
});
