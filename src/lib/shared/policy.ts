/**
 * The share policy schema — single source of truth for the shape stored in
 * shares.policy (JSONB) and echoed in DTOs. Server validation (policy.ts) and
 * the client create form both build against this type, so adding a control
 * starts here.
 *
 * On-the-wire versions elsewhere: the content blob carries CONTENT_FORMAT_VERSION,
 * the signature envelope SIGNATURE_VERSION, and the AES-GCM AADs embed "wisp/v1/…"
 * — this adds the matching marker for the policy object itself.
 */
export const POLICY_VERSION = 1;

/** The window options a sender can pick; seconds are resolved server-side. */
export type ExpiryChoice = "1h" | "24h" | "7d" | "30d";

export interface SharePolicy {
  /** Policy schema version (absent on pre-versioning rows → treat as 1). */
  v?: number;
  expiresIn: ExpiryChoice;
  maxViews: number | null;
  password: boolean; // cryptographic (Argon2id-wrapped CEK)
  requireIdentity: boolean; // server-enforced email OTP gate
  requireSignature: boolean; // cryptographic ECDSA envelope + verified identity
  viewOnly: boolean; // client-honored: no download affordance
  watermark: boolean; // client-honored: burned into the rendered canvas
  notifyEmail: string | null; // notify-on-open target
}

/** The boolean policy flags, in one list so UIs/validators can iterate them. */
export const POLICY_FLAGS = [
  "requireIdentity",
  "requireSignature",
  "viewOnly",
  "watermark",
] as const;
