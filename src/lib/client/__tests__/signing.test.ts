import { describe, expect, it } from "vitest";

import { concatBytes, randomBytes, toBase64Url, utf8Encode } from "@/lib/crypto/encoding";
import {
  MAX_SIGNATURE_IMAGE_BYTES,
  canonicalPayloadBytes,
  createSignedEnvelope,
  maskEmail,
  openAndVerifyEnvelope,
  signatureIdentityMatches,
  signatureImageBytes,
} from "../signing";

const cek = randomBytes(32);
const document = new Blob(["Employment agreement: the undersigned agrees to the terms."]);

const input = {
  cek,
  document,
  linkId: "AbCdEf0123456789",
  signerEmail: "jane@example.com",
  signerName: "Jane Q. Signer",
};

describe("document signing", () => {
  it("round-trips: sign, seal, open, verify", async () => {
    const sealed = await createSignedEnvelope(input);
    const result = await openAndVerifyEnvelope(cek, sealed, document);
    expect(result.valid).toBe(true);
    expect(result.problem).toBeNull();
    expect(result.payload.signerName).toBe("Jane Q. Signer");
    expect(result.payload.signerEmail).toBe("jane@example.com");
    expect(result.payload.linkId).toBe("AbCdEf0123456789");
  });

  it("rejects a signature presented against a different document", async () => {
    const sealed = await createSignedEnvelope(input);
    const other = new Blob(["Employment agreement: the undersigned agrees to the terms!"]);
    const result = await openAndVerifyEnvelope(cek, sealed, other);
    expect(result.valid).toBe(false);
    expect(result.problem).toMatch(/different document/);
  });

  it("rejects a tampered envelope (sealed under the CEK subkey)", async () => {
    const sealed = await createSignedEnvelope(input);
    sealed[sealed.length - 5] ^= 0x01;
    await expect(openAndVerifyEnvelope(cek, sealed, document)).rejects.toMatchObject({
      code: "DECRYPT_FAILED",
    });
  });

  it("cannot be opened without the share's CEK", async () => {
    const sealed = await createSignedEnvelope(input);
    await expect(openAndVerifyEnvelope(randomBytes(32), sealed, document)).rejects.toMatchObject({
      code: "DECRYPT_FAILED",
    });
  });

  it("detects payload tampering even with a valid decryption", async () => {
    // Re-seal a modified envelope with the right key: decrypt-side AES-GCM
    // passes, but the ECDSA check must fail because the payload changed.
    const sealed = await createSignedEnvelope(input);
    const opened = await openAndVerifyEnvelope(cek, sealed, document);
    expect(opened.valid).toBe(true);

    // Forge: same doc, different signer name, original signature — rebuild
    // the envelope through the crypto primitives the client uses.
    const { utf8Encode, utf8Decode, concatBytes, randomBytes: rand } =
      await import("@/lib/crypto/encoding");
    const ikm = await crypto.subtle.importKey("raw", cek as BufferSource, "HKDF", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: utf8Encode("wisp/v1/signature-key") },
      ikm,
      256,
    );
    const aes = await crypto.subtle.importKey("raw", bits, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);

    const nonce = sealed.slice(0, 12);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonce as BufferSource, additionalData: utf8Encode("wisp/v1/sig") as BufferSource },
      aes,
      sealed.slice(12) as BufferSource,
    );
    const envelope = JSON.parse(utf8Decode(new Uint8Array(plain)));
    envelope.payload.signerName = "Mallory Impostor";
    const newNonce = rand(12);
    const resealed = concatBytes(
      newNonce,
      new Uint8Array(
        await crypto.subtle.encrypt(
          { name: "AES-GCM", iv: newNonce as BufferSource, additionalData: utf8Encode("wisp/v1/sig") as BufferSource },
          aes,
          utf8Encode(JSON.stringify(envelope)) as BufferSource,
        ),
      ),
    );

    const forged = await openAndVerifyEnvelope(cek, resealed, document);
    expect(forged.valid).toBe(false);
    expect(forged.problem).toMatch(/signature check failed/);
  });
});

describe("drawn signature mark (payload v2)", () => {
  // Stand-in for a PNG from the pad — the envelope treats it as opaque bytes.
  const mark = randomBytes(4096);

  it("round-trips the drawn mark inside the signed payload", async () => {
    const sealed = await createSignedEnvelope({ ...input, signatureImage: mark });
    const result = await openAndVerifyEnvelope(cek, sealed, document);
    expect(result.valid).toBe(true);
    expect(signatureImageBytes(result.payload)).toEqual(mark);
  });

  it("signs with a null mark when the pad is empty", async () => {
    const sealed = await createSignedEnvelope(input);
    const result = await openAndVerifyEnvelope(cek, sealed, document);
    expect(result.valid).toBe(true);
    expect(result.payload.signatureImage).toBeNull();
    expect(signatureImageBytes(result.payload)).toBeNull();
  });

  it("a swapped drawn mark breaks the ECDSA signature", async () => {
    // Reseal with a different image but the original signature — decryption
    // succeeds (right CEK), verification must fail (payload changed).
    const sealed = await createSignedEnvelope({ ...input, signatureImage: mark });
    const aes = await sealingKey();
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: sealed.slice(0, 12) as BufferSource, additionalData: utf8Encode("wisp/v1/sig") as BufferSource },
      aes,
      sealed.slice(12) as BufferSource,
    );
    const envelope = JSON.parse(new TextDecoder().decode(plain));
    envelope.payload.signatureImage = toBase64Url(randomBytes(4096));
    const forged = await reseal(aes, envelope);

    const result = await openAndVerifyEnvelope(cek, forged, document);
    expect(result.valid).toBe(false);
    expect(result.problem).toMatch(/signature check failed/);
  });

  it("rejects an oversized mark before signing", async () => {
    const huge = randomBytes(MAX_SIGNATURE_IMAGE_BYTES + 1);
    await expect(createSignedEnvelope({ ...input, signatureImage: huge })).rejects.toMatchObject({
      code: "INVALID_FORMAT",
    });
  });

  it("signatureImageBytes returns null for malformed or oversized payload fields", () => {
    const base = { v: 2, docHash: "x", linkId: "l", signerEmail: "e", signerName: "n", signedAt: "t" };
    expect(signatureImageBytes({ ...base, signatureImage: "!!not-base64url!!" })).toBeNull();
    expect(
      signatureImageBytes({ ...base, signatureImage: toBase64Url(randomBytes(MAX_SIGNATURE_IMAGE_BYTES + 1)) }),
    ).toBeNull();
    expect(signatureImageBytes({ ...base, v: 1 })).toBeNull();
  });

  it("still verifies a v1 envelope signed before the drawn mark existed", async () => {
    // Hand-rolled v1: canonical shape WITHOUT signatureImage, sealed with the
    // same primitives — pins backward compatibility of the wire format.
    const payload = {
      v: 1,
      docHash: toBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", await document.arrayBuffer()))),
      linkId: input.linkId,
      signerEmail: input.signerEmail,
      signerName: input.signerName,
      signedAt: new Date().toISOString(),
    };
    const keyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ]);
    const signature = new Uint8Array(
      await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        keyPair.privateKey,
        canonicalPayloadBytes(payload) as BufferSource,
      ),
    );
    const envelope = {
      payload,
      publicKeyJwk: await crypto.subtle.exportKey("jwk", keyPair.publicKey),
      signature: toBase64Url(signature),
    };
    const sealed = await reseal(await sealingKey(), envelope);

    const result = await openAndVerifyEnvelope(cek, sealed, document);
    expect(result.valid).toBe(true);
    expect(result.payload.v).toBe(1);
    expect(signatureImageBytes(result.payload)).toBeNull();
  });

  async function sealingKey(): Promise<CryptoKey> {
    const ikm = await crypto.subtle.importKey("raw", cek as BufferSource, "HKDF", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: utf8Encode("wisp/v1/signature-key") },
      ikm,
      256,
    );
    return crypto.subtle.importKey("raw", bits, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  }

  async function reseal(aes: CryptoKey, envelope: unknown): Promise<Uint8Array> {
    const nonce = randomBytes(12);
    return concatBytes(
      nonce,
      new Uint8Array(
        await crypto.subtle.encrypt(
          { name: "AES-GCM", iv: nonce as BufferSource, additionalData: utf8Encode("wisp/v1/sig") as BufferSource },
          aes,
          utf8Encode(JSON.stringify(envelope)) as BufferSource,
        ),
      ),
    );
  }
});

describe("signature identity binding", () => {
  it("masks emails the same way the server derives email_hint", () => {
    expect(maskEmail("Jane@Example.com")).toBe("j***@example.com");
    expect(maskEmail("sam@y.org")).toBe("s***@y.org");
  });

  it("confirms identity when the signer's email matches the verified recipient", async () => {
    const sealed = await createSignedEnvelope(input);
    const { payload } = await openAndVerifyEnvelope(cek, sealed, document);
    // Server attests this recipient as j***@example.com.
    expect(signatureIdentityMatches(payload, "j***@example.com")).toBe(true);
  });

  it("rejects a cryptographically-valid signature that claims a different identity", async () => {
    // A recipient signs a VALID envelope (their own ephemeral key, correct doc
    // hash) but types someone else's email — the math is valid, the identity
    // is not the server-verified recipient.
    const sealed = await createSignedEnvelope({ ...input, signerEmail: "ceo@bigcorp.com" });
    const result = await openAndVerifyEnvelope(cek, sealed, document);
    expect(result.valid).toBe(true); // ECDSA + doc hash are genuinely valid
    // ...but the server's verified recipient is jane, so identity must not match.
    expect(signatureIdentityMatches(result.payload, "j***@example.com")).toBe(false);
  });

  it("treats a missing server hint as unconfirmed identity", async () => {
    const sealed = await createSignedEnvelope(input);
    const { payload } = await openAndVerifyEnvelope(cek, sealed, document);
    expect(signatureIdentityMatches(payload, null)).toBe(false);
  });
});
