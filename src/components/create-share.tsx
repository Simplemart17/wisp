"use client";

import { useRef, useState } from "react";

import { utf8Encode } from "@/lib/crypto/encoding";
import { type CreateStep, type ShareReceipt, createShareFlow } from "@/lib/client/shares";
import { isCanvasRenderable } from "@/lib/client/render/canvas";
import {
  CONTROL,
  CONTROL_XS,
  CopyField,
  Notice,
  SectionLabel,
  TierChip,
  TierLegend,
  formatBytes,
} from "./bits";

const MAX_PLAINTEXT_BYTES = 100 * 1024 * 1024;

const EXPIRY_CHOICES = [
  { value: "1h", label: "1 hour" },
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
] as const;

const VIEW_CHOICES = [
  { value: "", label: "Unlimited views" },
  { value: "1", label: "1 view (burn after reading)" },
  { value: "3", label: "3 views" },
  { value: "10", label: "10 views" },
] as const;

const STEP_ORDER: CreateStep[] = ["encrypting", "uploading", "registering", "notifying"];

const STEP_LABELS: Record<CreateStep, string> = {
  encrypting: "Encrypting in your browser…",
  uploading: "Uploading ciphertext…",
  registering: "Registering the share…",
  notifying: "Emailing recipient links…",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;


interface PolicyState {
  expiresIn: string;
  maxViews: string;
  requireIdentity: boolean;
  requireSignature: boolean;
  viewOnly: boolean;
  watermark: boolean;
  notify: boolean;
}

// Hints follow one template — duration · views · who can open — so the eye
// compares presets column by column.
const PRESETS: Array<{ name: string; hint: string; state: PolicyState; wantsPassword: boolean }> = [
  {
    name: "Maximum privacy",
    hint: "24h · 1 view · locked + watermarked",
    state: { expiresIn: "24h", maxViews: "1", requireIdentity: true, requireSignature: false, viewOnly: true, watermark: true, notify: false },
    wantsPassword: true,
  },
  {
    name: "Standard",
    hint: "7 days · 3 views · verified recipients",
    state: { expiresIn: "7d", maxViews: "3", requireIdentity: true, requireSignature: false, viewOnly: false, watermark: false, notify: true },
    wantsPassword: false,
  },
  {
    name: "Quick share",
    hint: "7 days · unlimited · anyone with the link",
    state: { expiresIn: "7d", maxViews: "", requireIdentity: false, requireSignature: false, viewOnly: false, watermark: false, notify: false },
    wantsPassword: false,
  },
];

type Phase =
  | { name: "form" }
  | { name: "working"; step: CreateStep }
  | { name: "receipt"; receipt: ShareReceipt; summary: string };

/** A policy toggle: label + tier always visible, one-line summary when off,
    the full caveat only once the sender has opted in. */
function PolicyToggle({
  label,
  tier,
  checked,
  disabled = false,
  onChange,
  summary,
  detail,
  children,
}: {
  label: string;
  tier: Parameters<typeof TierChip>[0]["tier"];
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  summary: string;
  detail?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <label className={`flex items-start gap-3 ${disabled ? "opacity-60" : ""}`}>
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-ink"
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-sm">
            {label}
            <span className="ml-auto">
              <TierChip tier={tier} />
            </span>
          </span>
          <span className="block text-xs leading-relaxed text-faded">
            {summary}
            {checked && detail ? <> {detail}</> : null}
          </span>
        </span>
      </label>
      {checked && children ? <div className="mt-2 pl-7">{children}</div> : null}
    </div>
  );
}

export function CreateShare() {
  const [mode, setMode] = useState<"message" | "file">("message");
  const [message, setMessage] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [policy, setPolicy] = useState<PolicyState>(PRESETS[2].state);
  const [password, setPassword] = useState("");
  const [recipientsText, setRecipientsText] = useState("");
  const [sendEmails, setSendEmails] = useState(true);
  const [notifyEmail, setNotifyEmail] = useState("");
  const [activePreset, setActivePreset] = useState<string | null>("Quick share");
  const [phase, setPhase] = useState<Phase>({ name: "form" });
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);

  // Message shares are plain text (canvas-renderable). File shares qualify only
  // for text/image/pdf — the types view-only + watermark can actually protect.
  const fileRenderable = mode === "message" || (!!file && isCanvasRenderable(file.type || ""));

  function setPolicyField<K extends keyof PolicyState>(key: K, value: PolicyState[K]) {
    setPolicy((p) => ({ ...p, [key]: value }));
    setActivePreset(null);
  }

  function applyPreset(preset: (typeof PRESETS)[number]) {
    setPolicy(preset.state);
    setActivePreset(preset.name);
    if (preset.wantsPassword) setTimeout(() => passwordInput.current?.focus(), 0);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    let data: Uint8Array | Blob;
    let size: number;
    let name: string;
    let type: string;
    if (mode === "message") {
      if (!message.trim()) return setError("Write a message first.");
      data = utf8Encode(message);
      size = data.length;
      name = "message.txt";
      type = "text/plain";
    } else {
      if (!file) return setError("Choose a file first.");
      if (file.size > MAX_PLAINTEXT_BYTES) {
        return setError(`Files are capped at ${formatBytes(MAX_PLAINTEXT_BYTES)} for now.`);
      }
      data = file; // streamed chunk-by-chunk — never fully in memory
      size = file.size;
      name = file.name;
      type = file.type || "application/octet-stream";
    }

    let recipients: string[] = [];
    if (policy.requireIdentity) {
      recipients = [
        ...new Set(
          recipientsText
            .split(/[\n,;]+/)
            .map((e) => e.trim().toLowerCase())
            .filter(Boolean),
        ),
      ];
      if (recipients.length === 0) {
        return setError("Require identity needs at least one recipient email.");
      }
      const bad = recipients.find((e) => !EMAIL_RE.test(e));
      if (bad) return setError(`"${bad}" doesn't look like an email address.`);
      if (recipients.length > 20) return setError("At most 20 recipients per share.");
    }
    if (policy.notify && !EMAIL_RE.test(notifyEmail)) {
      return setError("Notify on open needs your email address.");
    }

    try {
      const receipt = await createShareFlow({
        data,
        metadata: { name, size, type },
        password: password || undefined,
        expiresIn: policy.expiresIn,
        maxViews: policy.maxViews === "" ? null : Number(policy.maxViews),
        requireIdentity: policy.requireIdentity,
        requireSignature: policy.requireSignature,
        recipients,
        viewOnly: policy.viewOnly && fileRenderable,
        watermark: policy.watermark && fileRenderable,
        notifyEmail: policy.notify ? notifyEmail : null,
        sendEmails: policy.requireIdentity && sendEmails,
        onStep: (step) => setPhase({ name: "working", step }),
      });
      const summary = [
        `expires in ${EXPIRY_CHOICES.find((c) => c.value === policy.expiresIn)?.label}`,
        policy.maxViews === ""
          ? "unlimited views"
          : `${policy.maxViews} view${policy.maxViews === "1" ? "" : "s"}${policy.requireIdentity ? " per recipient" : ""}`,
        password ? "password" : null,
        policy.requireIdentity ? `${recipients.length} verified recipient${recipients.length === 1 ? "" : "s"}` : null,
        policy.requireSignature ? "signature requested" : null,
        policy.viewOnly ? "view-only" : null,
        policy.watermark ? "watermarked" : null,
      ]
        .filter(Boolean)
        .join(" · ");
      setPhase({ name: "receipt", receipt, summary });
    } catch (err) {
      setPhase({ name: "form" });
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  if (phase.name === "receipt") {
    const { receipt, summary } = phase;
    return (
      <section className="my-auto space-y-6">
        {/* The seal — same ink disc language as the gate's lock. */}
        <div className="unfog flex items-center gap-3.5">
          <span className="elevate grid h-12 w-12 shrink-0 place-items-center rounded-full bg-ink text-verdigris">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="m5 13 4.5 4.5L19 8"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-4xl leading-none tracking-[-0.03em]">Sealed.</h1>
            <p className="mt-1.5 font-mono text-xs leading-relaxed text-faded">{summary}</p>
          </div>
        </div>

        <div className="elevate unfog space-y-5 rounded-md border border-mist bg-card p-5 [animation-delay:120ms]">
          {receipt.recipientLinks.length > 0 ? (
            <>
              {/* One link is a hero; five heroes are a flood — emphasize only
                  when there is a single artifact. */}
              {receipt.recipientLinks.map((r) => (
                <CopyField
                  key={r.url}
                  label={r.email}
                  value={r.url}
                  primary={receipt.recipientLinks.length === 1}
                  share
                />
              ))}
              <p className="text-xs leading-relaxed text-faded">
                {receipt.emailsSent > 0
                  ? `Each recipient was emailed their personal link (${receipt.emailsSent} sent). `
                  : "Send each person their own link — "}
                every link is tied to one email and verified with a one-time code before opening.
              </p>
            </>
          ) : (
            <div>
              <CopyField label="share link" value={receipt.shareUrl} primary share />
              <p className="mt-2 text-xs leading-relaxed text-faded">
                Safe to send — but it carries the key after the{" "}
                <span className="font-mono text-ink">#</span>, so use a channel you trust.
              </p>
            </div>
          )}
          <div className="well -mx-2 rounded-sm px-4 py-4">
            <CopyField
              label="management link"
              value={receipt.manageUrl}
              hint="shown once — save it"
            />
            <p className="mt-2 text-xs leading-relaxed text-faded">
              Keep this one to yourself. It revokes the share and opens its audit log — it
              can&apos;t be recovered if lost.
            </p>
          </div>
        </div>

        <div className="rise flex justify-end [animation-delay:260ms]">
          <button
            type="button"
            onClick={() => {
              setPhase({ name: "form" });
              setMessage("");
              setFile(null);
              setPassword("");
              setRecipientsText("");
              if (fileInput.current) fileInput.current.value = "";
            }}
            className="rounded-sm border border-mist px-4 py-2.5 text-sm font-medium transition-colors hover:border-ink"
          >
            Seal another
          </button>
        </div>
      </section>
    );
  }

  const working = phase.name === "working";
  const stepIndex = working ? STEP_ORDER.indexOf((phase as { step: CreateStep }).step) + 1 : 0;

  return (
    <section className="rise">
      <h1 className="font-display text-4xl leading-[1.05] tracking-[-0.03em] sm:text-[2.75rem]">
        Share something
        <br />
        that <span className="text-verdigris-deep">disappears.</span>
      </h1>
      <p className="mt-3 mb-8 max-w-md text-[15px] leading-relaxed text-faded">
        Encrypted in your browser before it leaves. It expires, burns after reading, or vanishes
        on revoke — on your terms.
      </p>

      <div className="mb-8 grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-2.5">
        {PRESETS.map((preset) => {
          const active = activePreset === preset.name;
          return (
            <button
              key={preset.name}
              type="button"
              onClick={() => applyPreset(preset)}
              aria-pressed={active}
              className={`rounded-sm border px-3 py-2.5 text-left transition-all ${
                active ? "elevate border-ink bg-card" : "border-mist bg-card/60 hover:border-ink/40"
              }`}
            >
              <span className="flex items-center gap-1.5 text-sm font-semibold">
                {active ? (
                  <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-verdigris" />
                ) : null}
                {preset.name}
              </span>
              <span className="mt-1 block font-mono text-[11px] leading-snug text-faded">
                {preset.hint}
              </span>
            </button>
          );
        })}
      </div>

      <form onSubmit={submit} className="space-y-6">
        <div className="flex gap-1 border-b border-mist">
          {(["message", "file"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              className={`-mb-px border-b-2 px-4 py-2 text-sm capitalize transition-colors ${
                mode === m
                  ? "border-ink font-medium text-ink"
                  : "border-transparent text-faded hover:text-ink"
              }`}
            >
              {m}
            </button>
          ))}
        </div>

        {/* While sealing, the content itself fogs out — encryption, depicted.
            inert removes it from tab order and the a11y tree atomically. */}
        <div className={working ? "fog select-none" : ""} inert={working}>
          {mode === "message" ? (
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={6}
              placeholder="Write the message to seal…"
              className={`w-full resize-y p-3 font-mono leading-relaxed placeholder:text-hush ${CONTROL}`}
            />
          ) : (
            <label className="flex cursor-pointer flex-col items-center gap-1.5 rounded-sm border border-dashed border-mist bg-card px-4 py-10 text-sm text-faded transition-colors hover:border-verdigris hover:bg-verdigris/5 has-focus-visible:border-verdigris has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-verdigris">
              <input
                ref={fileInput}
                type="file"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="sr-only"
              />
              {file ? (
                <>
                  <span className="font-mono text-sm text-ink">{file.name}</span>
                  <span className="font-mono text-xs">{formatBytes(file.size)}</span>
                </>
              ) : (
                <>
                  <span className="font-medium text-ink">Choose a file to seal</span>
                  <span className="font-mono text-xs">up to {formatBytes(MAX_PLAINTEXT_BYTES)}</span>
                </>
              )}
            </label>
          )}
        </div>

        <fieldset className="space-y-4">
          <SectionLabel as="legend" className="mb-2">
            Policy
          </SectionLabel>
          <TierLegend />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 flex items-center gap-2 text-sm">
                Expires
                <span className="ml-auto">
                  <TierChip tier="server-enforced" />
                </span>
              </span>
              <select
                value={policy.expiresIn}
                onChange={(e) => setPolicyField("expiresIn", e.target.value)}
                className={`w-full px-2 py-2 ${CONTROL}`}
              >
                {EXPIRY_CHOICES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 flex items-center gap-2 text-sm">
                View limit
                <span className="ml-auto">
                  <TierChip tier="server-enforced" />
                </span>
              </span>
              <select
                value={policy.maxViews}
                onChange={(e) => setPolicyField("maxViews", e.target.value)}
                className={`w-full px-2 py-2 ${CONTROL}`}
              >
                {VIEW_CHOICES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
              {policy.requireIdentity && policy.maxViews !== "" ? (
                <span className="mt-1 block text-xs text-faded">
                  Each recipient gets their own link, so the limit applies per recipient.
                </span>
              ) : null}
            </label>
          </div>

          <label className="block">
            <span className="mb-1 flex items-center gap-2 text-sm">
              Password <span className="text-faded">(optional)</span>
              <span className="ml-auto">
                <TierChip tier="encrypted" />
              </span>
            </span>
            <input
              ref={passwordInput}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              className={`w-full px-3 py-2 placeholder:text-hush ${CONTROL}`}
            />
            <span className="mt-1 block text-xs text-faded">
              Adds a second key the link alone can&apos;t provide — it never reaches the server.
            </span>
          </label>

          <div className="space-y-3.5 rounded-sm border border-mist bg-pane/40 p-4">
            <PolicyToggle
              label="Require identity"
              tier="server-enforced"
              checked={policy.requireIdentity}
              onChange={(v) => setPolicyField("requireIdentity", v)}
              summary="Recipients verify their email with a one-time code before opening."
              detail="Each gets a personal link, and every open is logged against that identity."
            >
              <div className="space-y-2">
                <textarea
                  value={recipientsText}
                  onChange={(e) => setRecipientsText(e.target.value)}
                  rows={2}
                  placeholder={"jane@example.com, sam@example.com"}
                  className={`w-full p-2 font-mono placeholder:text-hush ${CONTROL_XS}`}
                />
                <label className="flex items-center gap-2 text-xs text-faded">
                  <input
                    type="checkbox"
                    checked={sendEmails}
                    onChange={(e) => setSendEmails(e.target.checked)}
                    className="accent-ink"
                  />
                  Email each recipient their link (links travel through email — add a password
                  for anything sensitive)
                </label>
              </div>
            </PolicyToggle>

            <PolicyToggle
              label="Request signature"
              tier="encrypted"
              checked={policy.requireSignature}
              onChange={(v) => {
                // A signature needs a verified signer — auto-enable identity.
                setPolicy((p) => ({
                  ...p,
                  requireSignature: v,
                  requireIdentity: v ? true : p.requireIdentity,
                }));
                setActivePreset(null);
              }}
              summary="Verified recipients can cryptographically sign the content."
              detail="Signed in their browser over the exact bytes, sealed so even the server can't read it — anyone who can open the share can verify it. Requires identity (enabled)."
            />

            <PolicyToggle
              label="View-only"
              tier="client-honored"
              checked={policy.viewOnly && fileRenderable}
              disabled={!fileRenderable}
              onChange={(v) => setPolicyField("viewOnly", v)}
              summary={
                fileRenderable
                  ? "Renders as pixels in the viewer — no download button."
                  : "Only text, images, and PDFs render view-only; other files fall back to an encrypted download."
              }
              detail="Deters saving; it cannot stop screenshots."
            />

            <PolicyToggle
              label="Watermark"
              tier="client-honored"
              checked={policy.watermark && fileRenderable}
              disabled={!fileRenderable}
              onChange={(v) => setPolicyField("watermark", v)}
              summary={
                fileRenderable
                  ? "Stamps the viewer's identity and time into the rendered pixels."
                  : "Needs a text, image, or PDF to render — not available for this file type."
              }
              detail={
                policy.watermark && fileRenderable && !policy.requireIdentity
                  ? "Leaks stay traceable, even via screenshot. Without “Require identity” it stamps the link id and time, not a person — enable both for accountability."
                  : "Leaks stay traceable, even via screenshot."
              }
            />

            <PolicyToggle
              label="Notify on open"
              tier="server-enforced"
              checked={policy.notify}
              onChange={(v) => setPolicyField("notify", v)}
              summary="Email you every time this share is opened."
            >
              <input
                type="email"
                value={notifyEmail}
                onChange={(e) => setNotifyEmail(e.target.value)}
                placeholder="you@example.com"
                aria-label="Your email for open notifications"
                className={`w-full px-2 py-1.5 placeholder:text-hush ${CONTROL_XS}`}
              />
            </PolicyToggle>
          </div>
        </fieldset>

        {error ? <Notice tone="error">{error}</Notice> : null}

        <button
          type="submit"
          disabled={working}
          className="group flex w-full items-center justify-center gap-2.5 rounded-sm bg-ink px-4 py-3.5 text-sm font-semibold text-paper transition-[background-color,transform] duration-150 hover:bg-verdigris-deep active:translate-y-px disabled:opacity-55"
        >
          {working ? (
            <span role="status" className="flex items-center gap-2.5">
              <span className="font-mono text-xs tracking-tight text-paper/60 tabular-nums">
                {stepIndex}/{STEP_ORDER.length}
              </span>
              {STEP_LABELS[(phase as { step: CreateStep }).step]}
            </span>
          ) : (
            <>
              Seal &amp; create link
              <span aria-hidden className="transition-transform group-hover:translate-x-0.5">
                →
              </span>
            </>
          )}
        </button>
      </form>
    </section>
  );
}
