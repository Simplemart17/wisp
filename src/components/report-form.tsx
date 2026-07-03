"use client";

import { useState } from "react";

import { Notice } from "./bits";

const REASONS = [
  { value: "illegal", label: "Illegal content" },
  { value: "malware", label: "Malware" },
  { value: "phishing", label: "Phishing or scam" },
  { value: "other", label: "Something else" },
];

export function ReportForm({ shareId }: { shareId: string }) {
  const [reason, setReason] = useState("illegal");
  const [details, setDetails] = useState("");
  const [state, setState] = useState<"form" | "sending" | "done" | "error">("form");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setState("sending");
    const res = await fetch("/api/report", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ shareId: shareId || undefined, reason, details }),
    });
    setState(res.ok ? "done" : "error");
  }

  if (state === "done") {
    return (
      <section className="space-y-3">
        <h1 className="font-display text-3xl">Report received.</h1>
        <p className="text-sm leading-relaxed text-faded">
          Thank you. Because content is end-to-end encrypted, we can&apos;t inspect it — but
          reported shares are reviewed and can be taken down.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-5">
      <div>
        <h1 className="font-display text-3xl">Report abuse.</h1>
        <p className="mt-2 text-sm leading-relaxed text-faded">
          Wisp can&apos;t see inside shares, so reports like yours are how abusive content gets
          taken down.{shareId ? " This report references the share you were viewing." : ""}
        </p>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-sm">What&apos;s wrong?</span>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full rounded-sm border border-mist bg-card px-2 py-2 text-sm focus:border-verdigris focus:outline-none"
          >
            {REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm">
            Details <span className="text-faded">(optional)</span>
          </span>
          <textarea
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            rows={4}
            maxLength={2000}
            className="w-full rounded-sm border border-mist bg-card p-3 text-sm focus:border-verdigris focus:outline-none"
          />
        </label>

        {state === "error" ? <Notice tone="error">Sending the report failed — try again.</Notice> : null}

        <button
          type="submit"
          disabled={state === "sending"}
          className="rounded-sm bg-ink px-4 py-2.5 text-sm font-medium text-paper hover:bg-verdigris-deep disabled:opacity-60"
        >
          {state === "sending" ? "Sending…" : "Send report"}
        </button>
      </form>
    </section>
  );
}
