"use client";

import { useEffect, useRef, useState } from "react";

import type { WatermarkPayload } from "@/lib/client/shares";
import {
  applyVisibleWatermark,
  renderImageToCanvas,
  renderPdfToCanvases,
  renderTextToCanvas,
  watermarkLines,
} from "@/lib/client/render/canvas";
import { embedForensic } from "@/lib/client/render/forensic";
import type { ShareMetadata } from "@/lib/crypto";

const FORENSIC_MAX_PIXELS = 4_000_000;

/**
 * View-only / watermark rendering pipeline: paints the decrypted blob to
 * <canvas> (PDF.js / image / text), composites the visible watermark, and
 * embeds the invisible forensic mark. Returns a host ref plus whether the
 * forensic layer was actually embedded (skipped for very large rasters).
 */
export function useCanvasRender(
  active: boolean,
  blob: Blob,
  metadata: ShareMetadata,
  watermark: WatermarkPayload | null,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [forensicEmbedded, setForensicEmbedded] = useState(false);

  useEffect(() => {
    if (!active || !hostRef.current) return;
    const host = hostRef.current;
    let cancelled = false;

    (async () => {
      let canvases: HTMLCanvasElement[];
      if (metadata.type === "application/pdf") {
        canvases = await renderPdfToCanvases(new Uint8Array(await blob.arrayBuffer()));
      } else if (metadata.type.startsWith("image/")) {
        canvases = [await renderImageToCanvas(blob)];
      } else {
        canvases = [renderTextToCanvas(await blob.text())];
      }
      if (cancelled) return;

      let anyForensic = false;
      for (const canvas of canvases) {
        if (watermark) {
          applyVisibleWatermark(canvas, watermarkLines(watermark));
          if (watermark.accessId !== null && canvas.width * canvas.height <= FORENSIC_MAX_PIXELS) {
            const ctx = canvas.getContext("2d")!;
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            if (embedForensic(imageData, watermark.accessId)) {
              ctx.putImageData(imageData, 0, 0);
              anyForensic = true;
            }
          }
        }
        canvas.className = "block w-full h-auto border border-mist rounded-sm bg-white";
        host.appendChild(canvas);
      }
      if (!cancelled) setForensicEmbedded(anyForensic);
    })().catch((err) => {
      if (!cancelled) setRenderError(err instanceof Error ? err.message : "Rendering failed.");
    });

    return () => {
      cancelled = true;
      host.replaceChildren();
    };
  }, [active, blob, metadata.type, watermark]);

  return { hostRef, renderError, forensicEmbedded };
}
