"use client";

import { Show, SignInButton } from "@clerk/nextjs";
import Link from "next/link";
import { useEffect, useState } from "react";

import type { MyShareDto, MySharesResponseDto } from "@/lib/shared/api";
import { Notice, useAtLeastSm } from "./bits";

type ShareSummary = MyShareDto;

type Phase =
  | { name: "loading" }
  | { name: "loaded"; shares: ShareSummary[]; nextCursor: string | null; loadingMore: boolean }
  | { name: "error"; message: string };

async function fetchPage(before?: string): Promise<MySharesResponseDto> {
  const qs = before ? `?before=${encodeURIComponent(before)}` : "";
  const res = await fetch(`/api/my/shares${qs}`);
  if (!res.ok) throw new Error(`Loading your shares failed (${res.status})`);
  return (await res.json()) as MySharesResponseDto;
}

// Time included, not just the date: cards render only on touch screens where
// the title tooltip (the desktop path to the exact moment) can never open.
const DATETIME = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** "password · view-only · 3 views" — the policy, told in traits. */
function shareTraits(share: ShareSummary): string {
  return (
    [
      share.policy.password ? "password" : null,
      share.policy.requireIdentity ? "identity" : null,
      share.policy.viewOnly ? "view-only" : null,
      share.policy.watermark ? "watermark" : null,
      share.policy.maxViews !== null ? `${share.policy.maxViews} views` : null,
    ]
      .filter(Boolean)
      .join(" · ") || "link only"
  );
}

/** One derivation per share per render — both layouts consume these rows. */
function toRow(share: ShareSummary) {
  const created = new Date(share.createdAt);
  return {
    share,
    traits: shareTraits(share),
    createdLabel: DATETIME.format(created),
    createdTitle: created.toLocaleString(),
  };
}

function StatusBadge({ expired }: { expired: boolean }) {
  return expired ? (
    <span className="text-faded">expired</span>
  ) : (
    <span className="text-verdigris-deep">active</span>
  );
}

/**
 * "My shares" (SPEC §5b). Because the signed-in owner is verified per request,
 * manage pages open WITHOUT the management token — the Clerk session is the
 * credential. Anonymous shares never appear here; their management link is
 * their only key.
 */
export function Dashboard() {
  return (
    <section className="flex flex-1 flex-col space-y-5">
      <h1 className="font-display text-2xl tracking-[-0.015em]">Your shares</h1>

      <Show when="signed-out">
        <div className="my-auto max-w-md space-y-4 pb-16">
          <p className="text-sm leading-relaxed text-faded">
            Sign in to see every share created from your account, with cross-share audit and
            one-click revoke — no management links to keep track of.
          </p>
          <SignInButton mode="modal">
            <button
              type="button"
              className="rounded-sm bg-ink px-4 py-2.5 text-sm font-medium text-paper transition-[background-color,transform] duration-150 hover:bg-verdigris-deep active:translate-y-px"
            >
              Sign in
            </button>
          </SignInButton>
        </div>
      </Show>

      <Show when="signed-in">
        <ShareList />
      </Show>
    </section>
  );
}

function ShareList() {
  const [phase, setPhase] = useState<Phase>({ name: "loading" });
  // Card ledger below sm:, table above — only one tree mounted (safe: shares
  // render only after the client fetch, never in server HTML).
  const desktop = useAtLeastSm();
  // Pagination failures stay local — a 429 on page 2 must never blank the
  // ledger the user is already reading.
  const [pageError, setPageError] = useState<string | null>(null);

  useEffect(() => {
    fetchPage()
      .then((body) =>
        setPhase({
          name: "loaded",
          shares: body.shares,
          nextCursor: body.nextCursor,
          loadingMore: false,
        }),
      )
      .catch((err) =>
        setPhase({ name: "error", message: err instanceof Error ? err.message : "Failed." }),
      );
  }, []);

  async function loadMore() {
    if (phase.name !== "loaded" || !phase.nextCursor || phase.loadingMore) return;
    setPageError(null);
    setPhase({ ...phase, loadingMore: true });
    try {
      const body = await fetchPage(phase.nextCursor);
      setPhase((current) =>
        current.name === "loaded"
          ? {
              name: "loaded",
              shares: [...current.shares, ...body.shares],
              nextCursor: body.nextCursor,
              loadingMore: false,
            }
          : current,
      );
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "Loading older shares failed.");
      setPhase((current) =>
        current.name === "loaded" ? { ...current, loadingMore: false } : current,
      );
    }
  }

  if (phase.name === "loading") {
    return <p className="font-mono text-sm text-faded">Opening the ledger…</p>;
  }
  if (phase.name === "error") {
    return <Notice tone="error">{phase.message}</Notice>;
  }
  if (phase.shares.length === 0) {
    return (
      <div className="space-y-3">
        <p className="well rounded-sm border border-mist px-3 py-4 text-sm text-faded">
          Nothing here yet. Shares you create while signed in will appear with full history;
          shares created anonymously stay reachable only through their management links.
        </p>
        <Link
          href="/"
          className="inline-flex min-h-8 items-center text-sm font-medium text-ink underline decoration-mist underline-offset-4 hover:decoration-ink"
        >
          Seal something →
        </Link>
      </div>
    );
  }

  const rows = phase.shares.map(toRow);

  return (
    <div className="space-y-2">
    {/* One layout mounts at a time: a stacked ledger on phones (sideways-
        scrolling a table one-handed is miserable), the table from sm: up.
        The list is unbounded ("Load older shares"), so never mount both. */}
    {!desktop ? (
    <ul className="space-y-2">
      {rows.map(({ share, traits, createdLabel }) => (
        <li
          key={share.id}
          className="rounded-sm border border-mist bg-card px-3.5 py-3 font-mono text-xs"
        >
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate">{share.id}</span>
            <span className="shrink-0">
              <StatusBadge expired={share.expired} />
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-faded">
            {/* Wraps rather than truncates — a policy trait the owner can't
                see is a policy they can't trust. */}
            <span className="min-w-0">{traits}</span>
            <span className="shrink-0 tabular-nums">{createdLabel}</span>
          </div>
          <Link
            href={`/manage/${share.id}`}
            className="mt-2 inline-flex min-h-8 items-center text-ink underline decoration-mist underline-offset-2 hover:decoration-ink"
          >
            manage
          </Link>
        </li>
      ))}
    </ul>
    ) : (
    <div className="overflow-x-auto rounded-sm border border-mist bg-card">
      <table className="w-full font-mono text-xs">
        <thead>
          <tr className="border-b border-mist text-left text-[11px] tracking-[0.12em] text-hush uppercase">
            <th className="px-3 py-2 font-normal">share</th>
            <th className="px-3 py-2 font-normal">created</th>
            <th className="px-3 py-2 font-normal">status</th>
            <th className="px-3 py-2 font-normal">policy</th>
            <th className="px-3 py-2 font-normal">
              <span className="sr-only">actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ share, traits, createdLabel, createdTitle }) => (
            <tr key={share.id} className="border-b border-mist/60 last:border-0">
              <td className="px-3 py-2.5">{share.id}</td>
              <td
                className="px-3 py-2.5 whitespace-nowrap text-faded tabular-nums"
                title={createdTitle}
              >
                {createdLabel}
              </td>
              <td className="px-3 py-2.5">
                <StatusBadge expired={share.expired} />
              </td>
              <td className="px-3 py-2.5 text-faded">{traits}</td>
              <td className="px-3 py-2.5 text-right">
                <Link
                  href={`/manage/${share.id}`}
                  className="-my-2 inline-block px-2 py-2 text-ink underline decoration-mist underline-offset-2 hover:decoration-ink"
                >
                  manage
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    )}
    {phase.nextCursor ? (
      <button
        type="button"
        disabled={phase.loadingMore}
        onClick={() => void loadMore()}
        className="rounded-sm border border-mist px-3 py-1.5 font-mono text-xs text-faded transition-colors hover:border-ink hover:text-ink disabled:opacity-50"
      >
        {phase.loadingMore ? "Loading…" : "Load older shares"}
      </button>
    ) : null}
    {pageError ? <Notice tone="error">{pageError}</Notice> : null}
    </div>
  );
}
