import type { Metadata } from "next";
import { Fraunces, Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
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

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} min-h-dvh antialiased`}
      >
        <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-5">
          <header className="flex items-baseline justify-between border-b border-mist py-5">
            <Link href="/" className="font-display text-2xl italic tracking-tight">
              Wisp
            </Link>
            <p className="font-mono text-[11px] uppercase tracking-widest text-faded">
              sealed · expiring · zero-knowledge
            </p>
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
}
