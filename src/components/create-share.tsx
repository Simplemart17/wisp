"use client";

import { useRef, useState } from "react";

import { utf8Encode } from "@/lib/crypto/encoding";
import { type CreateStep, type ShareReceipt, createShareFlow } from "@/lib/client/shares";
import { CopyField, Notice, TierChip, formatBytes } from "./bits";

const MAX_PLAINTEXT_BYTES = 25 * 1024 * 1024;

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
};

type Phase =
  | { name: "form" }
  | { name: "working"; step: CreateStep }
  | { name: "receipt"; receipt: ShareReceipt; summary: string };

export function CreateShare() {
  const [mode, setMode] = useState<"message" | "file">("message");
  const [message, setMessage] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [expiresIn, setExpiresIn] = useState("7d");
  const [maxViews, setMaxViews] = useState("");
  const [password, setPassword] = useState("");
  const [phase, setPhase] = useState<Phase>({ name: "form" });
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    let data: Uint8Array;
    let name: string;
    let type: string;
    if (mode === "message") {
      if (!message.trim()) {
        setError("Write a message first.");
        return;
      }
      data = utf8Encode(message);
      name = "message.txt";
      type = "text/plain";
    } else {
      if (!file) {
        setError("Choose a file first.");
        return;
      }
      if (file.size > MAX_PLAINTEXT_BYTES) {
        setError(`Files are capped at ${formatBytes(MAX_PLAINTEXT_BYTES)} for now.`);
        return;
      }
      data = new Uint8Array(await file.arrayBuffer());
      name = file.name;
      type = file.type || "application/octet-stream";
    }

    try {
      const receipt = await createShareFlow({
        data,
        metadata: { name, size: data.length, type },
        password: password || undefined,
        expiresIn,
        maxViews: maxViews === "" ? null : Number(maxViews),
        onStep: (step) => setPhase({ name: "working", step }),
      });
      const summary = [
        `expires in ${EXPIRY_CHOICES.find((c) => c.value === expiresIn)?.label}`,
        maxViews === "" ? "unlimited views" : `${maxViews} view${maxViews === "1" ? "" : "s"}`,
        password ? "password required" : "link is the only key",
      ].join(" · ");
      setPhase({ name: "receipt", receipt, summary });
    } catch (err) {
      setPhase({ name: "form" });
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  if (phase.name === "receipt") {
    return (
      <section className="unfog space-y-5">
        <h1 className="font-display text-3xl">Sealed.</h1>
        <p className="text-sm text-faded">{phase.summary}</p>

        <div className="space-y-5 border border-mist bg-white/60 p-5 [border-style:dashed]">
          <CopyField label="share link" value={phase.receipt.shareUrl} />
          <CopyField
            label="management link"
            value={phase.receipt.manageUrl}
            hint="shown once — save it"
          />
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
      <p className="mt-2 mb-8 text-sm leading-relaxed text-faded">
        Encrypted in your browser before it leaves. Expires on your terms.
      </p>

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
          <label className="flex cursor-pointer flex-col items-center gap-1 rounded-sm border border-mist bg-white/60 px-4 py-8 text-sm text-faded [border-style:dashed] hover:border-verdigris">
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
                value={expiresIn}
                onChange={(e) => setExpiresIn(e.target.value)}
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
                value={maxViews}
                onChange={(e) => setMaxViews(e.target.value)}
                className="w-full rounded-sm border border-mist bg-white/60 px-2 py-2 text-sm focus:border-verdigris focus:outline-none"
              >
                {VIEW_CHOICES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="block">
            <span className="mb-1 flex items-center gap-2 text-sm">
              Password <span className="text-faded">(optional)</span> <TierChip tier="encrypted" />
            </span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              placeholder="Adds a second key the link alone can't provide"
              className="w-full rounded-sm border border-mist bg-white/60 px-3 py-2 text-sm placeholder:text-faded/60 focus:border-verdigris focus:outline-none"
            />
            <span className="mt-1 block text-xs leading-relaxed text-faded">
              With a password, a leaked link is useless on its own. Share the password over a
              different channel than the link.
            </span>
          </label>
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
