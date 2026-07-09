"use client";

import { useState, useSyncExternalStore } from "react";

// Web Share support never changes within a session — an empty subscription
// keeps useSyncExternalStore happy while the snapshots do the detecting.
const noopSubscribe = () => () => {};
const hasWebShare = () => typeof navigator.share === "function";
const serverHasWebShare = () => false;

/**
 * Form-control recipe — every input/select/textarea composes this. text-base
 * (16px) is the floor on touch devices: mobile Safari auto-zooms the page
 * when a focused control is under 16px, and the zoom sticks after blur.
 * pointer-fine (mouse/trackpad) restores the compact size; keying on pointer
 * rather than viewport width covers iPads and landscape phones, which are
 * ≥sm wide but still zoom.
 */
export const CONTROL = "rounded-sm border border-mist bg-card text-base pointer-fine:text-sm";
/** CONTROL's small-print variant for dense mono fields. */
export const CONTROL_XS = "rounded-sm border border-mist bg-card text-base pointer-fine:text-xs";

// The sm breakpoint as a live media query, read from the theme token so a
// re-themed --breakpoint-sm moves this together with every sm: utility.
let smQuery: MediaQueryList | null = null;
function getSmQuery(): MediaQueryList {
  if (!smQuery) {
    const bp =
      getComputedStyle(document.documentElement).getPropertyValue("--breakpoint-sm").trim() ||
      "40rem";
    smQuery = window.matchMedia(`(min-width: ${bp})`);
  }
  return smQuery;
}
const subscribeSm = (onChange: () => void) => {
  const q = getSmQuery();
  q.addEventListener("change", onChange);
  return () => q.removeEventListener("change", onChange);
};
const atLeastSm = () => getSmQuery().matches;
const serverAtLeastSm = () => false;

/**
 * True at or above the sm breakpoint (false during SSR/hydration). For
 * choosing which of two layouts to MOUNT — unlike CSS hiding, only one tree
 * ever exists in the DOM. Safe wherever the branched content appears only
 * after a client-side fetch (both ledgers do), so the server-false snapshot
 * never contradicts server-rendered HTML.
 */
export function useAtLeastSm(): boolean {
  return useSyncExternalStore(subscribeSm, atLeastSm, serverAtLeastSm);
}

/**
 * Honesty tiers (SPEC §1) encode guarantee strength by dot fill, not alarm
 * color: solid emerald = math guarantees it, solid ink = our server refuses,
 * hollow ring = the viewer app cooperates (a determined recipient can bypass).
 */
const TIER_DOT = {
  encrypted: "bg-verdigris",
  "server-enforced": "bg-ink/70",
  "client-honored": "border border-ink/50 bg-transparent",
} as const;

export function TierChip({ tier }: { tier: keyof typeof TIER_DOT }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[11px] tracking-tight text-hush">
      <span className={`h-1.5 w-1.5 rounded-full ${TIER_DOT[tier]}`} />
      {tier}
    </span>
  );
}

/** One-line definition of the three tiers — shown once, where policy is set. */
export function TierLegend() {
  return (
    <p className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] leading-relaxed tracking-tight text-faded">
      <span className="inline-flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-verdigris" />
        encrypted — math guarantees it
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-ink/70" />
        server-enforced — our server refuses
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full border border-ink/50" />
        client-honored — the viewer cooperates
      </span>
    </p>
  );
}

/** The one label voice for section starts and field names — a register mark. */
export function SectionLabel({
  as: Tag = "span",
  className = "",
  children,
}: {
  as?: "span" | "h2" | "legend" | "dt";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Tag className={`font-mono text-[11px] uppercase tracking-[0.12em] text-hush ${className}`}>
      {children}
    </Tag>
  );
}

export function CopyField({
  label,
  value,
  hint,
  primary = false,
  share = false,
}: {
  label: string;
  value: string;
  hint?: string;
  /** The sealed artifact itself — larger, emerald-edged, the page's hero. */
  primary?: boolean;
  /** Offer the OS share sheet next to copy — for links meant to travel.
      Leave off for secrets like the management link. */
  share?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  // Capability-gated with an SSR-safe snapshot: the server (and hydration)
  // render copy-only, then supporting browsers grow the share button.
  const canShare =
    useSyncExternalStore(noopSubscribe, hasWebShare, serverHasWebShare) && share;
  return (
    <div>
      {/* Labels can be emails — mono register without forced uppercase. */}
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="font-mono text-[11px] tracking-[0.08em] text-hush">{label}</span>
        {hint ? (
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink/70">
            {hint}
          </span>
        ) : null}
      </div>
      <div
        className={`group flex items-stretch overflow-hidden rounded-sm border transition-colors focus-within:border-verdigris ${
          primary ? "border-verdigris/40 bg-verdigris/4" : "border-mist bg-card"
        } ${copied ? "border-verdigris/60" : ""}`}
      >
        <code
          className={`min-w-0 flex-1 truncate px-3 font-mono leading-5 text-ink ${
            primary ? "py-3 text-[13px]" : "py-2.5 text-xs"
          }`}
        >
          {value}
        </code>
        {canShare ? (
          <button
            type="button"
            aria-label={`share ${label}`}
            onClick={async () => {
              try {
                await navigator.share({ url: value });
              } catch {
                // Dismissing the OS share sheet rejects with AbortError —
                // that's a choice, not a failure.
              }
            }}
            className={`shrink-0 border-l px-3.5 font-mono text-xs font-medium text-ink transition-colors duration-200 hover:bg-ink hover:text-paper ${
              primary ? "border-verdigris/40" : "border-mist"
            }`}
          >
            share
          </button>
        ) : null}
        <button
          type="button"
          aria-label={`copy ${label}`}
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className={`shrink-0 border-l px-3.5 font-mono text-xs font-medium transition-colors duration-200 ${
            copied
              ? "border-verdigris-deep bg-verdigris-deep text-white"
              : `text-ink hover:bg-ink hover:text-paper ${primary ? "border-verdigris/40" : "border-mist"}`
          }`}
        >
          <span aria-hidden>{copied ? "copied ✓" : "copy"}</span>
          <span role="status" className="sr-only">
            {copied ? `${label} copied` : ""}
          </span>
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
    // Advisory, not alarm — wax is reserved for destruction and failure.
    warn: "border-ink/15 border-l-2 border-l-ink/60 bg-pane/70 text-ink/80",
    error: "border-wax/40 bg-wax/[0.09] text-wax-deep",
  }[tone];
  // Only errors interrupt assistive tech; warnings and info are polite.
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
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

/** "in 7 days" / "3 hours ago" — the human answer to a timestamp question. */
export function formatRelativeTime(date: Date, now: Date = new Date()): string {
  const diffMs = date.getTime() - now.getTime();
  const abs = Math.abs(diffMs);
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  let value: number;
  let unit: string;
  if (abs < HOUR) {
    value = Math.max(1, Math.round(abs / MIN));
    unit = "minute";
  } else if (abs < DAY) {
    value = Math.round(abs / HOUR);
    unit = "hour";
  } else {
    value = Math.round(abs / DAY);
    unit = "day";
  }
  const phrase = `${value} ${unit}${value === 1 ? "" : "s"}`;
  return diffMs >= 0 ? `in ${phrase}` : `${phrase} ago`;
}
