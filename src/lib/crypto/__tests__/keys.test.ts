import { describe, expect, it } from "vitest";

import { randomBytes } from "../encoding";
import {
  DEFAULT_KDF_PARAMS,
  type KdfParams,
  createShareSecrets,
  recoverCek,
  validateKdfParams,
} from "../keys";
import { TEST_KDF_PARAMS } from "./helpers";

describe("share secrets without a password", () => {
  it("stores nothing key-related on the server", async () => {
    const secrets = await createShareSecrets();
    expect(secrets.wrappedCek).toBeNull();
    expect(secrets.kdfSalt).toBeNull();
    expect(secrets.kdfParams).toBeNull();
    expect(secrets.linkKey).toHaveLength(32);
    expect(secrets.cek).toHaveLength(32);
  });

  it("recovers the CEK from the link-key alone", async () => {
    const secrets = await createShareSecrets();
    const cek = await recoverCek({ linkKey: secrets.linkKey });
    expect(cek).toEqual(secrets.cek);
  });

  it("derives different CEKs from different link-keys", async () => {
    const a = await createShareSecrets();
    const b = await createShareSecrets();
    expect(a.cek).not.toEqual(b.cek);
    expect(a.linkKey).not.toEqual(b.linkKey);
  });
});

describe("share secrets with a password", () => {
  it("wraps the CEK and recovers it with link-key + password", async () => {
    const secrets = await createShareSecrets("correct horse battery staple", TEST_KDF_PARAMS);
    expect(secrets.wrappedCek).toHaveLength(12 + 32 + 16); // nonce + key + tag
    expect(secrets.kdfSalt).toHaveLength(16);
    expect(secrets.kdfParams).toEqual(TEST_KDF_PARAMS);

    const cek = await recoverCek({
      linkKey: secrets.linkKey,
      wrappedCek: secrets.wrappedCek,
      kdfSalt: secrets.kdfSalt,
      kdfParams: secrets.kdfParams,
      password: "correct horse battery staple",
    });
    expect(cek).toEqual(secrets.cek);
  });

  it("rejects a wrong password", async () => {
    const secrets = await createShareSecrets("right password", TEST_KDF_PARAMS);
    await expect(
      recoverCek({
        linkKey: secrets.linkKey,
        wrappedCek: secrets.wrappedCek,
        kdfSalt: secrets.kdfSalt,
        kdfParams: secrets.kdfParams,
        password: "wrong password",
      }),
    ).rejects.toMatchObject({ name: "WispCryptoError", code: "DECRYPT_FAILED" });
  });

  it("rejects the right password with the wrong link-key (leaked-password scenario)", async () => {
    const secrets = await createShareSecrets("shared secret", TEST_KDF_PARAMS);
    await expect(
      recoverCek({
        linkKey: randomBytes(32),
        wrappedCek: secrets.wrappedCek,
        kdfSalt: secrets.kdfSalt,
        kdfParams: secrets.kdfParams,
        password: "shared secret",
      }),
    ).rejects.toMatchObject({ code: "DECRYPT_FAILED" });
  });

  it("demands a password when the share has one", async () => {
    const secrets = await createShareSecrets("pw", TEST_KDF_PARAMS);
    await expect(
      recoverCek({
        linkKey: secrets.linkKey,
        wrappedCek: secrets.wrappedCek,
        kdfSalt: secrets.kdfSalt,
        kdfParams: secrets.kdfParams,
      }),
    ).rejects.toMatchObject({ code: "PASSWORD_REQUIRED" });
  });

  it("rejects a wrap record missing its KDF salt or params", async () => {
    const secrets = await createShareSecrets("pw", TEST_KDF_PARAMS);
    await expect(
      recoverCek({
        linkKey: secrets.linkKey,
        wrappedCek: secrets.wrappedCek,
        password: "pw",
      }),
    ).rejects.toMatchObject({ code: "INVALID_FORMAT" });
  });

  it("works with the production default KDF parameters", async () => {
    const secrets = await createShareSecrets("pw", DEFAULT_KDF_PARAMS);
    const cek = await recoverCek({
      linkKey: secrets.linkKey,
      wrappedCek: secrets.wrappedCek,
      kdfSalt: secrets.kdfSalt,
      kdfParams: secrets.kdfParams,
      password: "pw",
    });
    expect(cek).toEqual(secrets.cek);
  });
});

describe("validateKdfParams", () => {
  it.each([
    ["zero iterations", { ...TEST_KDF_PARAMS, iterations: 0 }],
    ["absurd memory (OOM defence)", { ...TEST_KDF_PARAMS, memorySize: 1 << 22 }],
    ["memory below 8×parallelism", { ...TEST_KDF_PARAMS, memorySize: 4 }],
    ["wrong algorithm", { ...TEST_KDF_PARAMS, algorithm: "argon2i" as never }],
    ["tiny hash length", { ...TEST_KDF_PARAMS, hashLength: 8 }],
    ["non-integer iterations", { ...TEST_KDF_PARAMS, iterations: 2.5 }],
  ])("rejects %s", (_label, params) => {
    expect(() => validateKdfParams(params as KdfParams)).toThrow(
      expect.objectContaining({ code: "INVALID_FORMAT" }),
    );
  });

  it("accepts the defaults", () => {
    expect(() => validateKdfParams(DEFAULT_KDF_PARAMS)).not.toThrow();
  });
});
