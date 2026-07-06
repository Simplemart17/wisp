"use client";

import { useEffect, useRef, useState } from "react";

import {
  type AuditReport,
  ShareApiError,
  type ShareUpdate,
  fetchAudit,
  revokeShare,
  updateShare,
} from "@/lib/client/shares";
import type { ExpiryChoice } from "@/lib/shared/policy";
import { Notice, SectionLabel, formatRelativeTime } from "./bits";

type Phase =
  | { name: "loading" }
  | { name: "missing-token" }
  | { name: "denied" }
  | { name: "gone" }
  | { name: "loaded"; report: AuditReport; confirming: boolean; revoking: boolean }
  | { name: "revoked" }
  | { name: "error"; message: string };

/** "Jul 10, 2:58 PM" — compact enough to hold one line in the ledger. */
const DATETIME = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const TABLE_HEADER = "px-3 py-2 font-normal";

export function ManageShare({ id }: { id: string }) {
  const [phase, setPhase] = useState<Phase>({ name: "loading" });
  // Per-recipient revoke keeps its own two-click confirm and inline error so a
  // single row's failure never replaces the whole ledger.
  const [confirmingLink, setConfirmingLink] = useState<string | null>(null);
  const [recipientError, setRecipientError] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const tokenRef = useRef("");

  useEffect(() => {
    const fragment = window.location.hash.slice(1);
    tokenRef.current = fragment;
    // No fragment? The Clerk session cookie may still authorize the owner.
    fetchAudit(id, fragment || undefined)
      .then((report) => setPhase({ name: "loaded", report, confirming: false, revoking: false }))
      .catch((err) => {
        if (err instanceof ShareApiError && err.status === 403) {
          if (fragment) setPhase({ name: "denied" });
          else setPhase({ name: "missing-token" });
        } else if (err instanceof ShareApiError && err.status === 404) setPhase({ name: "gone" });
        else setPhase({ name: "error", message: err instanceof Error ? err.message : "Failed." });
      });
  }, [id]);

  async function revoke() {
    if (phase.name !== "loaded") return;
    setPhase({ ...phase, revoking: true });
    try {
      await revokeShare(id, tokenRef.current || undefined);
      setPhase({ name: "revoked" });
    } catch (err) {
      setPhase({
        name: "error",
        message: err instanceof Error ? err.message : "Revoking failed.",
      });
    }
  }

  async function refresh() {
    const report = await fetchAudit(id, tokenRef.current || undefined);
    setPhase({ name: "loaded", report, confirming: false, revoking: false });
  }

  async function revokeRecipient(linkId: string) {
    if (phase.name !== "loaded") return;
    setConfirmingLink(null);
    setRecipientError(null);
    try {
      await revokeShare(id, tokenRef.current || undefined, linkId);
      await refresh();
    } catch (err) {
      setRecipientError(err instanceof Error ? err.message : "Revoking the recipient failed.");
    }
  }

  async function applyUpdate(update: ShareUpdate) {
    await updateShare(id, tokenRef.current || undefined, update);
    await refresh();
  }

  /** Append the next (older) page of log entries to the current report. */
  async function loadOlderEntries() {
    if (phase.name !== "loaded" || !phase.report.entriesNextCursor) return;
    setLoadingOlder(true);
    try {
      const page = await fetchAudit(
        id,
        tokenRef.current || undefined,
        phase.report.entriesNextCursor,
      );
      setPhase({
        ...phase,
        report: {
          ...phase.report,
          entries: [...phase.report.entries, ...page.entries],
          entriesNextCursor: page.entriesNextCursor,
        },
      });
    } catch (err) {
      setRecipientError(err instanceof Error ? err.message : "Loading older entries failed.");
    } finally {
      setLoadingOlder(false);
    }
  }

  async function addRecipientViews(linkId: string) {
    setRecipientError(null);
    try {
      await applyUpdate({ addViews: 5, linkId });
    } catch (err) {
      setRecipientError(err instanceof Error ? err.message : "Adding views failed.");
    }
  }

  if (phase.name === "loading") {
    return <p className="my-auto font-mono text-sm text-faded">Opening the ledger…</p>;
  }
  if (phase.name === "missing-token") {
    return (
      <div className="my-auto">
        <Notice tone="warn">
          This link has no management token after the <span className="font-mono">#</span>. Use
          the full management link you were given when the share was created — or, if you created
          it while signed in, sign in and open it from your dashboard.
        </Notice>
      </div>
    );
  }
  if (phase.name === "denied") {
    return (
      <div className="my-auto">
        <Notice tone="error">This management link isn&apos;t valid for this share.</Notice>
      </div>
    );
  }
  if (phase.name === "gone") {
    return (
      <section className="my-auto space-y-3">
        <h1 className="font-display text-3xl">Nothing to manage.</h1>
        <p className="text-sm text-faded">
          This share no longer exists — already revoked, or swept after expiring.
        </p>
      </section>
    );
  }
  if (phase.name === "revoked") {
    return (
      <section className="unfog my-auto space-y-3">
        <h1 className="font-display text-4xl tracking-[-0.03em]">Revoked.</h1>
        <p className="text-sm leading-relaxed text-faded">
          The ciphertext has been deleted. The share link is now permanently useless — even for
          someone holding the key and password.
        </p>
      </section>
    );
  }
  if (phase.name === "error") {
    return (
      <div className="my-auto">
        <Notice tone="error">{phase.message}</Notice>
      </div>
    );
  }

  const { report, confirming, revoking } = phase;
  const s = report.share;
  const status = s.expired ? "expired" : s.exhausted ? "exhausted" : "active";

  return (
    <section className="space-y-7">
      <div>
        <h1 className="font-display text-2xl tracking-[-0.015em]">Your share</h1>
        <p className="mt-1 font-mono text-xs text-faded">{s.id}</p>
      </div>

      {/* Instrument strip: one baseline, values in mono. */}
      <dl className="elevate flex flex-wrap justify-between gap-x-8 gap-y-3 rounded-sm border border-mist bg-card px-4 py-3.5">
        <div>
          <SectionLabel as="dt">status</SectionLabel>
          <dd
            className={`font-mono text-sm ${status === "active" ? "text-verdigris-deep" : "text-faded"}`}
          >
            {status}
          </dd>
        </div>
        <div>
          <SectionLabel as="dt">expires</SectionLabel>
          <dd
            className="font-mono text-sm whitespace-nowrap tabular-nums"
            title={s.expiresAt ? new Date(s.expiresAt).toLocaleString() : undefined}
          >
            {s.expiresAt ? formatRelativeTime(new Date(s.expiresAt)) : "never"}
          </dd>
        </div>
        <div>
          <SectionLabel as="dt">views left</SectionLabel>
          {/* Identity shares track views per recipient (see the table), so the
              share-level count would be misleading. */}
          <dd className="font-mono text-sm whitespace-nowrap tabular-nums">
            {s.requiresIdentity
              ? "per recipient"
              : s.remainingViews === null
                ? "unlimited"
                : s.remainingViews}
          </dd>
        </div>
        <div>
          <SectionLabel as="dt">password</SectionLabel>
          <dd className="font-mono text-sm">{s.requiresPassword ? "required" : "none"}</dd>
        </div>
      </dl>

      <AdjustPanel
        canAddViews={!s.requiresIdentity && s.remainingViews !== null}
        onApply={applyUpdate}
      />

      {s.requiresIdentity && report.recipients.length > 0 ? (
        <div>
          <SectionLabel as="h2" className="mb-2 block">
            Recipients
          </SectionLabel>
          <div className="overflow-x-auto rounded-sm border border-mist bg-card">
            <table className="w-full font-mono text-xs">
              <thead>
                <tr className="border-b border-mist text-left text-[11px] tracking-[0.12em] text-hush uppercase">
                  <th className={TABLE_HEADER}>recipient</th>
                  <th className={TABLE_HEADER}>views left</th>
                  <th className={TABLE_HEADER}>verified</th>
                  {s.requiresSignature ? <th className={TABLE_HEADER}>signed</th> : null}
                  <th className={TABLE_HEADER} />
                </tr>
              </thead>
              <tbody>
                {report.recipients.map((r) => (
                  <tr key={r.linkId} className="border-b border-mist/60 last:border-0">
                    <td className="px-3 py-2.5">{r.emailHint ?? r.linkId}</td>
                    <td className="px-3 py-2.5 tabular-nums">
                      {r.revoked ? (
                        <span className="text-wax-deep">revoked</span>
                      ) : r.viewsRemaining === null ? (
                        "unlimited"
                      ) : (
                        r.viewsRemaining
                      )}
                    </td>
                    <td
                      className="px-3 py-2.5 whitespace-nowrap text-faded"
                      title={r.verifiedAt ? new Date(r.verifiedAt).toLocaleString() : undefined}
                    >
                      {r.verifiedAt ? DATETIME.format(new Date(r.verifiedAt)) : "—"}
                    </td>
                    {s.requiresSignature ? (
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {r.signedAt ? (
                          <span className="text-verdigris-deep">
                            ✓ {DATETIME.format(new Date(r.signedAt))}
                          </span>
                        ) : (
                          <span className="text-faded">pending</span>
                        )}
                      </td>
                    ) : null}
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      {!r.revoked ? (
                        confirmingLink === r.linkId ? (
                          <>
                            <button
                              type="button"
                              onClick={() => void revokeRecipient(r.linkId)}
                              className="-my-2 inline-block px-2 py-2 font-medium text-white bg-wax rounded-xs hover:bg-wax-deep"
                            >
                              confirm
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmingLink(null)}
                              className="-my-2 inline-block px-2 py-2 text-faded hover:text-ink"
                            >
                              keep
                            </button>
                          </>
                        ) : (
                          <>
                            {r.viewsRemaining !== null ? (
                              <button
                                type="button"
                                onClick={() => void addRecipientViews(r.linkId)}
                                className="-my-2 inline-block px-2 py-2 text-verdigris-deep hover:underline"
                              >
                                +5 views
                              </button>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => setConfirmingLink(r.linkId)}
                              className="-my-2 inline-block px-2 py-2 text-wax-deep hover:underline"
                            >
                              revoke link…
                            </button>
                          </>
                        )
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {recipientError ? (
            <div className="mt-2">
              <Notice tone="error">{recipientError}</Notice>
            </div>
          ) : null}
        </div>
      ) : null}

      <div>
        <SectionLabel as="h2" className="mb-2 block">
          Access log
        </SectionLabel>
        {report.entries.length === 0 ? (
          <p className="well rounded-sm border border-mist px-3 py-4 text-sm text-faded">
            No one has opened this share yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-sm border border-mist bg-card">
            <table className="w-full font-mono text-xs">
              <thead>
                <tr className="border-b border-mist text-left text-[11px] tracking-[0.12em] text-hush uppercase">
                  <th className={TABLE_HEADER}>when</th>
                  <th className={TABLE_HEADER}>event</th>
                  <th className={TABLE_HEADER}>visitor (hashed)</th>
                </tr>
              </thead>
              <tbody>
                {report.entries.map((entry, i) => (
                  <tr key={i} className="border-b border-mist/60 last:border-0">
                    <td
                      className="px-3 py-2.5 whitespace-nowrap tabular-nums"
                      title={new Date(entry.ts).toLocaleString()}
                    >
                      {DATETIME.format(new Date(entry.ts))}
                    </td>
                    <td className="px-3 py-2.5">
                      {/* Denials are the signal; routine allows stay quiet. */}
                      {entry.action}
                      {entry.result !== "allowed" ? (
                        <span className="text-wax-deep"> · {entry.result}</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5 text-faded" title={entry.userAgent ?? undefined}>
                      {entry.emailHint ?? entry.ipHash ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {report.entriesNextCursor ? (
          <button
            type="button"
            disabled={loadingOlder}
            onClick={() => void loadOlderEntries()}
            className="mt-2 rounded-sm border border-mist px-3 py-1.5 font-mono text-xs text-faded transition-colors hover:border-ink hover:text-ink disabled:opacity-50"
          >
            {loadingOlder ? "Loading…" : "Load older entries"}
          </button>
        ) : null}
        <p className="mt-2 text-xs text-faded">
          Salted hashes — raw IP addresses are never stored.
        </p>
      </div>

      <div className="rounded-sm border border-wax/30 bg-card/60 p-4">
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
              className="rounded-sm bg-wax px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-wax-deep disabled:opacity-60"
            >
              {revoking ? "Revoking…" : "Yes, revoke forever"}
            </button>
            <button
              type="button"
              disabled={revoking}
              onClick={() => setPhase({ ...phase, confirming: false })}
              className="rounded-sm border border-mist px-4 py-2 text-sm transition-colors hover:border-ink"
            >
              Keep it
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setPhase({ ...phase, confirming: true })}
            className="rounded-sm border border-wax/40 px-4 py-2 text-sm text-wax-deep transition-colors hover:bg-wax hover:text-white"
          >
            Revoke…
          </button>
        )}
      </div>
    </section>
  );
}

const EXPIRY_LABELS: Array<{ value: ExpiryChoice; label: string }> = [
  { value: "1h", label: "1 hour" },
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
];

/**
 * Post-create adjustments: the two "policy was too tight" fixes that shouldn't
 * force re-encrypting and re-sending. Identity shares top up views per
 * recipient (in the table above), so the share-level control hides there.
 */
function AdjustPanel({
  canAddViews,
  onApply,
}: {
  canAddViews: boolean;
  onApply: (update: ShareUpdate) => Promise<void>;
}) {
  const [expiry, setExpiry] = useState<ExpiryChoice>("7d");
  const [views, setViews] = useState(5);
  const [working, setWorking] = useState<"expiry" | "views" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(kind: "expiry" | "views", update: ShareUpdate) {
    setWorking(kind);
    setError(null);
    try {
      await onApply(update);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Updating the share failed.");
    } finally {
      setWorking(null);
    }
  }

  const CONTROL = "rounded-sm border border-mist bg-card px-3 py-2 text-sm";
  const APPLY =
    "rounded-sm border border-mist px-3 py-2 text-sm transition-colors hover:border-ink disabled:opacity-50";

  return (
    <div className="rounded-sm border border-mist bg-card/60 p-4">
      <SectionLabel as="h2" className="mb-3 block">
        Adjust
      </SectionLabel>
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <label className="block">
          <span className="mb-1 block text-xs text-faded">Extend expiry (from now)</span>
          <div className="flex gap-2">
            <select
              value={expiry}
              onChange={(e) => setExpiry(e.target.value as ExpiryChoice)}
              className={CONTROL}
            >
              {EXPIRY_LABELS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={working !== null}
              onClick={() => void run("expiry", { extendExpiry: expiry })}
              className={APPLY}
            >
              {working === "expiry" ? "Extending…" : "Extend"}
            </button>
          </div>
        </label>

        {canAddViews ? (
          <label className="block">
            <span className="mb-1 block text-xs text-faded">Add views</span>
            <div className="flex gap-2">
              <input
                type="number"
                min={1}
                max={100}
                value={views}
                onChange={(e) => setViews(Number.parseInt(e.target.value, 10) || 1)}
                className={`w-20 text-center tabular-nums ${CONTROL}`}
              />
              <button
                type="button"
                disabled={working !== null}
                onClick={() => void run("views", { addViews: views })}
                className={APPLY}
              >
                {working === "views" ? "Adding…" : "Add"}
              </button>
            </div>
          </label>
        ) : null}
      </div>
      {error ? (
        <div className="mt-3">
          <Notice tone="error">{error}</Notice>
        </div>
      ) : null}
      <p className="mt-3 text-xs leading-relaxed text-faded">
        Changes apply to every link on this share. Once expired or fully viewed, the encrypted
        content is deleted within minutes and can&apos;t be revived — adjust before it lapses.
      </p>
    </div>
  );
}
