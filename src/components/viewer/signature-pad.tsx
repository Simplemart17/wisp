"use client";

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";

import { MAX_SIGNATURE_IMAGE_BYTES } from "@/lib/client/signing";

export interface SignaturePadHandle {
  /** Trimmed PNG of the ink, or null when the pad is empty. */
  toPngBytes(): Promise<Uint8Array | null>;
  clear(): void;
}

const PAD_HEIGHT = 160; // css px
const EXPORT_MAX_WIDTH = 480; // device px — plenty for a signature mark
const TRIM_PADDING = 8; // css px kept around the ink's bounding box

/** Size the DPR-scaled bitmap to the current layout (this clears any ink)
    and return the geometry it was sized for. */
function sizeCanvas(canvas: HTMLCanvasElement): { cssWidth: number; dpr: number } {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(canvas.clientWidth * dpr);
  canvas.height = Math.round(PAD_HEIGHT * dpr);
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.scale(dpr, dpr);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = getComputedStyle(canvas).color; // inherits text color (ink)
  }
  return { cssWidth: canvas.clientWidth, dpr };
}

/**
 * Hand-drawn signature capture. Pointer events unify mouse/touch/stylus (with
 * pressure-sensitive stroke width where the device reports it); the ink is
 * exported as a transparent PNG trimmed to its bounding box, never uploaded
 * anywhere by this component — the caller seals it into the signature
 * envelope. Drawing needs a pointer, which is why the mark stays optional:
 * keyboard-only signers sign with their typed name alone.
 */
export function SignaturePad({
  disabled = false,
  onInkChange,
  ref,
}: {
  disabled?: boolean;
  onInkChange?: (hasInk: boolean) => void;
  ref?: Ref<SignaturePadHandle>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hasInk, setHasInk] = useState(false);
  // Drawing state lives in refs — strokes must not re-render per pointermove.
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  // Ink bounding box in css px, grown as strokes land (for the trimmed export).
  const bounds = useRef<{ minX: number; minY: number; maxX: number; maxY: number } | null>(null);
  // The css width and dpr the bitmap was sized for. Once ink freezes the
  // bitmap, clientWidth keeps tracking rotations/resizes — every coordinate
  // (strokes in, crops out) must map through THIS geometry, never the live
  // clientWidth, or exports crop the wrong region and strokes land offset.
  const sized = useRef<{ cssWidth: number; dpr: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Keep the DPR-scaled bitmap in sync with layout — but only while the pad
    // is EMPTY: sizing resets the bitmap, and strokes must never be wiped by a
    // rotation/resize. Once ink lands, the size freezes until clear().
    const size = () => {
      if (bounds.current) return;
      sized.current = sizeCanvas(canvas);
    };
    size();
    const observer = new ResizeObserver(size);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  function point(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    // Map from the on-screen rect into the bitmap's frozen css space — after
    // a mid-signature rotation the w-full canvas stretches, and unmapped
    // coordinates would land ink beside the finger. Height never stretches
    // (PAD_HEIGHT is fixed), so only x needs the scale.
    const scaleX = sized.current ? sized.current.cssWidth / rect.width : 1;
    return { x: (e.clientX - rect.left) * scaleX, y: e.clientY - rect.top };
  }

  function grow(p: { x: number; y: number }) {
    const b = bounds.current;
    bounds.current = b
      ? {
          minX: Math.min(b.minX, p.x),
          minY: Math.min(b.minY, p.y),
          maxX: Math.max(b.maxX, p.x),
          maxY: Math.max(b.maxY, p.y),
        }
      : { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y };
  }

  function stroke(e: React.PointerEvent<HTMLCanvasElement>, from: { x: number; y: number }) {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const to = point(e);
    // Stylus pressure (0..1) widens the line; mice report 0.5 or 0.
    ctx.lineWidth = e.pressure > 0 ? 1 + e.pressure * 2.5 : 2;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    grow(from);
    grow(to);
    last.current = to;
    if (!hasInk) {
      setHasInk(true);
      onInkChange?.(true);
    }
  }

  function handleDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Capture is an enhancement (keeps strokes while leaving the canvas);
      // some browsers throw for exotic pointers — drawing works without it.
    }
    drawing.current = true;
    last.current = point(e);
  }

  function handleMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || !last.current) return;
    stroke(e, last.current);
  }

  function handleUp(e: React.PointerEvent<HTMLCanvasElement>) {
    if (drawing.current && last.current) stroke(e, last.current); // dot for a tap
    drawing.current = false;
    last.current = null;
  }

  function clear() {
    const canvas = canvasRef.current;
    bounds.current = null;
    // Re-sizing clears the ink AND refreshes the frozen geometry to the
    // current layout (ResizeObserver won't fire without a layout change).
    if (canvas) sized.current = sizeCanvas(canvas);
    setHasInk(false);
    onInkChange?.(false);
  }

  useImperativeHandle(ref, () => ({
    clear,
    async toPngBytes() {
      const canvas = canvasRef.current;
      const b = bounds.current;
      if (!canvas || !b) return null;
      // The dpr the bitmap was actually sized with — deriving it from the
      // live clientWidth breaks after any rotation/resize since ink froze
      // the bitmap (bounds are recorded in that frozen css space too).
      const dpr = sized.current?.dpr ?? canvas.width / canvas.clientWidth;
      // Trim to the ink (plus padding), clamped to the canvas.
      const sx = Math.max(0, (b.minX - TRIM_PADDING) * dpr);
      const sy = Math.max(0, (b.minY - TRIM_PADDING) * dpr);
      const sw = Math.min(canvas.width - sx, (b.maxX - b.minX + 2 * TRIM_PADDING) * dpr);
      const sh = Math.min(canvas.height - sy, (b.maxY - b.minY + 2 * TRIM_PADDING) * dpr);
      if (sw < 2 || sh < 2) return null;

      const scale = Math.min(1, EXPORT_MAX_WIDTH / sw);
      const out = document.createElement("canvas");
      out.width = Math.max(1, Math.round(sw * scale));
      out.height = Math.max(1, Math.round(sh * scale));
      out.getContext("2d")?.drawImage(canvas, sx, sy, sw, sh, 0, 0, out.width, out.height);

      const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/png"));
      if (!blob || blob.size > MAX_SIGNATURE_IMAGE_BYTES) return null;
      return new Uint8Array(await blob.arrayBuffer());
    },
  }));

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        aria-label="Signature drawing area — draw with your mouse, finger, or stylus. Optional; your typed name is the signature."
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerCancel={handleUp}
        style={{ height: PAD_HEIGHT }}
        className={`w-full touch-none rounded-sm border border-mist bg-card text-ink ${
          disabled ? "pointer-events-none opacity-60" : "cursor-crosshair"
        }`}
      />
      {/* Baseline guide — CSS only, so it never appears in the exported PNG. */}
      <div aria-hidden className="pointer-events-none absolute right-6 bottom-9 left-6 border-b border-dashed border-mist" />
      {hasInk ? (
        <button
          type="button"
          onClick={clear}
          className="absolute top-2 right-2 rounded-xs px-2 py-1 font-mono text-[11px] text-faded hover:text-ink"
        >
          clear
        </button>
      ) : (
        <span className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center font-mono text-[11px] tracking-[0.14em] text-hush uppercase">
          draw your signature
        </span>
      )}
    </div>
  );
}
