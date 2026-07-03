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
    <html lang="en">
      <body
        className={`${geistSans.variable} ${plexMono.variable} ${spaceGrotesk.variable} min-h-dvh antialiased`}
      >
        <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-5">
          <header className="flex items-center justify-between py-6">
            <Link href="/" className="group flex items-center gap-2.5" aria-label="Wisp home">
              <span className="grid h-7 w-7 place-items-center rounded-md bg-ink text-[13px] font-semibold text-paper transition-colors group-hover:bg-verdigris">
                ✦
              </span>
              <span className="font-display text-xl tracking-tight">wisp</span>
            </Link>
            <span className="flex items-center gap-4">
              <span className="hidden items-center gap-2 font-mono text-[11px] tracking-tight text-faded sm:flex">
                <span className="h-1.5 w-1.5 rounded-full bg-verdigris" />
                zero-knowledge
              </span>
              {clerkEnabled ? <AuthCorner /> : null}
            </span>
          </header>
          <main className="flex-1 py-6">{children}</main>
          <footer className="mt-8 border-t border-mist py-6">
            <p className="max-w-prose text-xs leading-relaxed text-faded">
              Everything is encrypted in your browser before upload. The key lives in the link
              itself — after the <span className="font-mono text-ink">#</span> — and never reaches a
              server, so we couldn&apos;t read your content if we wanted to.
            </p>
          </footer>
        </div>
      </body>
    </html>
  );

  return clerkEnabled ? <ClerkProvider nonce={nonce}>{page}</ClerkProvider> : page;
}
