import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Geist, IBM_Plex_Mono, Space_Grotesk } from "next/font/google";
import { headers } from "next/headers";
import Link from "next/link";

import { AuthCorner } from "@/components/auth-corner";
import { env } from "@/lib/server/env";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});
const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Wisp — sealed, expiring shares",
  description:
    "Share sensitive documents and messages, end-to-end encrypted in your browser. The server only ever stores ciphertext.",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Sender accounts are optional (SPEC §5b): without Clerk keys the app runs
  // management-token-only and no Clerk code is rendered at all.
  const clerkEnabled = Boolean(env.clerkPublishableKey);
  // Under strict-dynamic CSP, Clerk's hot-loaded script must carry the nonce.
  const nonce = clerkEnabled ? ((await headers()).get("x-nonce") ?? undefined) : undefined;

  const page = (
    // Font variables live on <html> so the @theme tokens that reference them
    // resolve at :root — on <body> they'd be invisible to the theme layer.
    <html
      lang="en"
      className={`${geistSans.variable} ${plexMono.variable} ${spaceGrotesk.variable}`}
    >
      <body className="min-h-dvh antialiased">
        {/* Wide frame for header/footer; content stays a narrow column inside. */}
        <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-5 sm:px-8">
          <header className="flex items-center justify-between py-6">
            <Link href="/" className="group flex items-center gap-2.5" aria-label="Wisp home">
              <span className="grid h-7 w-7 place-items-center rounded-md bg-ink text-[13px] font-semibold text-paper transition-colors group-hover:bg-verdigris">
                ✦
              </span>
              <span className="font-display text-xl">wisp</span>
            </Link>
            <span className="flex items-center gap-2">
              <span className="hidden items-center gap-2 px-2 font-mono text-[11px] tracking-tight text-faded sm:flex">
                <span className="h-1.5 w-1.5 rounded-full bg-verdigris" />
                zero-knowledge
              </span>
              {clerkEnabled ? <AuthCorner /> : null}
            </span>
          </header>
          <main className="flex flex-1 flex-col py-6">
            <div className="mx-auto flex w-full max-w-xl flex-1 flex-col">{children}</div>
          </main>
          <footer className="mt-8 flex flex-col gap-3 border-t border-mist py-6 sm:flex-row sm:items-baseline sm:justify-between">
            <p className="font-mono text-[11px] leading-relaxed tracking-tight text-faded">
              encrypted in your browser · the key lives after the{" "}
              <span className="text-ink">#</span> · the server stores only ciphertext
            </p>
            <nav className="flex gap-4 font-mono text-[11px] tracking-tight">
              <Link
                href="/decode"
                className="inline-flex min-h-6 items-center text-faded transition-colors hover:text-ink"
              >
                trace a leak
              </Link>
              <Link
                href="/report"
                className="inline-flex min-h-6 items-center text-faded transition-colors hover:text-ink"
              >
                report abuse
              </Link>
            </nav>
          </footer>
        </div>
      </body>
    </html>
  );

  return clerkEnabled ? <ClerkProvider nonce={nonce}>{page}</ClerkProvider> : page;
}
