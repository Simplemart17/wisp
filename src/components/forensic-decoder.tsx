"use client";

import { useState } from "react";

import { extractForensic } from "@/lib/client/render/forensic";
import { Notice } from "./bits";

type Result =
  | { state: "idle" }
  | { state: "working" }
  | { state: "found"; accessId: number }
  | { state: "none" };

/**
 * Leak tracing (SPEC §9): senders drop a leaked screenshot/export here; if the
 * invisible forensic mark survives, the access id maps the leak to one row in
 * their share's audit log. Everything runs locally — the image never uploads.
 */
export function ForensicDecoder() {
  const [result, setResult] = useState<Result>({ state: "idle" });

  async function decode(file: File) {
    setResult({ state: "working" });
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      const accessId = extractForensic(ctx.getImageData(0, 0, canvas.width, canvas.height));
      setResult(accessId === null ? { state: "none" } : { state: "found", accessId });
    } catch {
      setResult({ state: "none" });
    }
  }

  return (
    <section className="space-y-5">
      <div>
        <h1 className="font-display text-2xl tracking-[-0.015em]">Trace a leak</h1>
        <p className="mt-2 text-sm leading-relaxed text-faded">
          Watermarked renderings carry an invisible forensic mark. Drop a leaked image here to
          recover its <span className="font-mono">access id</span>, then match it against your
          share&apos;s audit log. The image is analyzed locally — it never leaves your browser.
        </p>
      </div>

      <label className="flex cursor-pointer flex-col items-center gap-1 rounded-sm border border-dashed border-mist bg-card px-4 py-10 text-sm text-faded transition-colors hover:border-verdigris has-focus-visible:border-verdigris has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-verdigris">
        <input
          type="file"
          accept="image/*"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void decode(file);
          }}
          className="sr-only"
        />
        <span>Choose the leaked image (PNG or JPEG)</span>
      </label>

      {result.state === "working" ? (
        <p className="flex items-center gap-2 font-mono text-sm text-faded" role="status">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-verdigris" />
          Analyzing pixels…
        </p>
      ) : null}
      {result.state === "found" ? (
        <div className="unfog space-y-2 rounded-sm border border-verdigris/40 bg-verdigris/5 p-4">
          <p className="text-sm">
            Forensic mark recovered:{" "}
            <span className="font-mono font-medium text-verdigris-deep">
              access #{result.accessId}
            </span>
          </p>
          <p className="text-xs leading-relaxed text-faded">
            Open your share&apos;s management link — the audit log row with this id tells you who
            opened the share, when, and from which (hashed) address.
          </p>
        </div>
      ) : null}
      {result.state === "none" ? (
        <Notice tone="warn">
          No forensic mark found. The image may be cropped, scaled, or heavily re-compressed
          beyond what this v1 decoder handles — or it simply isn&apos;t a watermarked Wisp
          rendering.
        </Notice>
      ) : null}
    </section>
  );
}
