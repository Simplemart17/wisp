import type { MetadataRoute } from "next";

import { APP_DESCRIPTION, APP_NAME, APP_SHORT_NAME, PAPER } from "@/lib/shared/brand";

/**
 * Web app manifest — makes Wisp installable ("Add to Home Screen") on iOS and
 * Android. No service worker on purpose: shares are one-time, network-gated
 * artifacts (view counts, revocation, sweeps live server-side), so an offline
 * cache would only lie about what still exists.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: APP_SHORT_NAME,
    description: APP_DESCRIPTION,
    start_url: "/",
    display: "standalone",
    background_color: PAPER,
    theme_color: PAPER,
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
