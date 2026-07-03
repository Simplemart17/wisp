"use client";

import { useEffect, useRef, useState } from "react";

import { type AuditReport, ShareApiError, fetchAudit, revokeShare } from "@/lib/client/shares";
import { Notice } from "./bits";

type Phase =
  | { name: "loading" }
  | { name: "missing-token" }
  | { name: "denied" }
  | { name: "gone" }
  | { name: "loaded"; report: AuditReport; confirming: boolean; revoking: boolean }
  | { name: "revoked" }
  | { name: "error"; message: string };

export function ManageShare({ id }: { id: string }) {
  const [phase, setPhase] = useState<Phase>({ name: "loading" });
  const tokenRef = useRef("");

  useEffect(() => {
    const fragment = window.location.hash.slice(1);
    tokenRef.current = fragment;
    (fragment ? fetchAudit(id, fragment) : Promise.resolve(null))
      .then((report) => {
        if (report === null) setPhase({ name: "missing-token" });
        else setPhase({ name: "loaded", report, confirming: false, revoking: false });
      })
      .catch((err) => {
        if (err instanceof ShareApiError && err.status === 403) setPhase({ name: "denied" });
        else if (err instanceof ShareApiError && err.status === 404) setPhase({ name: "gone" });
        else setPhase({ name: "error", message: err instanceof Error ? err.message : "Failed." });
      });
  }, [id]);

  async function revoke() {
    if (phase.name !== "loaded") return;
    setPhase({ ...phase, revoking: true });
    try {
      await revokeShare(id, tokenRef.current);
      setPhase({ name: "revoked" });
    } catch (err) {
      setPhase({
        name: "error",
        message: err instanceof Error ? err.message : "Revoking failed.",
      });
    }
  }

  if (phase.name === "loading") {
    return <p className="font-mono text-sm text-faded">Opening the ledger…</p>;
  }
  if (phase.name === "missing-token") {
    return (
      <Notice tone="warn">
        This link has no management token after the <span className="font-mono">#</span>. Use the
        full management link you were given when the share was created.
      </Notice>
    );
  }
  if (phase.name === "denied") {
    return <Notice tone="error">This management link isn&apos;t valid for this share.</Notice>;
  }
  if (phase.name === "gone") {
    return (
      <section className="space-y-3">
        <h1 className="font-display text-3xl">Nothing to manage.</h1>
        <p className="text-sm text-faded">
          This share no longer exists — already revoked, or swept after expiring.
        </p>
      </section>
    );
  }
  if (phase.name === "revoked") {
    return (
      <section className="unfog space-y-3">
        <h1 className="font-display text-3xl">Revoked.</h1>
        <p className="text-sm leading-relaxed text-faded">
          The ciphertext has been deleted. The share link is now permanently useless — even for
          someone holding the key and password.
        </p>
      </section>
    );
  }
  if (phase.name === "error") {
    return <Notice tone="error">{phase.message}</Notice>;
  }

  const { report, confirming, revoking } = phase;
  const s = report.share;
  const status = s.expired ? "expired" : s.exhausted ? "exhausted" : "active";

  return (
    <section className="space-y-6">
      <div>
        <h1 className="font-display text-3xl">Your share</h1>
        <p className="mt-1 font-mono text-xs text-faded">{s.id}</p>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-sm border border-mist bg-white/60 p-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-widest text-faded">status</dt>
          <dd className={status === "active" ? "text-verdigris" : "text-wax"}>{status}</dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-widest text-faded">expires</dt>
          <dd>{s.expiresAt ? new Date(s.expiresAt).toLocaleString() : "never"}</dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-widest text-faded">views left</dt>
          <dd>{s.remainingViews === null ? "unlimited" : s.remainingViews}</dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-widest text-faded">password</dt>
          <dd>{s.requiresPassword ? "required" : "none"}</dd>
        </div>
      </dl>

      <div>
        <h2 className="mb-2 font-mono text-[11px] uppercase tracking-widest text-faded">
          Access log
        </h2>
        {report.entries.length === 0 ? (
          <p className="rounded-sm border border-mist bg-pane px-3 py-4 text-sm text-faded">
            No one has opened this share yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-sm border border-mist bg-white/60">
            <table className="w-full font-mono text-xs">
              <thead>
                <tr className="border-b border-mist text-left text-[10px] uppercase tracking-widest text-faded">
                  <th className="px-3 py-2 font-normal">when</th>
                  <th className="px-3 py-2 font-normal">event</th>
                  <th className="px-3 py-2 font-normal">visitor</th>
                </tr>
              </thead>
              <tbody>
                {report.entries.map((entry, i) => (
                  <tr key={i} className="border-b border-mist/60 last:border-0">
                    <td className="whitespace-nowrap px-3 py-2">{new Date(entry.ts).toLocaleString()}</td>
                    <td className="px-3 py-2">
                      <span className={entry.result === "allowed" ? "text-verdigris" : "text-wax"}>
                        {entry.action} · {entry.result}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-faded" title={entry.user_agent ?? undefined}>
                      {entry.ip_hash ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-faded">
          Visitors are logged as salted hashes — Wisp never stores raw IP addresses.
        </p>
      </div>

      <div className="rounded-sm border border-wax/30 p-4">
        <h2 className="text-sm font-medium text-wax-deep">Revoke this share</h2>
        <p className="mt-1 mb-3 text-xs leading-relaxed text-faded">
          Permanently deletes the encrypted content and this audit trail. Anyone holding the link
          — even with the password — gets nothing from then on. Already-opened copies can&apos;t
          be recalled.
        </p>
        {confirming ? (
          <div className="flex gap-2">
            <button
              type="button"
              disabled={revoking}
              onClick={() => void revoke()}
              className="rounded-sm bg-wax px-4 py-2 text-sm font-medium text-white hover:bg-wax-deep disabled:opacity-60"
            >
              {revoking ? "Revoking…" : "Yes, revoke forever"}
            </button>
            <button
              type="button"
              disabled={revoking}
              onClick={() => setPhase({ ...phase, confirming: false })}
              className="rounded-sm border border-mist px-4 py-2 text-sm hover:text-ink"
            >
              Keep it
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setPhase({ ...phase, confirming: true })}
            className="rounded-sm border border-wax/40 px-4 py-2 text-sm text-wax hover:bg-wax hover:text-white"
          >
            Revoke…
          </button>
        )}
      </div>
    </section>
  );
}
