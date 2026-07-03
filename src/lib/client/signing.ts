/**
 * Zero-knowledge document signing.
 *
 * The signer's browser hashes the decrypted plaintext, generates an ephemeral
 * ECDSA P-256 keypair, and signs a canonical payload binding: the document
 * hash, the share link id, the signer's verified email + typed name, and the
 * time. The whole envelope is then sealed under an HKDF subkey of the CEK, so
 * the server stores an opaque blob — it attests WHO signed and WHEN (OTP
 * gate + timestamp), while WHAT was signed stays cryptographically bound but
 * invisible to it. Anyone who can decrypt the share can verify locally.
 */
import { concatBytes, fromBase64Url, randomBytes, toBase64Url, utf8Decode, utf8Encode } from "@/lib/crypto/encoding";
import { WispCryptoError } from "@/lib/crypto/errors";

export const SIGNATURE_VERSION = 1;
const INFO_SIGNATURE_KEY = "wisp/v1/signature-key";
const AAD_SIGNATURE = utf8Encode("wisp/v1/sig");
const NONCE_LENGTH = 12;

export interface SignaturePayload {
  v: number;
  docHash: string; // base64url SHA-256 of the plaintext
  linkId: string; // the per-recipient share id the signer used
  signerEmail: string;
  signerName: string; // typed full name — the e-signature act
  signedAt: string; // ISO timestamp (client clock; server stores its own too)
}

export interface SignatureEnvelope {
  payload: SignaturePayload;
  publicKeyJwk: JsonWebKey;
  signature: string; // base64url ECDSA P-256 / SHA-256 over canonical payload
}

/** Deterministic serialization so signer and verifier hash identical bytes. */
export function canonicalPayloadBytes(payload: SignaturePayload): Uint8Array {
  const ordered = {
    v: payload.v,
    docHash: payload.docHash,
    linkId: payload.linkId,
    signerEmail: payload.signerEmail,
    signerName: payload.signerName,
    signedAt: payload.signedAt,
  };
  return utf8Encode(JSON.stringify(ordered));
}

export async function hashDocument(source: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await source.arrayBuffer());
  return toBase64Url(new Uint8Array(digest));
}

async function signatureAesKey(cek: Uint8Array, usage: KeyUsage): Promise<CryptoKey> {
  const ikm = await crypto.subtle.importKey("raw", cek as BufferSource, "HKDF", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: utf8Encode(INFO_SIGNATURE_KEY) },
    ikm,
    256,
  );
  return crypto.subtle.importKey("raw", bits, { name: "AES-GCM" }, false, [usage]);
}

export interface CreateSignatureInput {
  cek: Uint8Array;
  document: Blob;
  linkId: string;
  signerEmail: string;
  signerName: string;
}

/** Sign + seal. Returns the encrypted envelope ready for upload. */
export async function createSignedEnvelope(input: CreateSignatureInput): Promise<Uint8Array> {
  const payload: SignaturePayload = {
    v: SIGNATURE_VERSION,
    docHash: await hashDocument(input.document),
    linkId: input.linkId,
    signerEmail: input.signerEmail,
    signerName: input.signerName.trim(),
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
  const envelope: SignatureEnvelope = {
    payload,
    publicKeyJwk: await crypto.subtle.exportKey("jwk", keyPair.publicKey),
    signature: toBase64Url(signature),
  };

  const aesKey = await signatureAesKey(input.cek, "encrypt");
  const nonce = randomBytes(NONCE_LENGTH);
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce as BufferSource, additionalData: AAD_SIGNATURE as BufferSource },
      aesKey,
      utf8Encode(JSON.stringify(envelope)) as BufferSource,
    ),
  );
  return concatBytes(nonce, sealed);
}

export interface VerifiedSignature {
  payload: SignaturePayload;
  /** True only if the ECDSA signature checks out AND it covers this document. */
  valid: boolean;
  problem: string | null;
}

/** Same masking the server applies to recipients.email_hint, so the two compare. */
export function maskEmail(email: string): string {
  const [local, domain] = email.toLowerCase().trim().split("@");
  return domain ? `${local.slice(0, 1)}***@${domain}` : email;
}

/**
 * The envelope's signerEmail is CLIENT-asserted, so a valid signature alone
 * does not prove WHO signed. It is only trustworthy when it masks to the same
 * hint the server derived from the OTP-verified recipient. A null hint means
 * the server didn't attest this envelope → identity unconfirmed.
 */
export function signatureIdentityMatches(
  payload: SignaturePayload,
  serverEmailHint: string | null,
): boolean {
  return serverEmailHint !== null && maskEmail(payload.signerEmail) === serverEmailHint;
}

/** Decrypt an envelope and verify it against the document the viewer holds. */
export async function openAndVerifyEnvelope(
  cek: Uint8Array,
  encryptedEnvelope: Uint8Array,
  document: Blob,
): Promise<VerifiedSignature> {
  const aesKey = await signatureAesKey(cek, "decrypt");
  const nonce = encryptedEnvelope.slice(0, NONCE_LENGTH);
  const sealed = encryptedEnvelope.slice(NONCE_LENGTH);

  let envelope: SignatureEnvelope;
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonce as BufferSource, additionalData: AAD_SIGNATURE as BufferSource },
      aesKey,
      sealed as BufferSource,
    );
    envelope = JSON.parse(utf8Decode(new Uint8Array(plain))) as SignatureEnvelope;
  } catch {
    throw new WispCryptoError("DECRYPT_FAILED", "Signature envelope cannot be opened");
  }

  const { payload } = envelope;
  if (payload.v !== SIGNATURE_VERSION) {
    return { payload, valid: false, problem: "Unsupported signature version" };
  }

  if (payload.docHash !== (await hashDocument(document))) {
    return { payload, valid: false, problem: "Signature covers a different document" };
  }

  try {
    const publicKey = await crypto.subtle.importKey(
      "jwk",
      envelope.publicKeyJwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      fromBase64Url(envelope.signature) as BufferSource,
      canonicalPayloadBytes(payload) as BufferSource,
    );
    return ok
      ? { payload, valid: true, problem: null }
      : { payload, valid: false, problem: "Cryptographic signature check failed" };
  } catch {
    return { payload, valid: false, problem: "Malformed signature key" };
  }
}
