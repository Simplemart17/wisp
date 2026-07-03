"use client";

import { useEffect, useState } from "react";

import { type SigningState, ShareApiError, submitSignature } from "@/lib/client/shares";
import {
  type VerifiedSignature,
  createSignedEnvelope,
  openAndVerifyEnvelope,
} from "@/lib/client/signing";
import { fromBase64Url } from "@/lib/crypto";
import { Notice } from "./bits";

interface SignaturesProps {
  cek: Uint8Array;
  blob: Blob;
  linkId: string;
  signerEmail: string | null;
  signing: SigningState;
}

type SignPhase =
  | { name: "idle" }
  | { name: "working" }
  | { name: "done"; signedAt: string }
  | { name: "error"; message: string };

/**
 * Signature request + verification (zero-knowledge signing). Every envelope
 * is decrypted and cryptographically verified in this browser against the
 * exact bytes the viewer just decrypted — the ✓ is local math, not a server
 * claim. The signer's identity underneath it is the OTP-verified email.
 */
export function SigningPanel({ cek, blob, linkId, signerEmail, signing }: SignaturesProps) {
  const [verified, setVerified] = useState<VerifiedSignature[] | null>(null);
  const [name, setName] = useState("");
  const [phase, setPhase] = useState<SignPhase>({ name: "idle" });

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      signing.envelopes
        .filter((e) => e.encryptedEnvelope !== null)
        .map((e) => openAndVerifyEnvelope(cek, fromBase64Url(e.encryptedEnvelope!), blob).catch(() => null)),
    ).then((results) => {
      if (!cancelled) setVerified(results.filter((r): r is VerifiedSignature => r !== null));
    });
    return () => {
      cancelled = true;
    };
  }, [cek, blob, signing.envelopes]);

  async function sign() {
    if (!signing.ticket || !signerEmail) return;
    setPhase({ name: "working" });
    try {
      const envelope = await createSignedEnvelope({
        cek,
        document: blob,
        linkId,
        signerEmail,
        signerName: name,
      });
      await submitSignature(linkId, signing.ticket, envelope);
      const own = await openAndVerifyEnvelope(cek, envelope, blob);
      setVerified((v) => [...(v ?? []), own]);
      setPhase({ name: "done", signedAt: own.payload.signedAt });
    } catch (err) {
      if (err instanceof ShareApiError && err.kind === "already_signed") {
        setPhase({ name: "error", message: "You have already signed this document." });
      } else {
        setPhase({ name: "error", message: err instanceof Error ? err.message : "Signing failed." });
      }
    }
  }

  const canSign =
    signing.ticket !== null && !signing.alreadySigned && phase.name !== "done" && signerEmail !== null;

  return (
    <div className="space-y-4 rounded-sm border border-verdigris/30 bg-verdigris/5 p-4">
      <h2 className="flex items-baseline justify-between">
        <span className="text-sm font-medium">Signatures</span>
        <span className="font-mono text-[10px] uppercase tracking-widest text-faded">
          verified in your browser
        </span>
      </h2>

      {verified === null ? (
        <p className="font-mono text-xs text-faded">Verifying signatures…</p>
      ) : verified.length === 0 && phase.name !== "done" ? (
        <p className="text-xs text-faded">No one has signed yet.</p>
      ) : (
        <ul className="space-y-2">
          {verified.map((sig, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <span className={sig.valid ? "text-verdigris" : "text-wax"}>
                {sig.valid ? "✓" : "✗"}
              </span>
              <span className="min-w-0">
                <span className="font-medium">{sig.payload.signerName}</span>{" "}
                <span className="font-mono text-xs text-faded">({sig.payload.signerEmail})</span>
                <span className="block text-xs text-faded">
                  {sig.valid
                    ? `signed ${new Date(sig.payload.signedAt).toLocaleString()} — cryptographic signature over this exact document`
                    : `INVALID: ${sig.problem}`}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {canSign ? (
        <div className="space-y-3 border-t border-verdigris/20 pt-3">
          <p className="text-xs leading-relaxed text-faded">
            Your signature is requested. Signing generates a cryptographic signature over this
            exact document, tied to <span className="font-mono">{signerEmail}</span> — it can be
            verified by anyone who can open this share.
          </p>
          <label className="block">
            <span className="mb-1 block text-sm">Type your full legal name to sign</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jane Q. Signer"
              className="w-full rounded-sm border border-mist bg-white/60 px-3 py-2 font-display text-lg italic placeholder:not-italic placeholder:font-sans placeholder:text-sm placeholder:text-faded/60 focus:border-verdigris focus:outline-none"
            />
          </label>
          {phase.name === "error" ? <Notice tone="error">{phase.message}</Notice> : null}
          <button
            type="button"
            onClick={() => void sign()}
            disabled={name.trim().length < 2 || phase.name === "working"}
            className="w-full rounded-sm bg-verdigris px-4 py-2.5 text-sm font-medium text-white hover:bg-verdigris-deep disabled:opacity-60"
          >
            {phase.name === "working" ? "Signing…" : "Sign this document"}
          </button>
        </div>
      ) : null}

      {phase.name === "done" ? (
        <Notice tone="info">
          Signed and sealed. The sender and other recipients can now verify your signature.
        </Notice>
      ) : null}
      {signing.alreadySigned && phase.name !== "done" ? (
        <p className="text-xs text-faded">You have already signed this document.</p>
      ) : null}
    </div>
  );
}
