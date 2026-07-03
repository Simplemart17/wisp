"use client";

import { Notice } from "../bits";
import { FoggedPane } from "./fogged-pane";
import type { GatePhase } from "./use-share-access";

export interface GateFormProps {
  gate: GatePhase;
  email: string;
  setEmail: (v: string) => void;
  code: string;
  setCode: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  onSendCode: () => void;
  onReveal: () => void;
}

/** The threshold: fogged ciphertext + whatever gates stand before the reveal. */
export function GateForm({
  gate,
  email,
  setEmail,
  code,
  setCode,
  password,
  setPassword,
  onSendCode,
  onReveal,
}: GateFormProps) {
  const identityIncomplete = gate.requiresIdentity && (!gate.otpSent || !/^\d{6}$/.test(code));
  const ready = !identityIncomplete && (!gate.requiresPassword || password.length > 0);

  return (
    <section className="rise group my-auto space-y-5">
      <h1 className="font-display text-3xl leading-tight sm:text-4xl sm:tracking-[-0.03em]">
        You&apos;ve received a sealed share.
      </h1>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) onReveal();
        }}
        className="space-y-5"
      >
        {/* Content exists but stays illegible until keyed — the app's core
            promise, rendered. Fog thins as intent builds toward the unlock. */}
        <FoggedPane thinOnIntent>
          <span className="elevate flex h-12 w-12 items-center justify-center rounded-full bg-ink text-paper ring-8 ring-card/70">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M6 10V8a6 6 0 1 1 12 0v2m-9 0h6a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3v-5a3 3 0 0 1 3-3Z"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-hush">
            sealed · aes-256-gcm
          </span>
        </FoggedPane>

        {gate.requiresIdentity ? (
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-sm">Your email</span>
              <div className="flex gap-2">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  placeholder="you@example.com"
                  className="min-w-0 flex-1 rounded-sm border border-mist bg-card px-3 py-2 text-sm placeholder:text-hush"
                />
                <button
                  type="button"
                  onClick={onSendCode}
                  disabled={!email.includes("@")}
                  className="shrink-0 rounded-sm border border-mist px-3 py-2 text-sm transition-colors hover:border-ink disabled:opacity-50"
                >
                  {gate.otpSent ? "Resend code" : "Email me a code"}
                </button>
              </div>
              <span className="mt-1 block text-xs text-faded">
                This share is locked to specific recipients. If your email is on the list,
                you&apos;ll receive a 6-digit code.
              </span>
            </label>

            {gate.otpSent ? (
              <label className="block">
                <span className="mb-1 block text-sm">Verification code</span>
                <input
                  inputMode="numeric"
                  pattern="\d*"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="123456"
                  autoFocus
                  className="w-40 rounded-sm border border-mist bg-card px-3 py-2 text-center font-mono text-lg tracking-[0.3em] placeholder:text-hush"
                />
              </label>
            ) : null}
          </div>
        ) : null}

        {gate.requiresPassword ? (
          <label className="block">
            <span className="mb-1 block text-sm">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="off"
              className="w-full rounded-sm border border-mist bg-card px-3 py-2 text-sm"
            />
            <span className="mt-1 block text-xs text-faded">
              The sender set a password. It combines with the link&apos;s key in your browser —
              it is never sent to the server.
            </span>
          </label>
        ) : null}

        {gate.error ? <Notice tone="error">{gate.error}</Notice> : null}

        <div className="space-y-2">
          <button
            type="submit"
            disabled={!ready}
            className="w-full rounded-sm bg-ink px-4 py-3.5 text-sm font-semibold text-paper transition-[background-color,transform] duration-150 hover:bg-verdigris-deep active:translate-y-px disabled:opacity-55"
          >
            Decrypt &amp; open
          </button>
          {gate.hasViewLimit && !gate.accessed ? (
            <p className="text-center font-mono text-xs tracking-tight text-faded">
              Opening uses one of this share&apos;s limited views — wait until you&apos;re ready
              to read.
            </p>
          ) : null}
        </div>
      </form>
    </section>
  );
}
