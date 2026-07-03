import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Fraunces, Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import Link from "next/link";

import { AuthCorner } from "@/components/auth-corner";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  style: ["normal", "italic"],
  weight: ["400", "600"],
});

export const metadata: Metadata = {
  title: "Wisp — sealed, expiring shares",
  description:
    "Share sensitive documents and messages, end-to-end encrypted in your browser. The server only ever stores ciphertext.",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Sender accounts are optional (SPEC §5b): without Clerk keys the app runs
  // management-token-only and no Clerk code is rendered at all.
  const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
  // Under strict-dynamic CSP, Clerk's hot-loaded script must carry the nonce.
  const nonce = clerkEnabled ? ((await headers()).get("x-nonce") ?? undefined) : undefined;

  const page = (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} min-h-dvh antialiased`}
      >
        <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-5">
          <header className="flex items-baseline justify-between border-b border-mist py-5">
            <Link href="/" className="font-display text-2xl italic tracking-tight">
              Wisp
            </Link>
            <span className="flex items-center gap-4">
              <p className="hidden font-mono text-[11px] uppercase tracking-widest text-faded sm:block">
                sealed · expiring · zero-knowledge
              </p>
              {clerkEnabled ? <AuthCorner /> : null}
            </span>
          </header>
          <main className="flex-1 py-10">{children}</main>
          <footer className="border-t border-mist py-5">
            <p className="text-xs leading-relaxed text-faded">
              Everything is encrypted in your browser before upload. The key lives in the link
              itself — after the <span className="font-mono">#</span> — and is never sent to any
              server, so we couldn&apos;t read your content if we wanted to.
            </p>
          </footer>
        </div>
      </body>
    </html>
  );

  return clerkEnabled ? <ClerkProvider nonce={nonce}>{page}</ClerkProvider> : page;
}
