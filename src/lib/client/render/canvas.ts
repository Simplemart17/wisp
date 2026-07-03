/**
 * View-only rendering (SPEC §9): content is painted ONLY onto <canvas> — no
 * selectable text layer, no <img> holding the raw bytes — and the watermark
 * is composited into the same raster, so there is no DOM node to delete.
 *
 * Honest tier note (client-honored): this deters casual extraction and keeps
 * leaks attributable; it cannot stop screenshots.
 */
import type { WatermarkPayload } from "@/lib/client/shares";

export const RENDER_WIDTH = 1000; // CSS px basis; canvases scale to fit

export function renderTextToCanvas(text: string, width = RENDER_WIDTH): HTMLCanvasElement {
  const scale = Math.min(window.devicePixelRatio || 1, 2);
  const fontSize = 15;
  const lineHeight = fontSize * 1.6;
  const padding = 24;
  const font = `${fontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;

  // First pass: wrap lines against the target width.
  const measurer = document.createElement("canvas").getContext("2d")!;
  measurer.font = font;
  const maxLineWidth = width - padding * 2;
  const lines: string[] = [];
  for (const raw of text.split("\n")) {
    let current = "";
    for (const word of raw.split(/(\s+)/)) {
      if (current && measurer.measureText(current + word).width > maxLineWidth) {
        lines.push(current);
        current = word.trimStart();
      } else {
        current += word;
      }
    }
    lines.push(current);
  }

  const height = Math.max(120, lines.length * lineHeight + padding * 2);
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(width * scale);
  canvas.height = Math.floor(height * scale);
  canvas.dataset.cssWidth = String(width);

  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#16211e";
  ctx.font = font;
  ctx.textBaseline = "top";
  lines.forEach((line, i) => ctx.fillText(line, padding, padding + i * lineHeight));
  return canvas;
}

export async function renderImageToCanvas(data: Uint8Array, type: string): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(new Blob([data as BlobPart], { type }));
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.dataset.cssWidth = String(Math.min(bitmap.width, RENDER_WIDTH));
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas;
}

/** One canvas per PDF page, rendered by PDF.js (worker bundled, CSP-safe). */
export async function renderPdfToCanvases(data: Uint8Array): Promise<HTMLCanvasElement[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  const loadingTask = pdfjs.getDocument({ data: data.slice() });
  const doc = await loadingTask.promise;
  const scale = Math.min(window.devicePixelRatio || 1, 2);
  const canvases: HTMLCanvasElement[] = [];
  for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
    const page = await doc.getPage(pageNo);
    const base = page.getViewport({ scale: 1 });
    const cssScale = RENDER_WIDTH / base.width;
    const viewport = page.getViewport({ scale: cssScale * scale });

    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.dataset.cssWidth = String(RENDER_WIDTH);
    await page.render({
      canvas,
      canvasContext: canvas.getContext("2d")!,
      viewport,
    }).promise;
    canvases.push(canvas);
  }
  await loadingTask.destroy();
  return canvases;
}

/** What gets stamped: who (verified email or link id), when, where, which access. */
export function watermarkLines(mark: WatermarkPayload): string[] {
  return [
    mark.email ?? `link ${mark.linkId}`,
    `${new Date().toISOString().slice(0, 16)}Z · ip ${mark.ipHash}${
      mark.accessId !== null ? ` · access #${mark.accessId}` : ""
    }`,
  ];
}

/**
 * Composite the visible watermark into the canvas pixels: a diagonal tile
 * across the full raster. Painted after content, same bitmap — stripping it
 * means repainting the document.
 */
export function applyVisibleWatermark(canvas: HTMLCanvasElement, lines: string[]): void {
  const ctx = canvas.getContext("2d")!;
  const { width, height } = canvas;
  const fontSize = Math.max(13, Math.floor(width / 55));

  ctx.save();
  ctx.globalAlpha = 0.14;
  ctx.fillStyle = "#1c2b26";
  ctx.font = `600 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.textAlign = "center";
  ctx.translate(width / 2, height / 2);
  ctx.rotate(-Math.PI / 6);

  const tileW = Math.max(fontSize * 22, 360);
  const tileH = Math.max(fontSize * 9, 130);
  const diag = Math.hypot(width, height);
  for (let y = -diag / 2; y < diag / 2; y += tileH) {
    const rowOffset = (Math.floor(y / tileH) % 2) * (tileW / 2);
    for (let x = -diag / 2; x < diag / 2; x += tileW) {
      lines.forEach((line, i) => {
        ctx.fillText(line, x + rowOffset, y + i * (fontSize * 1.5), tileW * 0.9);
      });
    }
  }
  ctx.restore();
}
