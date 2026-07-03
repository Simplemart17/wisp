/**
 * Single source of truth for the masked email format shown to senders
 * (recipients.email_hint) and compared against on the client during signature
 * identity verification. Both sides MUST agree byte-for-byte — a divergence
 * would make every stored hint mismatch its signature — so the masking lives
 * in one pure, dependency-free module both bundles import.
 *
 * "jane@example.com" → "j***@example.com".
 */
export function maskEmail(email: string): string {
  const [local, domain] = email.toLowerCase().trim().split("@");
  return domain ? `${local.slice(0, 1)}***@${domain}` : email;
}
