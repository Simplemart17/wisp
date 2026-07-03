"use client";

import { useState } from "react";

const TIER_DOT = {
  encrypted: "bg-verdigris",
  "server-enforced": "bg-faded",
  "client-honored": "bg-wax",
} as const;

/**
 * Honesty chips (SPEC §1): every control is labeled with the tier that
 * actually guarantees it, so the UI never promises more than it delivers.
 */
export function TierChip({ tier }: { tier: keyof typeof TIER_DOT }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-mist bg-card/70 px-2 py-0.5 font-mono text-[10px] text-faded">
      <span className={`h-1.5 w-1.5 rounded-full ${TIER_DOT[tier]}`} />
      {tier}
    </span>
  );
}

export function CopyField({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="font-mono text-xs text-faded">{label}</span>
        {hint ? <span className="text-[11px] font-medium text-wax">{hint}</span> : null}
      </div>
      <div className="group flex items-stretch overflow-hidden rounded-sm border border-mist bg-card focus-within:border-verdigris">
        <code className="min-w-0 flex-1 truncate px-3 py-2.5 font-mono text-xs leading-5 text-ink">
          {value}
        </code>
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="shrink-0 border-l border-mist px-3.5 font-mono text-xs font-medium text-ink transition-colors hover:bg-ink hover:text-paper"
        >
          {copied ? "copied ✓" : "copy"}
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
    info: "border-mist bg-card/60 text-faded",
    warn: "border-wax/25 bg-wax/[0.06] text-wax-deep",
    error: "border-wax/40 bg-wax/[0.09] text-wax-deep",
  }[tone];
  // Errors/warnings are announced to assistive tech; info is polite.
  return (
    <div
      role={tone === "info" ? "status" : "alert"}
      className={`rounded-sm border px-3.5 py-3 text-sm leading-relaxed ${styles}`}
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
