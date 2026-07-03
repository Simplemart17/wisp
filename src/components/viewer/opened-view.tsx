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

/** The decrypted content: canvas render (view-only/watermark) or a plain viewer. */
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

  return (
    <section className="unfog space-y-4">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="min-w-0 truncate font-mono text-sm">{metadata.name}</h1>
        <span className="shrink-0 font-mono text-xs text-faded">{formatBytes(metadata.size)}</span>
      </div>

      {renderError ? <Notice tone="error">{renderError}</Notice> : null}

      {useCanvas ? (
        <div
          ref={hostRef}
          onContextMenu={(e) => viewOnly && e.preventDefault()}
          className={`max-h-[70vh] space-y-3 overflow-auto ${viewOnly ? "select-none" : ""}`}
        />
      ) : metadata.type.startsWith("text/") ? (
        <TextBlock blob={blob} />
      ) : metadata.type.startsWith("image/") ? (
        <MediaView blob={blob} type={metadata.type} name={metadata.name} kind="image" />
      ) : playable ? (
        <MediaView
          blob={blob}
          type={metadata.type}
          name={metadata.name}
          kind={metadata.type.startsWith("audio/") ? "audio" : "video"}
        />
      ) : (
        <div className="rounded-sm border border-mist bg-pane p-6 text-center text-sm text-faded">
          This file type can&apos;t be previewed here — download it to open it.
        </div>
      )}

      <div className="flex items-center justify-between gap-4">
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
        {remainingViews !== null ? (
          <span className="shrink-0 font-mono text-xs text-faded">
            {remainingViews === 0
              ? "that was the last view"
              : `${remainingViews} view${remainingViews === 1 ? "" : "s"} left`}
          </span>
        ) : null}
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
        Decrypted locally — the plaintext never left your browser&apos;s memory.{" "}
        <a href={`/report?share=${shareId}`} className="underline hover:text-ink">
          Report abuse
        </a>
      </p>
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
    <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-sm border border-mist bg-card p-4 font-mono text-sm leading-relaxed">
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
      <video controls src={url} className="max-h-[60vh] w-full rounded-sm border border-mist bg-black" />
    );
  }
  // eslint-disable-next-line @next/next/no-img-element -- decrypted blob URL, next/image can't optimize it
  return <img src={url} alt={name} className="max-h-[60vh] w-full rounded-sm border border-mist object-contain" />;
}
