"use client";

import { Show, SignInButton, UserButton } from "@clerk/nextjs";
import Link from "next/link";

/** Header auth area — rendered only when Clerk is configured (SPEC §5b). */
export function AuthCorner() {
  return (
    <span className="flex items-center gap-3">
      <Show when="signed-out">
        <SignInButton mode="modal">
          <button
            type="button"
            className="inline-flex min-h-11 items-center px-2 font-mono text-[11px] tracking-tight text-faded transition-colors hover:text-ink"
          >
            sign in
          </button>
        </SignInButton>
      </Show>
      <Show when="signed-in">
        <Link
          href="/dashboard"
          className="inline-flex min-h-11 items-center px-2 font-mono text-[11px] tracking-tight text-faded transition-colors hover:text-ink"
        >
          my shares
        </Link>
        <UserButton
          appearance={{ elements: { userButtonAvatarBox: { width: "1.5rem", height: "1.5rem" } } }}
        />
      </Show>
    </span>
  );
}
