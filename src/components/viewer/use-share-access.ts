"use client";

import { useEffect, useRef, useState } from "react";

import {
  type AccessedShare,
  ShareApiError,
  type SigningState,
  type WatermarkPayload,
  accessShare,
  decryptAccessedShare,
  fetchShareStatus,
  requestOtp,
} from "@/lib/client/shares";
import { WispCryptoError, type ShareMetadata } from "@/lib/crypto";

export interface GateState {
  requiresPassword: boolean;
  requiresIdentity: boolean;
  hasViewLimit: boolean;
  otpSent: boolean;
  error?: string;
  accessed?: AccessedShare;
}

export type Phase =
  | { name: "loading" }
  | { name: "missing-key" }
  | { name: "unavailable"; kind: "gone" | "expired" | "exhausted" }
  | ({ name: "gate" } & GateState)
  | { name: "working"; label: string }
  | {
      name: "open";
      blob: Blob;
      metadata: ShareMetadata;
      cek: Uint8Array;
      remainingViews: number | null;
      signing: SigningState | null;
      signerEmail: string | null;
      viewOnly: boolean;
      watermark: WatermarkPayload | null;
    }
  | { name: "error"; message: string };

export type GatePhase = Extract<Phase, { name: "gate" }>;

/**
 * The recipient viewer's state machine: status load → gate (OTP/password) →
 * access → local decrypt. All the access orchestration and error taxonomy
 * lives here so the components are purely presentational. The link-key from
 * the URL fragment never leaves this hook.
 */
export function useShareAccess(id: string) {
  const [phase, setPhase] = useState<Phase>({ name: "loading" });
  const linkKeyRef = useRef("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");

  useEffect(() => {
    const fragment = window.location.hash.slice(1);
    linkKeyRef.current = fragment;
    (fragment ? fetchShareStatus(id) : Promise.resolve(null))
      .then((status) => {
        if (status === null) setPhase({ name: "missing-key" });
        else if (status.expired) setPhase({ name: "unavailable", kind: "expired" });
        else if (status.exhausted) setPhase({ name: "unavailable", kind: "exhausted" });
        else
          setPhase({
            name: "gate",
            requiresPassword: status.requiresPassword,
            requiresIdentity: status.requiresIdentity,
            hasViewLimit: status.hasViewLimit,
            otpSent: false,
          });
      })
      .catch((err) => {
        if (err instanceof ShareApiError && err.status === 404) {
          setPhase({ name: "unavailable", kind: "gone" });
        } else {
          setPhase({ name: "error", message: err instanceof Error ? err.message : "Failed to load." });
        }
      });
  }, [id]);

  async function sendCode(gate: GatePhase) {
    try {
      setPhase({ ...gate, error: undefined });
      await requestOtp(id, email);
      setPhase({ ...gate, otpSent: true, error: undefined });
    } catch (err) {
      setPhase({ ...gate, error: err instanceof Error ? err.message : "Sending the code failed." });
    }
  }

  async function reveal(gate: GatePhase) {
    // Reuse the already-consumed access on password retries — a wrong password
    // must never burn a second view.
    let accessed = gate.accessed;
    try {
      if (!accessed) {
        setPhase({ name: "working", label: "Requesting access…" });
        accessed = await accessShare(id, gate.requiresIdentity ? { email, code } : undefined);
      }
      setPhase({ name: "working", label: "Decrypting in your browser…" });
      const opened = await decryptAccessedShare(accessed, linkKeyRef.current, password || undefined);
      setPhase({
        name: "open",
        ...opened,
        remainingViews: accessed.remainingViews,
        signing: accessed.signing,
        signerEmail: gate.requiresIdentity ? email : null,
        viewOnly: accessed.viewOnly,
        watermark: accessed.watermark,
      });
    } catch (err) {
      setPhase(classifyRevealError(err, gate, accessed));
    }
  }

  return {
    phase,
    email,
    setEmail,
    code,
    setCode,
    password,
    setPassword,
    sendCode,
    reveal,
  };
}

/** Map a reveal() failure to the next phase (unavailable / retryable gate / error). */
function classifyRevealError(err: unknown, gate: GatePhase, accessed?: AccessedShare): Phase {
  if (err instanceof ShareApiError && (err.kind === "expired" || err.kind === "exhausted")) {
    return { name: "unavailable", kind: err.kind };
  }
  if (err instanceof ShareApiError && err.status === 404) {
    return { name: "unavailable", kind: "gone" };
  }
  if (err instanceof ShareApiError && err.status === 401) {
    return { ...gate, error: err.message };
  }
  if (err instanceof WispCryptoError && err.code === "PASSWORD_REQUIRED") {
    return { ...gate, accessed, error: "This share needs its password to decrypt." };
  }
  if (err instanceof WispCryptoError && err.code === "DECRYPT_FAILED") {
    return {
      ...gate,
      accessed,
      error: gate.requiresPassword
        ? "Decryption failed — wrong password, or the link is damaged. Retrying won't use another view."
        : "Decryption failed — the link looks damaged (its #key may be truncated).",
    };
  }
  return { name: "error", message: err instanceof Error ? err.message : "Failed to open." };
}
