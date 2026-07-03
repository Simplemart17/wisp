/**
 * Shares + recipients data access. Returns camelCase domain records with bytea
 * fields already decoded to base64url; callers never see snake_case columns or
 * `\x`-hex.
 */
import type { KdfParams } from "@/lib/crypto";
import { ApiError } from "../http";
import type { SharePolicy } from "../policy";
import { SHARE_ID_RE } from "../validation";
import { fromPgBytea, toPgBytea, wispDb } from "./client";

/** A share (parent) or a per-recipient child link. */
export interface ShareRecord {
  id: string;
  ciphertextRef: string;
  wrappedCek: string | null; // base64url
  kdfSalt: string | null; // base64url
  kdfParams: KdfParams | null;
  encryptedMetadata: string; // base64url
  policy: SharePolicy;
  managementTokenHash: string;
  parentShareId: string | null;
  ownerUserId: string | null;
  createdAt: string;
  expiresAt: string | null;
}

/** Fields common to a parent share and its per-recipient children. */
export interface ShareContent {
  ciphertextRef: string;
  wrappedCek: string | null;
  kdfSalt: string | null;
  kdfParams: KdfParams | null;
  encryptedMetadata: string;
  policy: SharePolicy;
  managementTokenHash: string;
  expiresAt: string | null;
  ownerUserId: string | null;
}

interface ShareRow {
  id: string;
  ciphertext_ref: string;
  wrapped_cek: string | null;
  kdf_salt: string | null;
  kdf_params: KdfParams | null;
  encrypted_metadata: string;
  policy: SharePolicy;
  management_token_hash: string;
  parent_share_id: string | null;
  owner_user_id: string | null;
  created_at: string;
  expires_at: string | null;
}

function toShareRecord(row: ShareRow): ShareRecord {
  return {
    id: row.id,
    ciphertextRef: row.ciphertext_ref,
    wrappedCek: fromPgBytea(row.wrapped_cek),
    kdfSalt: fromPgBytea(row.kdf_salt),
    kdfParams: row.kdf_params,
    encryptedMetadata: fromPgBytea(row.encrypted_metadata) as string,
    policy: row.policy,
    managementTokenHash: row.management_token_hash,
    parentShareId: row.parent_share_id,
    ownerUserId: row.owner_user_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

function contentColumns(content: ShareContent) {
  return {
    ciphertext_ref: content.ciphertextRef,
    wrapped_cek: content.wrappedCek === null ? null : toPgBytea(content.wrappedCek),
    kdf_salt: content.kdfSalt === null ? null : toPgBytea(content.kdfSalt),
    kdf_params: content.kdfParams,
    encrypted_metadata: toPgBytea(content.encryptedMetadata),
    policy: content.policy,
    management_token_hash: content.managementTokenHash,
    owner_user_id: content.ownerUserId,
    expires_at: content.expiresAt,
  };
}

export async function findShare(id: string): Promise<ShareRecord | null> {
  if (!SHARE_ID_RE.test(id)) return null;
  const { data, error } = await wispDb().from("shares").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`shares lookup failed: ${error.message}`);
  if (!data) return null;

  const row = data as ShareRow;
  // Child links carry only their identity + parent reference; content (blob,
  // key wrap, metadata, policy, expiry) is resolved from the parent so there
  // is a single source of truth. The returned record keeps the CHILD's id.
  if (row.parent_share_id !== null) {
    const parent = await findShare(row.parent_share_id);
    if (!parent) return null; // orphaned child (shouldn't happen; cascade covers it)
    return { ...parent, id: row.id, parentShareId: row.parent_share_id, createdAt: row.created_at };
  }
  return toShareRecord(row);
}

/** Load a top-level share for management routes, rejecting unknown/child ids. */
export async function findManageableParent(id: string): Promise<ShareRecord> {
  const share = await findShare(id);
  if (!share || share.parentShareId !== null) {
    throw new ApiError(404, "Not found", "gone");
  }
  return share;
}

export async function insertShare(id: string, content: ShareContent): Promise<void> {
  const { error } = await wispDb()
    .from("shares")
    .insert({ id, ...contentColumns(content) });
  if (error) throw new Error(`share insert failed: ${error.message}`);
}

/** Child links store only their id + parent reference — content lives on the parent. */
export async function insertChildShares(parentId: string, childIds: string[]): Promise<void> {
  const { error } = await wispDb()
    .from("shares")
    .insert(childIds.map((id) => ({ id, parent_share_id: parentId })));
  if (error) throw new Error(`child share insert failed: ${error.message}`);
}

export async function deleteShare(id: string): Promise<void> {
  const { error } = await wispDb().from("shares").delete().eq("id", id);
  if (error) throw new Error(`share delete failed: ${error.message}`);
}

export async function listOwnedShares(userId: string): Promise<ShareRecord[]> {
  const { data, error } = await wispDb()
    .from("shares")
    .select("*")
    .eq("owner_user_id", userId)
    .is("parent_share_id", null)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(`my shares read failed: ${error.message}`);
  return (data ?? []).map((r) => toShareRecord(r as ShareRow));
}

// ── Recipients ────────────────────────────────────────────────────────────

export interface RecipientRecord {
  id: string;
  shareId: string;
  emailHash: string;
  emailHint: string | null;
  linkId: string;
  viewsRemaining: number | null;
  verifiedAt: string | null;
  revoked: boolean;
  signTicketHash: string | null;
  signTicketExpiresAt: string | null;
}

interface RecipientRow {
  id: string;
  share_id: string;
  email_hash: string;
  email_hint: string | null;
  link_id: string;
  views_remaining: number | null;
  verified_at: string | null;
  revoked: boolean;
  sign_ticket_hash: string | null;
  sign_ticket_expires_at: string | null;
}

function toRecipientRecord(row: RecipientRow): RecipientRecord {
  return {
    id: row.id,
    shareId: row.share_id,
    emailHash: row.email_hash,
    emailHint: row.email_hint,
    linkId: row.link_id,
    viewsRemaining: row.views_remaining,
    verifiedAt: row.verified_at,
    revoked: row.revoked,
    signTicketHash: row.sign_ticket_hash,
    signTicketExpiresAt: row.sign_ticket_expires_at,
  };
}

export async function findRecipientByLink(linkId: string): Promise<RecipientRecord | null> {
  const { data, error } = await wispDb()
    .from("recipients")
    .select("*")
    .eq("link_id", linkId)
    .maybeSingle();
  if (error) throw new Error(`recipients lookup failed: ${error.message}`);
  return data ? toRecipientRecord(data as RecipientRow) : null;
}

export interface NewRecipient {
  shareId: string;
  linkId: string;
  emailHash: string;
  emailHint: string;
  viewsRemaining: number | null;
}

export async function insertRecipients(recipients: NewRecipient[]): Promise<void> {
  const { error } = await wispDb().from("recipients").insert(
    recipients.map((r) => ({
      share_id: r.shareId,
      link_id: r.linkId,
      email_hash: r.emailHash,
      email_hint: r.emailHint,
      views_remaining: r.viewsRemaining,
    })),
  );
  if (error) throw new Error(`recipients insert failed: ${error.message}`);
}

export interface RecipientStatusRow {
  link_id: string;
  email_hint: string | null;
  views_remaining: number | null;
  verified_at: string | null;
  revoked: boolean;
}

export async function listRecipientStatus(shareId: string): Promise<
  Array<RecipientStatusRow & { id: string }>
> {
  const { data, error } = await wispDb()
    .from("recipients")
    .select("id, link_id, email_hint, views_remaining, verified_at, revoked")
    .eq("share_id", shareId)
    .order("email_hint");
  if (error) throw new Error(`recipients read failed: ${error.message}`);
  return (data ?? []) as Array<RecipientStatusRow & { id: string }>;
}

/** Allowlist lookup for send-links: email_hash → link_id (non-revoked). */
export async function listRecipientLinks(shareId: string): Promise<Map<string, string>> {
  const { data, error } = await wispDb()
    .from("recipients")
    .select("link_id, email_hash, revoked")
    .eq("share_id", shareId);
  if (error) throw new Error(`recipients read failed: ${error.message}`);
  return new Map(
    (data ?? [])
      .filter((r) => !(r as { revoked: boolean }).revoked)
      .map((r) => [(r as { email_hash: string }).email_hash, (r as { link_id: string }).link_id]),
  );
}

export async function markRecipientVerified(recipientId: string): Promise<void> {
  await wispDb()
    .from("recipients")
    .update({ verified_at: new Date().toISOString() })
    .eq("id", recipientId)
    .is("verified_at", null);
}

/** Returns the link ids actually revoked (empty if none matched). */
export async function revokeRecipient(shareId: string, linkId: string): Promise<string[]> {
  const { data, error } = await wispDb()
    .from("recipients")
    .update({ revoked: true })
    .eq("share_id", shareId)
    .eq("link_id", linkId)
    .select("link_id");
  if (error) throw new Error(`recipient revoke failed: ${error.message}`);
  return (data ?? []).map((r) => (r as { link_id: string }).link_id);
}

/** Atomic per-recipient view consume; null = denied, -1 = unlimited. */
export async function consumeRecipientView(linkId: string): Promise<number | null> {
  const { data, error } = await wispDb().rpc("consume_recipient_view", { p_link_id: linkId });
  if (error) throw new Error(`consume_recipient_view failed: ${error.message}`);
  return data as number | null;
}

/** Atomic global view consume for anonymous shares; null = denied. */
export async function consumeShareView(shareId: string): Promise<number | null> {
  const { data, error } = await wispDb().rpc("consume_view", { p_share_id: shareId });
  if (error) throw new Error(`consume_view failed: ${error.message}`);
  return data as number | null;
}
