import { insertAccessLog } from "./db/access";
import { clientIp } from "./http";
import { hashIp } from "./tokens";

export type AuditAction = "view" | "download" | "otp_fail" | "revoke" | "sign";
export type AuditResult = "allowed" | "denied" | "expired" | "exhausted";

/**
 * Metadata-only audit trail (SPEC §5). Failures never block the request — the
 * share is the product, the log is not. Returns the log row id, which doubles
 * as the per-access identifier stamped into watermarks so a leaked rendering
 * maps back to exactly this row.
 */
export function logAccess(
  req: Request,
  shareId: string,
  action: AuditAction,
  result: AuditResult,
  recipientId?: string | null,
): Promise<number | null> {
  return insertAccessLog({
    shareId,
    recipientId: recipientId ?? null,
    ipHash: hashIp(clientIp(req)),
    userAgent: (req.headers.get("user-agent") ?? "").slice(0, 256),
    action,
    result,
  });
}
