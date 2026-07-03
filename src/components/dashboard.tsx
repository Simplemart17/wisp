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

/**
 * "My shares" (SPEC §5b). Because the signed-in owner is verified per request,
 * manage pages open WITHOUT the management token — the Clerk session is the
 * credential. Anonymous shares never appear here; their management link is
 * their only key.
 */
export function Dashboard() {
  return (
    <section className="space-y-5">
      <h1 className="font-display text-3xl">Your shares.</h1>

      <Show when="signed-out">
        <p className="text-sm leading-relaxed text-faded">
          Sign in to see every share created from your account, with cross-share audit and
          one-click revoke — no management links to keep track of.
        </p>
        <SignInButton mode="modal">
          <button
            type="button"
            className="mt-4 rounded-sm bg-ink px-4 py-2.5 text-sm font-medium text-paper hover:bg-verdigris-deep"
          >
            Sign in
          </button>
        </SignInButton>
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
        <p className="rounded-sm border border-mist bg-pane px-3 py-4 text-sm text-faded">
          Nothing here yet. Shares you create while signed in will appear with full history;
          shares created anonymously stay reachable only through their management links.
        </p>
        <Link href="/" className="inline-block text-sm text-verdigris hover:underline">
          Seal something →
        </Link>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-sm border border-mist bg-card">
      <table className="w-full font-mono text-xs">
        <thead>
          <tr className="border-b border-mist text-left text-[10px] uppercase tracking-widest text-faded">
            <th className="px-3 py-2 font-normal">share</th>
            <th className="px-3 py-2 font-normal">created</th>
            <th className="px-3 py-2 font-normal">status</th>
            <th className="px-3 py-2 font-normal">policy</th>
            <th className="px-3 py-2 font-normal" />
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
                <td className="px-3 py-2">{share.id}</td>
                <td className="whitespace-nowrap px-3 py-2 text-faded">
                  {new Date(share.createdAt).toLocaleDateString()}
                </td>
                <td className="px-3 py-2">
                  {share.expired ? (
                    <span className="text-wax">expired</span>
                  ) : (
                    <span className="text-verdigris">active</span>
                  )}
                </td>
                <td className="px-3 py-2 text-faded">{traits || "link only"}</td>
                <td className="px-3 py-2 text-right">
                  <Link href={`/manage/${share.id}`} className="text-verdigris hover:underline">
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
