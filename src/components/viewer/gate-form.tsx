"use client";

import { Notice } from "../bits";
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

/** The burn-after-read interstitial: fogged pane + OTP/password gates. */
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
    <section className="space-y-5">
      <h1 className="font-display text-3xl">You&apos;ve received a sealed share.</h1>

      {/* The fogged pane: content exists, but stays illegible until revealed. */}
      <div className="relative overflow-hidden rounded-sm border border-mist bg-pane p-6">
        <div aria-hidden className="space-y-3 select-none blur-[6px]">
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
                className="min-w-0 flex-1 rounded-sm border border-mist bg-white/60 px-3 py-2 text-sm placeholder:text-faded/60 focus:border-verdigris focus:outline-none"
              />
              <button
                type="button"
                onClick={onSendCode}
                disabled={!email.includes("@")}
                className="shrink-0 rounded-sm border border-mist px-3 py-2 text-sm hover:border-verdigris hover:text-verdigris disabled:opacity-50"
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
                className="w-40 rounded-sm border border-mist bg-white/60 px-3 py-2 text-center font-mono text-lg tracking-[0.3em] placeholder:text-faded/40 focus:border-verdigris focus:outline-none"
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
            className="w-full rounded-sm border border-mist bg-white/60 px-3 py-2 text-sm focus:border-verdigris focus:outline-none"
          />
          <span className="mt-1 block text-xs text-faded">
            The sender set a password. It combines with the link&apos;s key in your browser — it
            is never sent to the server.
          </span>
        </label>
      ) : null}

      {gate.error ? <Notice tone="error">{gate.error}</Notice> : null}

      {!gate.accessed ? (
        <Notice tone="warn">
          Opening may use one of this share&apos;s limited views — don&apos;t open it until
          you&apos;re ready to read it.
        </Notice>
      ) : null}

      <button
        type="button"
        onClick={onReveal}
        disabled={!ready}
        className="w-full rounded-sm bg-verdigris px-4 py-3 text-sm font-medium text-white hover:bg-verdigris-deep disabled:opacity-60"
      >
        Decrypt &amp; open
      </button>
    </section>
  );
}
