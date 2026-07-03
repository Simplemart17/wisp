import { sendEmail, isValidEmail, normalizeEmail } from "@/lib/server/email";
import { ApiError, clientIp, errorResponse, jsonResponse, readJsonBody } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/ratelimit";
import { getShare, requireManagementAccess } from "@/lib/server/shares";
import { wispDb } from "@/lib/server/supabase";
import { sha256Base64Url } from "@/lib/server/tokens";

export const runtime = "nodejs";

/**
 * Email each recipient their unique link (SPEC §5). The full URLs come from
 * the sender's browser because the fragment key never exists server-side; the
 * server forwards them to allowlisted addresses only and stores nothing.
 *
 * Honest limitation (surfaced in the UI too): emailing a link necessarily
 * shows it to the mail infrastructure. For stronger guarantees the sender
 * adds a password and shares it over a different channel.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    if (!rateLimit(`send-links:${clientIp(req)}`, 5, 10 * 60 * 1000)) {
      throw new ApiError(429, "Too many attempts, slow down");
    }

    const share = await getShare(id);
    if (!share || share.parent_share_id !== null) {
      return jsonResponse({ error: "Not found", kind: "gone" }, 404);
    }
    await requireManagementAccess(req, share);
    if (!share.policy.requireIdentity) {
      throw new ApiError(400, "This share has no recipient list");
    }

    const body = await readJsonBody(req);
    if (!Array.isArray(body.links) || body.links.length === 0 || body.links.length > 50) {
      throw new ApiError(400, "links must be a non-empty array");
    }

    const { data: recipients, error } = await wispDb()
      .from("recipients")
      .select("link_id, email_hash, revoked")
      .eq("share_id", id);
    if (error) throw new Error(`recipients read failed: ${error.message}`);
    const byHash = new Map(
      (recipients ?? []).filter((r) => !r.revoked).map((r) => [r.email_hash as string, r.link_id as string]),
    );

    let sent = 0;
    for (const entry of body.links as Array<Record<string, unknown>>) {
      if (!isValidEmail(entry.email) || typeof entry.url !== "string") continue;
      const email = normalizeEmail(entry.email);
      const linkId = byHash.get(sha256Base64Url(email));
      // The URL must be this recipient's own link — nothing else gets forwarded.
      if (!linkId || !entry.url.startsWith(`${new URL(req.url).origin}/s/${linkId}#`)) continue;

      await sendEmail({
        to: email,
        subject: "Someone sent you an encrypted share on Wisp",
        text:
          `You've received an end-to-end encrypted share.\n\n` +
          `Open it here: ${entry.url}\n\n` +
          `You'll verify your email with a one-time code before it opens.\n` +
          `The link may expire or allow a limited number of views.`,
      });
      sent += 1;
    }

    return jsonResponse({ ok: true, sent });
  } catch (error) {
    return errorResponse(error);
  }
}
