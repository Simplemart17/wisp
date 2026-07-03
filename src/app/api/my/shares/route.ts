import { errorResponse, jsonResponse } from "@/lib/server/http";
import { senderUserId } from "@/lib/server/sender-auth";
import { isExpiredAt } from "@/lib/server/shares";
import { wispDb } from "@/lib/server/supabase";

export const runtime = "nodejs";

/**
 * "My shares" (SPEC §5b): the signed-in sender's share history. Anonymous
 * shares are invisible here by design — they carry no owner.
 */
export async function GET(): Promise<Response> {
  try {
    const userId = await senderUserId();
    if (!userId) return jsonResponse({ error: "Sign in required", kind: "unauthorized" }, 401);

    const { data, error } = await wispDb()
      .from("shares")
      .select("id, created_at, expires_at, policy")
      .eq("owner_user_id", userId)
      .is("parent_share_id", null)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(`my shares read failed: ${error.message}`);

    return jsonResponse({
      shares: (data ?? []).map((row) => ({
        id: row.id as string,
        createdAt: row.created_at as string,
        expiresAt: row.expires_at as string | null,
        expired: isExpiredAt(row.expires_at as string | null),
        policy: row.policy,
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
