/**
 * Access-flow data access: OTP codes, the access log, signatures, and the
 * per-recipient signing ticket.
 */
import { log } from "../log";
import { fromPgBytea, toPgBytea, wispDb } from "./client";

// ── OTP codes ─────────────────────────────────────────────────────────────

/** Retire any live codes for this recipient so exactly one is valid at a time. */
export async function invalidateLiveOtps(shareId: string, emailHash: string): Promise<void> {
  await wispDb()
    .from("otp_codes")
    .update({ consumed: true })
    .eq("share_id", shareId)
    .eq("email_hash", emailHash)
    .eq("consumed", false);
}

export async function insertOtp(
  shareId: string,
  emailHash: string,
  codeHash: string,
  expiresAt: string,
): Promise<void> {
  const { error } = await wispDb()
    .from("otp_codes")
    .insert({ share_id: shareId, email_hash: emailHash, code_hash: codeHash, expires_at: expiresAt });
  if (error) throw new Error(`otp insert failed: ${error.message}`);
}

/** Atomically consume one attempt against the cap; returns the code hash or null. */
export async function claimOtpAttempt(
  shareId: string,
  emailHash: string,
): Promise<{ id: string; codeHash: string } | null> {
  const { data, error } = await wispDb().rpc("claim_otp_attempt", {
    p_share_id: shareId,
    p_email_hash: emailHash,
  });
  if (error) throw new Error(`otp claim failed: ${error.message}`);
  const row = (data as Array<{ id: string; code_hash: string }> | null)?.[0];
  return row ? { id: row.id, codeHash: row.code_hash } : null;
}

/** Single-use burn; returns true only if this call was the one that consumed it. */
export async function consumeOtp(id: string): Promise<boolean> {
  const { data, error } = await wispDb()
    .from("otp_codes")
    .update({ consumed: true })
    .eq("id", id)
    .eq("consumed", false)
    .select("id");
  if (error) throw new Error(`otp consume failed: ${error.message}`);
  return (data ?? []).length === 1;
}

// ── Signing ticket (lives on the recipient row) ─────────────────────────────

export async function setSignTicket(
  recipientId: string,
  ticketHash: string,
  expiresAt: string,
): Promise<void> {
  const { error } = await wispDb()
    .from("recipients")
    .update({ sign_ticket_hash: ticketHash, sign_ticket_expires_at: expiresAt })
    .eq("id", recipientId);
  if (error) throw new Error(`sign ticket update failed: ${error.message}`);
}

export async function clearSignTicket(recipientId: string): Promise<void> {
  await wispDb()
    .from("recipients")
    .update({ sign_ticket_hash: null, sign_ticket_expires_at: null })
    .eq("id", recipientId);
}

// ── Signatures ──────────────────────────────────────────────────────────────

export interface SignatureRecord {
  recipientId: string;
  encryptedEnvelope: string | null; // base64url
  signedAt: string;
  emailHint: string | null;
}

export async function listSignatures(shareId: string): Promise<SignatureRecord[]> {
  const { data, error } = await wispDb()
    .from("signatures")
    .select("recipient_id, encrypted_envelope, created_at, recipients(email_hint)")
    .eq("share_id", shareId);
  if (error) throw new Error(`signatures read failed: ${error.message}`);
  return (data ?? []).map((row) => {
    const r = row as unknown as {
      recipient_id: string;
      encrypted_envelope: string;
      created_at: string;
      recipients: { email_hint: string | null } | null;
    };
    return {
      recipientId: r.recipient_id,
      encryptedEnvelope: fromPgBytea(r.encrypted_envelope),
      signedAt: r.created_at,
      emailHint: r.recipients?.email_hint ?? null,
    };
  });
}

/** Map of recipient_id → signedAt, for the manage view. */
export async function listSignatureTimes(shareId: string): Promise<Map<string, string>> {
  const { data, error } = await wispDb()
    .from("signatures")
    .select("recipient_id, created_at")
    .eq("share_id", shareId);
  if (error) throw new Error(`signatures read failed: ${error.message}`);
  return new Map(
    (data ?? []).map((s) => [
      (s as { recipient_id: string }).recipient_id,
      (s as { created_at: string }).created_at,
    ]),
  );
}

export type SignatureInsert = "ok" | "duplicate";

export async function insertSignature(
  shareId: string,
  recipientId: string,
  encryptedEnvelope: string,
  ipHash: string,
): Promise<SignatureInsert> {
  const { error } = await wispDb().from("signatures").insert({
    share_id: shareId,
    recipient_id: recipientId,
    encrypted_envelope: toPgBytea(encryptedEnvelope),
    ip_hash: ipHash,
  });
  if (error) {
    if (error.code === "23505") return "duplicate";
    throw new Error(`signature insert failed: ${error.message}`);
  }
  return "ok";
}

// ── Access log ──────────────────────────────────────────────────────────────

export interface AuditEntryRecord {
  /** Row id — the cursor tiebreaker; not exposed in DTOs. */
  id: number;
  ts: string;
  ipHash: string | null;
  userAgent: string | null;
  action: string;
  result: string;
  emailHint: string | null;
}

export async function insertAccessLog(entry: {
  shareId: string;
  recipientId: string | null;
  ipHash: string;
  userAgent: string;
  action: string;
  result: string;
}): Promise<number | null> {
  const { data, error } = await wispDb()
    .from("access_log")
    .insert({
      share_id: entry.shareId,
      recipient_id: entry.recipientId,
      ip_hash: entry.ipHash,
      user_agent: entry.userAgent,
      action: entry.action,
      result: entry.result,
    })
    .select("id")
    .single();
  if (error) {
    log.error("audit.write_failed", { error: error.message, shareId: entry.shareId, action: entry.action });
    return null;
  }
  return (data as { id: number }).id;
}

/**
 * One page of the audit trail, newest first. Keyset-paged on (ts, id) — the
 * id tiebreaker matters: ts alone is non-unique, and a strict ts cursor
 * would silently skip rows sharing the boundary timestamp. One extra row is
 * fetched to signal `hasMore`.
 */
export async function listAccessLog(
  shareId: string,
  page: { limit: number; before?: { ts: string; id: string } },
): Promise<{ entries: AuditEntryRecord[]; hasMore: boolean }> {
  let query = wispDb()
    .from("access_log")
    .select("id, ts, ip_hash, user_agent, action, result, recipients(email_hint)")
    .eq("share_id", shareId)
    .order("ts", { ascending: false })
    .order("id", { ascending: false })
    .limit(page.limit + 1);
  if (page.before) {
    const { ts, id } = page.before;
    query = query.or(`ts.lt."${ts}",and(ts.eq."${ts}",id.lt.${id})`);
  }
  const { data, error } = await query;
  if (error) throw new Error(`access_log read failed: ${error.message}`);
  const rows = data ?? [];
  const entries = rows.slice(0, page.limit).map((row) => {
    const r = row as unknown as {
      id: number;
      ts: string;
      ip_hash: string | null;
      user_agent: string | null;
      action: string;
      result: string;
      recipients: { email_hint: string | null } | null;
    };
    return {
      id: r.id,
      ts: r.ts,
      ipHash: r.ip_hash,
      userAgent: r.user_agent,
      action: r.action,
      result: r.result,
      emailHint: r.recipients?.email_hint ?? null,
    };
  });
  return { entries, hasMore: rows.length > page.limit };
}
