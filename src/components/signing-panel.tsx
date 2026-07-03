"use client";

import { useEffect, useState } from "react";

import { type SigningState, ShareApiError, submitSignature } from "@/lib/client/shares";
import {
  type VerifiedSignature,
  createSignedEnvelope,
  maskEmail,
  openAndVerifyEnvelope,
  signatureIdentityMatches,
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

interface DisplaySignature {
  verified: VerifiedSignature;
  /** Server-attested identity (from the OTP-verified recipient), the source of truth. */
  serverEmailHint: string | null;
  /** True only when the envelope's self-asserted email matches the server's. */
  identityMatches: boolean;
}

/**
 * Signature request + verification (zero-knowledge signing).
 *
 * Two independent facts are surfaced separately, because they answer different
 * questions:
 *  - The ✓ math: the ECDSA signature is valid over the exact bytes this browser
 *    decrypted — verified locally, not a server claim.
 *  - The identity: the envelope's signerEmail is CLIENT-asserted, so it is only
 *    trustworthy when it matches the server's OTP-verified recipient (email_hint,
 *    sent alongside each envelope). A valid signature whose asserted email does
 *    NOT match the verified recipient is shown as an identity mismatch — a signer
 *    cannot silently sign under someone else's name.
 */
export function SigningPanel({ cek, blob, linkId, signerEmail, signing }: SignaturesProps) {
  const [verified, setVerified] = useState<DisplaySignature[] | null>(null);
  const [name, setName] = useState("");
  const [phase, setPhase] = useState<SignPhase>({ name: "idle" });

  useEffect(() => {
    let cancelled = false;
    const withHints = signing.envelopes.filter((e) => e.encryptedEnvelope !== null);
    Promise.all(
      withHints.map((e) =>
        openAndVerifyEnvelope(cek, fromBase64Url(e.encryptedEnvelope!), blob)
          .then((v): DisplaySignature => ({
            verified: v,
            serverEmailHint: e.emailHint,
            identityMatches: signatureIdentityMatches(v.payload, e.emailHint),
          }))
          .catch(() => null),
      ),
    ).then((results) => {
      // Never clobber a locally-appended just-signed entry the async verify
      // didn't include.
      if (!cancelled) {
        setVerified((prev) => {
          const fresh = results.filter((r): r is DisplaySignature => r !== null);
          if (!prev) return fresh;
          const known = new Set(fresh.map((r) => r.verified.payload.signedAt));
          return [...fresh, ...prev.filter((p) => !known.has(p.verified.payload.signedAt))];
        });
      }
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
      // We just signed with our own OTP-verified email, so identity matches by
      // construction.
      const display: DisplaySignature = {
        verified: own,
        serverEmailHint: maskEmail(signerEmail),
        identityMatches: true,
      };
      setVerified((v) => [...(v ?? []), display]);
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
        <span className="font-mono text-[10px] tracking-tight text-faded">
          verified in your browser
        </span>
      </h2>

      {verified === null ? (
        <p className="font-mono text-xs text-faded">Verifying signatures…</p>
      ) : verified.length === 0 && phase.name !== "done" ? (
        <p className="text-xs text-faded">No one has signed yet.</p>
      ) : (
        <ul className="space-y-2">
          {verified.map((sig, i) => {
            const trusted = sig.verified.valid && sig.identityMatches;
            const mark = trusted ? "✓" : sig.verified.valid ? "⚠" : "✗";
            return (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className={trusted ? "text-verdigris" : "text-wax"}>{mark}</span>
                <span className="min-w-0">
                  <span className="font-medium">{sig.verified.payload.signerName}</span>{" "}
                  <span className="font-mono text-xs text-faded">
                    ({sig.serverEmailHint ?? sig.verified.payload.signerEmail})
                  </span>
                  <span className="block text-xs text-faded">
                    {!sig.verified.valid
                      ? `INVALID: ${sig.verified.problem}`
                      : !sig.identityMatches
                        ? `Signature is cryptographically valid but the signer's claimed email (${sig.verified.payload.signerEmail}) does not match the verified recipient — treat this identity as unconfirmed.`
                        : `signed ${new Date(sig.verified.payload.signedAt).toLocaleString()} — cryptographic signature over this exact document, by the verified recipient`}
                  </span>
                </span>
              </li>
            );
          })}
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
              className="w-full rounded-sm border border-mist bg-card px-3 py-2.5 font-display text-lg tracking-tight placeholder:text-sm placeholder:font-normal placeholder:tracking-normal placeholder:text-hush focus:border-verdigris focus:outline-none"
            />
          </label>
          {phase.name === "error" ? <Notice tone="error">{phase.message}</Notice> : null}
          <button
            type="button"
            onClick={() => void sign()}
            disabled={name.trim().length < 2 || phase.name === "working"}
            className="w-full rounded-sm bg-ink px-4 py-2.5 text-sm font-medium text-paper hover:bg-verdigris-deep disabled:opacity-60"
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
