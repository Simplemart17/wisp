"use client";

import { Notice } from "./bits";
import { SigningPanel } from "./signing-panel";
import { FoggedPane } from "./viewer/fogged-pane";
import { GateForm } from "./viewer/gate-form";
import { OpenedView } from "./viewer/opened-view";
import { useShareAccess } from "./viewer/use-share-access";

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

/** Recipient viewer: renders the current phase of the access state machine. */
export function ShareViewer({ id }: { id: string }) {
  const access = useShareAccess(id);
  const { phase } = access;

  if (phase.name === "loading") {
    return <p className="my-auto font-mono text-sm text-faded">Checking the seal…</p>;
  }

  if (phase.name === "missing-key") {
    return (
      <section className="my-auto space-y-3">
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
      <section className="my-auto space-y-3">
        <h1 className="font-display text-3xl">{copy.title}</h1>
        <p className="text-sm leading-relaxed text-faded">{copy.body}</p>
      </section>
    );
  }

  if (phase.name === "error") {
    return (
      <div className="my-auto">
        <Notice tone="error">{phase.message}</Notice>
      </div>
    );
  }

  if (phase.name === "working") {
    // Keep the sealed pane on screen while the key turns — the unfog that
    // follows then reads as this exact surface clearing.
    return (
      <section className="my-auto space-y-5">
        <h1 className="font-display text-3xl leading-tight sm:text-4xl sm:tracking-[-0.03em]">
          You&apos;ve received a sealed share.
        </h1>
        <FoggedPane>
          <span className="flex items-center gap-2 font-mono text-xs text-faded" role="status">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-verdigris" />
            {phase.label}
          </span>
        </FoggedPane>
      </section>
    );
  }

  if (phase.name === "gate") {
    return (
      <GateForm
        gate={phase}
        email={access.email}
        setEmail={access.setEmail}
        code={access.code}
        setCode={access.setCode}
        password={access.password}
        setPassword={access.setPassword}
        onSendCode={() => void access.sendCode(phase)}
        onReveal={() => void access.reveal(phase)}
      />
    );
  }

  return (
    // my-auto centers short reveals to match the gate; tall content tops out.
    <div className="my-auto">
      <OpenedView
        blob={phase.blob}
        metadata={phase.metadata}
        remainingViews={phase.remainingViews}
        viewOnly={phase.viewOnly}
        watermark={phase.watermark}
        shareId={id}
      />
      {phase.signing?.required ? (
        <div className="mt-6">
          <SigningPanel
            cek={phase.cek}
            blob={phase.blob}
            linkId={id}
            signerEmail={phase.signerEmail}
            signing={phase.signing}
          />
        </div>
      ) : null}
    </div>
  );
}
