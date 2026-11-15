"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

import "./globals.css";

/**
 * Last-resort boundary: replaces the root layout when rendering itself
 * throws, so it must bring its own <html>. Reports the error (a no-op
 * without a DSN) and offers a retry — nothing decrypted is ever shown here.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        <main className="safe-frame mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-4">
          <h1 className="font-display text-2xl">Something went wrong</h1>
          <p className="text-sm text-faded">
            Wisp hit an unexpected error. Your link and its key are untouched — try again.
          </p>
          <button
            type="button"
            onClick={reset}
            className="self-start rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
