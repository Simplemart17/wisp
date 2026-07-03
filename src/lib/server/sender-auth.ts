/**
 * Optional Clerk sender identity (SPEC §5b). Senders are anonymous by
 * default; when Clerk keys are configured a signed-in sender's shares are
 * associated with their user id, unlocking the "My shares" dashboard and
 * token-less manage access. Recipients never touch Clerk.
 */
import { auth } from "@clerk/nextjs/server";

export function clerkEnabled(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY,
  );
}

/** Signed-in sender's Clerk user id, or null (signed out / Clerk disabled). */
export async function senderUserId(): Promise<string | null> {
  if (!clerkEnabled()) return null;
  try {
    const { userId } = await auth();
    return userId;
  } catch {
    // clerkMiddleware didn't run (misconfig) — treat as anonymous, never fail.
    return null;
  }
}
