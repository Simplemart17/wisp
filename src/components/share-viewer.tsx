"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  type AccessedShare,
  ShareApiError,
  accessShare,
  decryptAccessedShare,
  fetchShareStatus,
} from "@/lib/client/shares";
import { WispCryptoError, type ShareMetadata } from "@/lib/crypto";
import { utf8Decode } from "@/lib/crypto/encoding";
import { Notice, formatBytes } from "./bits";

type Phase =
  | { name: "loading" }
  | { name: "missing-key" }
  | { name: "unavailable"; kind: "gone" | "expired" | "exhausted" }
  | { name: "gate"; requiresPassword: boolean; error?: string; accessed?: AccessedShare }
  | { name: "working"; label: string }
  | { name: "open"; data: Uint8Array; metadata: ShareMetadata; remainingViews: number | null }
  | { name: "error"; message: string };

const UNAVAILABLE_COPY: Record<"gone" | "expired" | "exhausted", { title: string; body: string }> = {
  gone: {
    title: "Nothing here.",
    body: "This share doesn't exist — it may have been revoked, swept after expiry, or the link is wrong.",
  },
  expired: {
    title: "This share has expired.",
    body: "Its time limit passed, so the server will no longer release the ciphertext. Ask the sender for a fresh link.",
  },
  exhausted: {
    title: "No views remain.",
    body: "Every allowed view of this share has been used. Ask the sender for a fresh link if you still need it.",
  },
};

export function ShareViewer({ id }: { id: string }) {
  const [phase, setPhase] = useState<Phase>({ name: "loading" });
  const linkKeyRef = useRef("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    const fragment = window.location.hash.slice(1);
    linkKeyRef.current = fragment;
    (fragment ? fetchShareStatus(id) : Promise.resolve(null))
      .then((status) => {
        if (status === null) setPhase({ name: "missing-key" });
        else if (status.expired) setPhase({ name: "unavailable", kind: "expired" });
        else if (status.exhausted) setPhase({ name: "unavailable", kind: "exhausted" });
        else setPhase({ name: "gate", requiresPassword: status.requiresPassword });
      })
      .catch((err) => {
        if (err instanceof ShareApiError && err.status === 404) {
          setPhase({ name: "unavailable", kind: "gone" });
        } else {
          setPhase({ name: "error", message: err instanceof Error ? err.message : "Failed to load." });
        }
      });
  }, [id]);

  async function reveal(gate: Extract<Phase, { name: "gate" }>) {
    // Reuse the already-consumed access on password retries — a wrong password
    // must never burn a second view.
    let accessed = gate.accessed;
    try {
      if (!accessed) {
        setPhase({ name: "working", label: "Requesting access…" });
        accessed = await accessShare(id);
      }
      setPhase({ name: "working", label: "Decrypting in your browser…" });
      const opened = await decryptAccessedShare(accessed, linkKeyRef.current, password || undefined);
      setPhase({ name: "open", ...opened, remainingViews: accessed.remainingViews });
    } catch (err) {
      if (err instanceof ShareApiError && (err.kind === "expired" || err.kind === "exhausted")) {
        setPhase({ name: "unavailable", kind: err.kind });
      } else if (err instanceof ShareApiError && err.status === 404) {
        setPhase({ name: "unavailable", kind: "gone" });
      } else if (err instanceof WispCryptoError && err.code === "PASSWORD_REQUIRED") {
        setPhase({ ...gate, accessed, error: "This share needs its password to decrypt." });
      } else if (err instanceof WispCryptoError && err.code === "DECRYPT_FAILED") {
        setPhase({
          ...gate,
          accessed,
          error: gate.requiresPassword
            ? "Decryption failed — wrong password, or the link is damaged. Retrying won't use another view."
            : "Decryption failed — the link looks damaged (its #key may be truncated).",
        });
      } else {
        setPhase({ name: "error", message: err instanceof Error ? err.message : "Failed to open." });
      }
    }
  }

  if (phase.name === "loading") {
    return <p className="font-mono text-sm text-faded">Checking the seal…</p>;
  }

  if (phase.name === "missing-key") {
    return (
      <section className="space-y-3">
        <h1 className="font-display text-3xl">The key is missing.</h1>
        <Notice tone="warn">
          This link has no <span className="font-mono">#key</span> fragment, so nothing can be
          decrypted. Make sure you copied the entire link — some apps cut it at the{" "}
          <span className="font-mono">#</span>.
        </Notice>
      </section>
    );
  }

  if (phase.name === "unavailable") {
    const copy = UNAVAILABLE_COPY[phase.kind];
    return (
      <section className="space-y-3">
        <h1 className="font-display text-3xl">{copy.title}</h1>
        <p className="text-sm leading-relaxed text-faded">{copy.body}</p>
      </section>
    );
  }

  if (phase.name === "error") {
    return <Notice tone="error">{phase.message}</Notice>;
  }

  if (phase.name === "working") {
    return <p className="font-mono text-sm text-faded">{phase.label}</p>;
  }

  if (phase.name === "gate") {
    return (
      <section className="space-y-5">
        <h1 className="font-display text-3xl">You&apos;ve received a sealed share.</h1>

        {/* The fogged pane: content exists, but stays illegible until revealed. */}
        <div className="relative overflow-hidden rounded-sm border border-mist bg-pane p-6">
          <div aria-hidden className="space-y-3 blur-[6px] select-none">
            <div className="h-3 w-4/5 rounded-full bg-faded/30" />
            <div className="h-3 w-3/5 rounded-full bg-faded/25" />
            <div className="h-3 w-2/3 rounded-full bg-faded/30" />
            <div className="h-3 w-2/5 rounded-full bg-faded/20" />
          </div>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-verdigris bg-paper font-display text-xl italic text-verdigris shadow-sm">
              W
            </span>
          </div>
        </div>

        {phase.requiresPassword ? (
          <label className="block">
            <span className="mb-1 block text-sm">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="off"
              autoFocus
              className="w-full rounded-sm border border-mist bg-white/60 px-3 py-2 text-sm focus:border-verdigris focus:outline-none"
            />
            <span className="mt-1 block text-xs text-faded">
              The sender set a password. It combines with the link&apos;s key in your browser —
              it is never sent to the server.
            </span>
          </label>
        ) : null}

        {phase.error ? <Notice tone="error">{phase.error}</Notice> : null}

        {!phase.accessed ? (
          <Notice tone="warn">
            Opening may use one of this share&apos;s limited views — don&apos;t open it until
            you&apos;re ready to read it.
          </Notice>
        ) : null}

        <button
          type="button"
          onClick={() => void reveal(phase)}
          disabled={phase.requiresPassword && !password}
          className="w-full rounded-sm bg-verdigris px-4 py-3 text-sm font-medium text-white hover:bg-verdigris-deep disabled:opacity-60"
        >
          Decrypt &amp; open
        </button>
      </section>
    );
  }

  return <OpenedView data={phase.data} metadata={phase.metadata} remainingViews={phase.remainingViews} />;
}

function OpenedView({
  data,
  metadata,
  remainingViews,
}: {
  data: Uint8Array;
  metadata: ShareMetadata;
  remainingViews: number | null;
}) {
  const isText = metadata.type.startsWith("text/");
  const isImage = metadata.type.startsWith("image/");

  const objectUrl = useMemo(() => {
    if (!isImage) return null;
    return URL.createObjectURL(new Blob([data as BlobPart], { type: metadata.type }));
  }, [data, metadata.type, isImage]);
  useEffect(() => () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }, [objectUrl]);

  function download() {
    const url = URL.createObjectURL(new Blob([data as BlobPart], { type: metadata.type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = metadata.name;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="unfog space-y-4">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="min-w-0 truncate font-mono text-sm">{metadata.name}</h1>
        <span className="shrink-0 font-mono text-xs text-faded">{formatBytes(metadata.size)}</span>
      </div>

      {isText ? (
        <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-sm border border-mist bg-white/60 p-4 font-mono text-sm leading-relaxed">
          {utf8Decode(data)}
        </pre>
      ) : isImage && objectUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- decrypted blob URL, next/image can't optimize it
        <img
          src={objectUrl}
          alt={metadata.name}
          className="max-h-[60vh] w-full rounded-sm border border-mist object-contain"
        />
      ) : (
        <div className="rounded-sm border border-mist bg-pane p-6 text-center text-sm text-faded">
          This file type can&apos;t be previewed here — download it to open it.
        </div>
      )}

      <div className="flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={download}
          className="rounded-sm border border-mist px-4 py-2 text-sm hover:border-verdigris hover:text-verdigris"
        >
          Download
        </button>
        {remainingViews !== null ? (
          <span className="font-mono text-xs text-faded">
            {remainingViews === 0
              ? "that was the last view"
              : `${remainingViews} view${remainingViews === 1 ? "" : "s"} left`}
          </span>
        ) : null}
      </div>

      <p className="text-xs leading-relaxed text-faded">
        Decrypted locally — the plaintext never left your browser&apos;s memory.
      </p>
    </section>
  );
}
