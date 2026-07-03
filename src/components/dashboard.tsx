"use client";

import { Show, SignInButton } from "@clerk/nextjs";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Notice } from "./bits";

interface ShareSummary {
  id: string;
  createdAt: string;
  expiresAt: string | null;
  expired: boolean;
  policy: {
    maxViews: number | null;
    password: boolean;
    requireIdentity: boolean;
    viewOnly: boolean;
    watermark: boolean;
  };
}

type Phase =
  | { name: "loading" }
  | { name: "loaded"; shares: ShareSummary[] }
  | { name: "error"; message: string };

const DATE = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

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

  useEffect(() => {
    fetch("/api/my/shares")
      .then(async (res) => {
        if (!res.ok) throw new Error(`Loading your shares failed (${res.status})`);
        const body = (await res.json()) as { shares: ShareSummary[] };
        setPhase({ name: "loaded", shares: body.shares });
      })
      .catch((err) =>
        setPhase({ name: "error", message: err instanceof Error ? err.message : "Failed." }),
      );
  }, []);

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

  return (
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
          {phase.shares.map((share) => {
            const traits = [
              share.policy.password ? "password" : null,
              share.policy.requireIdentity ? "identity" : null,
              share.policy.viewOnly ? "view-only" : null,
              share.policy.watermark ? "watermark" : null,
              share.policy.maxViews !== null ? `${share.policy.maxViews} views` : null,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <tr key={share.id} className="border-b border-mist/60 last:border-0">
                <td className="px-3 py-2.5">{share.id}</td>
                <td
                  className="px-3 py-2.5 whitespace-nowrap text-faded tabular-nums"
                  title={new Date(share.createdAt).toLocaleString()}
                >
                  {DATE.format(new Date(share.createdAt))}
                </td>
                <td className="px-3 py-2.5">
                  {share.expired ? (
                    <span className="text-faded">expired</span>
                  ) : (
                    <span className="text-verdigris-deep">active</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-faded">{traits || "link only"}</td>
                <td className="px-3 py-2.5 text-right">
                  <Link
                    href={`/manage/${share.id}`}
                    className="-my-2 inline-block px-2 py-2 text-ink underline decoration-mist underline-offset-2 hover:decoration-ink"
                  >
                    manage
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
