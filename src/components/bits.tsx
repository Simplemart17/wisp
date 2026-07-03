"use client";

import { useState } from "react";

/**
 * Honesty chips (SPEC §1): every control is labeled with the tier that
 * actually guarantees it, so the UI never promises more than it delivers.
 */
export function TierChip({ tier }: { tier: "encrypted" | "server-enforced" | "client-honored" }) {
  const styles = {
    encrypted: "border-verdigris/40 text-verdigris",
    "server-enforced": "border-mist text-faded",
    "client-honored": "border-wax/30 text-wax",
  }[tier];
  return (
    <span
      className={`rounded-sm border px-1.5 py-px font-mono text-[10px] uppercase tracking-wider ${styles}`}
    >
      {tier}
    </span>
  );
}

export function CopyField({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="font-mono text-[11px] uppercase tracking-widest text-faded">{label}</span>
        {hint ? <span className="text-[11px] text-wax">{hint}</span> : null}
      </div>
      <div className="flex items-stretch gap-2">
        <code className="min-w-0 flex-1 truncate rounded-sm border border-mist bg-pane px-2.5 py-2 font-mono text-xs leading-5">
          {value}
        </code>
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="shrink-0 rounded-sm border border-mist px-3 font-mono text-xs text-ink hover:border-verdigris hover:text-verdigris"
        >
          {copied ? "copied" : "copy"}
        </button>
      </div>
    </div>
  );
}

export function Notice({
  tone,
  children,
}: {
  tone: "info" | "warn" | "error";
  children: React.ReactNode;
}) {
  const styles = {
    info: "border-mist bg-pane text-faded",
    warn: "border-wax/30 bg-wax/5 text-wax-deep",
    error: "border-wax/50 bg-wax/10 text-wax-deep",
  }[tone];
  // Errors/warnings are announced to assistive tech; info is polite.
  return (
    <div
      role={tone === "info" ? "status" : "alert"}
      className={`rounded-sm border px-3 py-2.5 text-sm leading-relaxed ${styles}`}
    >
      {children}
    </div>
  );
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
