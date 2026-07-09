/**
 * App identity, single-sourced so the layout metadata and the PWA manifest
 * can't drift — the manifest surfaces (install prompt, splash, status bar)
 * only render on installed PWAs, where stale copies would otherwise linger
 * unnoticed.
 */
export const APP_NAME = "Wisp — sealed, expiring shares";
export const APP_SHORT_NAME = "Wisp";
export const APP_DESCRIPTION =
  "Share sensitive documents and messages, end-to-end encrypted in your browser. The server only ever stores ciphertext.";

/** The paper ground. Mirrors --paper in globals.css and the fill in
    src/app/icon.svg — CSS/SVG can't import this, so update all three. */
export const PAPER = "#f0f1ee";
