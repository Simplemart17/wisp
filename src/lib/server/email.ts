/**
 * Transactional email (SPEC §6: Resend). When RESEND_API_KEY is unset — local
 * dev, tests, self-hosts that don't want email — messages are logged to the
 * server console instead of sent, so every flow stays exercisable.
 */

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
}

// The URL fragment after `#` is the decryption link-key — it must never be
// written to logs. Redact it from any URL before console output.
function redactFragments(text: string): string {
  return text.replace(/(https?:\/\/\S+?)#\S+/g, "$1#<link-key-redacted>");
}

export async function sendEmail(email: OutgoingEmail): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.WISP_EMAIL_FROM ?? "Wisp <onboarding@resend.dev>";

  if (!apiKey) {
    console.log(
      `[wisp:email:dev] to=${email.to} subject=${JSON.stringify(email.subject)}\n${redactFragments(email.text)}`,
    );
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ from, to: [email.to], subject: email.subject, text: email.text }),
  });
  if (!res.ok) {
    // Email failures must never leak whether an address exists (enumeration),
    // and share creation shouldn't die on a delivery hiccup — log and move on.
    console.error(`[wisp] email send failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: unknown): value is string {
  return typeof value === "string" && value.length <= 254 && EMAIL_RE.test(value);
}

/** Lowercased + trimmed before hashing so "Jane@X.com" and "jane@x.com" match. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** "jane@example.com" → "j***@example.com" — sender-facing label, not identity. */
export { maskEmail as emailHint } from "@/lib/email-mask";
