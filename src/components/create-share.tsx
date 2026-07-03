"use client";

import { useRef, useState } from "react";

import { utf8Encode } from "@/lib/crypto/encoding";
import { type CreateStep, type ShareReceipt, createShareFlow } from "@/lib/client/shares";
import { CopyField, Notice, TierChip, formatBytes } from "./bits";

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

const STEP_LABELS: Record<CreateStep, string> = {
  encrypting: "Encrypting in your browser…",
  uploading: "Uploading ciphertext…",
  registering: "Registering the share…",
  notifying: "Emailing recipient links…",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isRenderable(type: string): boolean {
  return (
    type.startsWith("text/") ||
    type.startsWith("image/") ||
    type.startsWith("audio/") ||
    type.startsWith("video/") ||
    type === "application/pdf"
  );
}

interface PolicyState {
  expiresIn: string;
  maxViews: string;
  requireIdentity: boolean;
  viewOnly: boolean;
  watermark: boolean;
  notify: boolean;
}

const PRESETS: Array<{ name: string; hint: string; state: PolicyState; wantsPassword: boolean }> = [
  {
    name: "Maximum privacy",
    hint: "view-only · watermark · identity · one-time · 24h · password",
    state: { expiresIn: "24h", maxViews: "1", requireIdentity: true, viewOnly: true, watermark: true, notify: false },
    wantsPassword: true,
  },
  {
    name: "Standard",
    hint: "identity · 7 days · 3 views · notify on open",
    state: { expiresIn: "7d", maxViews: "3", requireIdentity: true, viewOnly: false, watermark: false, notify: true },
    wantsPassword: false,
  },
  {
    name: "Quick share",
    hint: "link only · 7 days · unlimited",
    state: { expiresIn: "7d", maxViews: "", requireIdentity: false, viewOnly: false, watermark: false, notify: false },
    wantsPassword: false,
  },
];

type Phase =
  | { name: "form" }
  | { name: "working"; step: CreateStep }
  | { name: "receipt"; receipt: ShareReceipt; summary: string };

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

  const fileRenderable = mode === "message" || !file || isRenderable(file.type || "");

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
      recipients = recipientsText
        .split(/[\n,;]+/)
        .map((e) => e.trim())
        .filter(Boolean);
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
        recipients,
        viewOnly: policy.viewOnly && (mode === "message" || isRenderable(type)),
        watermark: policy.watermark,
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
      <section className="unfog space-y-5">
        <h1 className="font-display text-3xl">Sealed.</h1>
        <p className="text-sm text-faded">{summary}</p>

        <div className="space-y-5 border border-mist bg-white/60 p-5 border-dashed">
          {receipt.recipientLinks.length > 0 ? (
            <>
              {receipt.recipientLinks.map((r) => (
                <CopyField key={r.email} label={r.email} value={r.url} />
              ))}
              <p className="text-xs leading-relaxed text-faded">
                {receipt.emailsSent > 0
                  ? `Each recipient was emailed their personal link (${receipt.emailsSent} sent). `
                  : "Send each person their own link — "}
                every link is tied to one email and verified with a one-time code before opening.
              </p>
            </>
          ) : (
            <CopyField label="share link" value={receipt.shareUrl} />
          )}
          <CopyField label="management link" value={receipt.manageUrl} hint="shown once — save it" />
          <p className="text-xs leading-relaxed text-faded">
            The share link carries the decryption key after the{" "}
            <span className="font-mono">#</span> — send it over a channel you trust. The
            management link lets you revoke this share and see who opened it; it cannot be
            recovered if lost.
          </p>
        </div>

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
          className="rounded-sm border border-mist px-4 py-2 text-sm hover:border-verdigris hover:text-verdigris"
        >
          Seal another
        </button>
      </section>
    );
  }

  const working = phase.name === "working";

  return (
    <section>
      <h1 className="font-display text-3xl">
        Share something that <em className="text-verdigris">disappears</em>.
      </h1>
      <p className="mt-2 mb-6 text-sm leading-relaxed text-faded">
        Encrypted in your browser before it leaves. Expires on your terms.
      </p>

      <div className="mb-8 grid grid-cols-3 gap-2">
        {PRESETS.map((preset) => (
          <button
            key={preset.name}
            type="button"
            onClick={() => applyPreset(preset)}
            className={`rounded-sm border px-3 py-2 text-left ${
              activePreset === preset.name
                ? "border-verdigris bg-verdigris/5"
                : "border-mist hover:border-verdigris/50"
            }`}
          >
            <span className="block text-sm font-medium">{preset.name}</span>
            <span className="mt-0.5 block text-[11px] leading-tight text-faded">{preset.hint}</span>
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="space-y-6">
        <div className="flex gap-1 border-b border-mist">
          {(["message", "file"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm capitalize ${
                mode === m
                  ? "border-verdigris font-medium text-verdigris"
                  : "border-transparent text-faded hover:text-ink"
              }`}
            >
              {m}
            </button>
          ))}
        </div>

        {mode === "message" ? (
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={6}
            placeholder="Write the message to seal…"
            className="w-full resize-y rounded-sm border border-mist bg-white/60 p-3 font-mono text-sm leading-relaxed placeholder:text-faded/60 focus:border-verdigris focus:outline-none"
          />
        ) : (
          <label className="flex cursor-pointer flex-col items-center gap-1 rounded-sm border border-mist bg-white/60 px-4 py-8 text-sm text-faded border-dashed hover:border-verdigris">
            <input
              ref={fileInput}
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="sr-only"
            />
            {file ? (
              <>
                <span className="font-mono text-ink">{file.name}</span>
                <span className="font-mono text-xs">{formatBytes(file.size)}</span>
              </>
            ) : (
              <>
                <span>Choose a file to seal</span>
                <span className="font-mono text-xs">up to {formatBytes(MAX_PLAINTEXT_BYTES)}</span>
              </>
            )}
          </label>
        )}

        <fieldset className="space-y-4">
          <legend className="mb-3 font-mono text-[11px] uppercase tracking-widest text-faded">
            Policy
          </legend>

          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="mb-1 flex items-center gap-2 text-sm">
                Expires <TierChip tier="server-enforced" />
              </span>
              <select
                value={policy.expiresIn}
                onChange={(e) => setPolicyField("expiresIn", e.target.value)}
                className="w-full rounded-sm border border-mist bg-white/60 px-2 py-2 text-sm focus:border-verdigris focus:outline-none"
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
                View limit <TierChip tier="server-enforced" />
              </span>
              <select
                value={policy.maxViews}
                onChange={(e) => setPolicyField("maxViews", e.target.value)}
                className="w-full rounded-sm border border-mist bg-white/60 px-2 py-2 text-sm focus:border-verdigris focus:outline-none"
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
              Password <span className="text-faded">(optional)</span> <TierChip tier="encrypted" />
            </span>
            <input
              ref={passwordInput}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              placeholder="Adds a second key the link alone can't provide"
              className="w-full rounded-sm border border-mist bg-white/60 px-3 py-2 text-sm placeholder:text-faded/60 focus:border-verdigris focus:outline-none"
            />
          </label>

          <div className="space-y-3 rounded-sm border border-mist bg-white/40 p-4">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={policy.requireIdentity}
                onChange={(e) => setPolicyField("requireIdentity", e.target.checked)}
                className="mt-1 accent-verdigris"
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-sm">
                  Require identity <TierChip tier="server-enforced" />
                </span>
                <span className="block text-xs leading-relaxed text-faded">
                  Each recipient gets a personal link and verifies their email with a one-time
                  code. Every open is logged against that identity.
                </span>
              </span>
            </label>

            {policy.requireIdentity ? (
              <div className="space-y-2 pl-7">
                <textarea
                  value={recipientsText}
                  onChange={(e) => setRecipientsText(e.target.value)}
                  rows={2}
                  placeholder={"jane@example.com, sam@example.com"}
                  className="w-full rounded-sm border border-mist bg-white/60 p-2 font-mono text-xs placeholder:text-faded/60 focus:border-verdigris focus:outline-none"
                />
                <label className="flex items-center gap-2 text-xs text-faded">
                  <input
                    type="checkbox"
                    checked={sendEmails}
                    onChange={(e) => setSendEmails(e.target.checked)}
                    className="accent-verdigris"
                  />
                  Email each recipient their link (the link travels through email — add a
                  password for anything sensitive)
                </label>
              </div>
            ) : null}

            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={policy.viewOnly && fileRenderable}
                disabled={!fileRenderable}
                onChange={(e) => setPolicyField("viewOnly", e.target.checked)}
                className="mt-1 accent-verdigris"
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-sm">
                  View-only <TierChip tier="client-honored" />
                </span>
                <span className="block text-xs leading-relaxed text-faded">
                  {fileRenderable
                    ? "Renders to pixels in the Wisp viewer with no download button. Deters saving; cannot stop screenshots."
                    : "This file type can't be rendered in the viewer, so it will fall back to an encrypted download."}
                </span>
              </span>
            </label>

            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={policy.watermark}
                onChange={(e) => setPolicyField("watermark", e.target.checked)}
                className="mt-1 accent-verdigris"
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-sm">
                  Watermark <TierChip tier="client-honored" />
                </span>
                <span className="block text-xs leading-relaxed text-faded">
                  Burns the viewer&apos;s identity, time, and access id into the rendered pixels —
                  leaks stay traceable, even via screenshot.
                  {policy.watermark && !policy.requireIdentity
                    ? " Without “Require identity” it stamps the link id and time, not a person — enable both for accountability."
                    : ""}
                </span>
              </span>
            </label>

            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={policy.notify}
                onChange={(e) => setPolicyField("notify", e.target.checked)}
                className="mt-1 accent-verdigris"
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-sm">
                  Notify on open <TierChip tier="server-enforced" />
                </span>
                {policy.notify ? (
                  <input
                    type="email"
                    value={notifyEmail}
                    onChange={(e) => setNotifyEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="mt-1 w-full rounded-sm border border-mist bg-white/60 px-2 py-1.5 text-xs placeholder:text-faded/60 focus:border-verdigris focus:outline-none"
                  />
                ) : (
                  <span className="block text-xs text-faded">
                    Email you every time this share is opened.
                  </span>
                )}
              </span>
            </label>
          </div>
        </fieldset>

        {error ? <Notice tone="error">{error}</Notice> : null}

        <button
          type="submit"
          disabled={working}
          className="w-full rounded-sm bg-verdigris px-4 py-3 text-sm font-medium text-white hover:bg-verdigris-deep disabled:opacity-60"
        >
          {working ? STEP_LABELS[(phase as { step: CreateStep }).step] : "Encrypt & create link"}
        </button>
      </form>
    </section>
  );
}
