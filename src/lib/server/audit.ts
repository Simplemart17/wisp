import { clientIp } from "./http";
import { wispDb } from "./supabase";
import { hashIp } from "./tokens";

export type AuditAction = "view" | "download" | "otp_fail" | "revoke";
export type AuditResult = "allowed" | "denied" | "expired" | "exhausted";

/**
 * Metadata-only audit trail (SPEC §5). Failures are logged to the console but
 * never block the request — the share itself is the product, the log is not.
 */
export async function logAccess(
  req: Request,
  shareId: string,
  action: AuditAction,
  result: AuditResult,
): Promise<void> {
  const { error } = await wispDb()
    .from("access_log")
    .insert({
      share_id: shareId,
      ip_hash: hashIp(clientIp(req)),
      user_agent: (req.headers.get("user-agent") ?? "").slice(0, 256),
      action,
      result,
    });
  if (error) console.error("[wisp] failed to write access_log:", error.message);
}
