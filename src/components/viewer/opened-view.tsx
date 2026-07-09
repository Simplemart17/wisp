"use client";

import { useEffect, useMemo, useState } from "react";

import type { WatermarkPayload } from "@/lib/client/shares";
import { burnForDownload } from "@/lib/client/render/burn";
import { isCanvasRenderable } from "@/lib/client/render/canvas";
import type { ShareMetadata } from "@/lib/crypto";
import { Notice, formatBytes } from "../bits";
import { useCanvasRender } from "./use-canvas-render";

export interface OpenedViewProps {
  blob: Blob;
  metadata: ShareMetadata;
  remainingViews: number | null;
  viewOnly: boolean;
  watermark: WatermarkPayload | null;
  shareId: string;
}

/** The reveal: decrypted content unfogs first; everything else is a ledger line. */
export function OpenedView({
  blob,
  metadata,
  remainingViews,
  viewOnly,
  watermark,
  shareId,
}: OpenedViewProps) {
  const renderable = isCanvasRenderable(metadata.type);
  const playable = metadata.type.startsWith("audio/") || metadata.type.startsWith("video/");
  const useCanvas = renderable && (viewOnly || watermark !== null);
  const { hostRef, renderError, forensicEmbedded } = useCanvasRender(
    useCanvas,
    blob,
    metadata,
    watermark,
  );
  const [downloading, setDownloading] = useState(false);

  async function download() {
    setDownloading(true);
    try {
      // When downloads are allowed AND a watermark is required, burn it into
      // the copy (images + PDFs) before handing the bytes over.
      const out = watermark
        ? await burnForDownload(blob, metadata, watermark)
        : { blob, name: metadata.name, burned: false };
      const url = URL.createObjectURL(out.blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = out.name;
      a.click();
      // Revoke on a later tick — revoking synchronously can cancel a large
      // download before the browser reads it.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } finally {
      setDownloading(false);
    }
  }

  const isPlainText = !useCanvas && metadata.type.startsWith("text/");

  return (
    <section className="space-y-4">
      <p className="rise font-mono text-[11px] uppercase tracking-[0.12em] text-verdigris-deep">
        unsealed — decrypted locally
      </p>

      {renderError ? <Notice tone="error">{renderError}</Notice> : null}

      {useCanvas ? (
        // role="img" + label: canvas pixels are invisible to assistive tech,
        // and view-only content deliberately has no text alternative (it would
        // defeat the watermark/copy deterrence) — so say that honestly instead
        // of leaving screen-reader users with unlabeled silence.
        <div
          ref={hostRef}
          role="img"
          aria-label={`Protected rendering of ${metadata.name}. This document is drawn as pixels for watermarking and cannot be read by a screen reader — ask the sender for an accessible copy if you need one.`}
          onContextMenu={(e) => viewOnly && e.preventDefault()}
          className={`unfog max-h-[70svh] space-y-3 overflow-auto [animation-delay:100ms] ${viewOnly ? "select-none" : ""}`}
        />
      ) : isPlainText ? (
        <TextBlock blob={blob} />
      ) : metadata.type.startsWith("image/") ? (
        <div className="unfog [animation-delay:100ms]">
          <MediaView blob={blob} type={metadata.type} name={metadata.name} kind="image" />
        </div>
      ) : playable ? (
        <div className="unfog [animation-delay:100ms]">
          <MediaView
            blob={blob}
            type={metadata.type}
            name={metadata.name}
            kind={metadata.type.startsWith("audio/") ? "audio" : "video"}
          />
        </div>
      ) : (
        <div className="unfog well rounded-sm border border-mist p-6 text-center text-sm text-faded [animation-delay:100ms]">
          This file type can&apos;t be previewed here — download it to open it.
        </div>
      )}

      <div className="rise space-y-3 [animation-delay:280ms]">
        {remainingViews === 0 ? (
          <p
            role="status"
            className="rounded-sm border border-wax/30 bg-wax/5 px-3.5 py-2.5 font-mono text-xs uppercase tracking-[0.14em] text-wax-deep"
          >
            burned — this link will not open again
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          {viewOnly ? (
            <span className="text-xs text-faded">
              View-only: rendered {playable ? "for playback" : "to pixels"}, no download offered.
              (This deters saving — it cannot stop screenshots or recordings.)
            </span>
          ) : (
            <button
              type="button"
              onClick={() => void download()}
              disabled={downloading}
              className="rounded-sm border border-mist px-4 py-2 text-sm font-medium transition-colors hover:border-ink disabled:opacity-60"
            >
              {downloading ? "Preparing…" : watermark ? "Download watermarked copy" : "Download"}
            </button>
          )}
          <span className="shrink-0 font-mono text-xs tracking-tight text-faded">
            {metadata.name} · {formatBytes(metadata.size)}
            {remainingViews !== null && remainingViews > 0
              ? ` · ${remainingViews} view${remainingViews === 1 ? "" : "s"} left`
              : ""}
          </span>
        </div>

        {watermark && useCanvas ? (
          <p className="text-xs leading-relaxed text-faded">
            This rendering is watermarked to {watermark.email ?? "this link"} — a visible tile
            {forensicEmbedded ? " plus an invisible forensic mark are" : " is"} burned into the
            pixels, so copies stay traceable.
          </p>
        ) : watermark ? (
          <p className="text-xs leading-relaxed text-faded">
            A watermark was requested, but this content type can&apos;t be watermarked in the
            viewer — the request is recorded, though no mark is burned into playback.
          </p>
        ) : null}
        <p className="text-xs leading-relaxed text-faded">
          The plaintext never left your browser&apos;s memory.{" "}
          <a href={`/report?share=${shareId}`} className="underline hover:text-ink">
            Report abuse
          </a>
        </p>
      </div>
    </section>
  );
}

function TextBlock({ blob }: { blob: Blob }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    blob.text().then((t) => {
      if (!cancelled) setText(t);
    });
    return () => {
      cancelled = true;
    };
  }, [blob]);
  if (text === null) return null;
  return (
    // Letters settle into place as they decrypt — the unfog, spoken in text.
    <pre className="unfog-text max-h-[60svh] overflow-auto rounded-sm border border-mist bg-card p-5 font-mono text-[15px] leading-relaxed whitespace-pre-wrap [animation-delay:100ms]">
      {text}
    </pre>
  );
}

function MediaView({
  blob,
  type,
  name,
  kind,
}: {
  blob: Blob;
  type: string;
  name: string;
  kind: "image" | "audio" | "video";
}) {
  const url = useMemo(
    () => URL.createObjectURL(blob.type ? blob : new Blob([blob], { type })),
    [blob, type],
  );
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  if (kind === "audio") {
    return <audio controls src={url} className="w-full" />;
  }
  if (kind === "video") {
    return (
      <video controls src={url} className="max-h-[60svh] w-full rounded-sm border border-mist bg-black" />
    );
  }
  // eslint-disable-next-line @next/next/no-img-element -- decrypted blob URL, next/image can't optimize it
  return <img src={url} alt={name} className="max-h-[60svh] w-full rounded-sm border border-mist object-contain" />;
}
