/**
 * Download-time watermark burning (SPEC §9): when a share allows download AND
 * requires a watermark, the client burns the marks into a re-encoded copy
 * before offering it — the zero-knowledge server can't watermark ciphertext
 * it can't read.
 *
 * - Images → re-encoded PNG with the visible tile + invisible forensic mark.
 * - PDFs   → pdf-lib copy with the visible tile drawn on every page.
 * - Other types are returned unchanged (the viewer says so).
 */
import type { ShareMetadata, } from "@/lib/crypto";
import type { WatermarkPayload } from "@/lib/client/shares";
import { applyVisibleWatermark, watermarkLines } from "./canvas";
import { embedForensic } from "./forensic";

export interface BurnedDownload {
  blob: Blob;
  name: string;
  burned: boolean;
}

export async function burnForDownload(
  blob: Blob,
  metadata: ShareMetadata,
  mark: WatermarkPayload,
): Promise<BurnedDownload> {
  if (metadata.type.startsWith("image/")) {
    return burnImage(blob, metadata, mark);
  }
  if (metadata.type === "application/pdf") {
    return burnPdf(blob, metadata, mark);
  }
  return { blob, name: metadata.name, burned: false };
}

async function burnImage(
  blob: Blob,
  metadata: ShareMetadata,
  mark: WatermarkPayload,
): Promise<BurnedDownload> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  applyVisibleWatermark(canvas, watermarkLines(mark));
  if (mark.accessId !== null) {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    if (embedForensic(imageData, mark.accessId)) ctx.putImageData(imageData, 0, 0);
  }

  const burned = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!burned) return { blob, name: metadata.name, burned: false };
  const name = metadata.name.replace(/\.[a-z0-9]+$/i, "") + ".watermarked.png";
  return { blob: burned, name, burned: true };
}

async function burnPdf(
  blob: Blob,
  metadata: ShareMetadata,
  mark: WatermarkPayload,
): Promise<BurnedDownload> {
  const { PDFDocument, StandardFonts, degrees, rgb } = await import("pdf-lib");
  const doc = await PDFDocument.load(await blob.arrayBuffer());
  const font = await doc.embedFont(StandardFonts.Courier);
  const text = watermarkLines(mark).join("  ·  ");

  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    const size = Math.max(9, Math.floor(width / 60));
    const stepY = size * 14;
    const stepX = font.widthOfTextAtSize(text, size) + size * 8;
    for (let y = -height; y < height * 2; y += stepY) {
      for (let x = -width; x < width * 2; x += stepX) {
        page.drawText(text, {
          x,
          y,
          size,
          font,
          color: rgb(0.11, 0.17, 0.15),
          opacity: 0.14,
          rotate: degrees(30),
        });
      }
    }
  }

  const bytes = await doc.save();
  return {
    blob: new Blob([bytes as BlobPart], { type: "application/pdf" }),
    name: metadata.name.replace(/\.pdf$/i, "") + ".watermarked.pdf",
    burned: true,
  };
}
