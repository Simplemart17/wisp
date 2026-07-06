# Wisp — Technical Specification

**A zero-knowledge service for sharing sensitive documents and messages.**
The sender's browser encrypts content *before* upload; the server only ever stores ciphertext; the recipient decrypts locally in their browser. Every privacy control is configurable per share.

- **Status:** Draft v1
- **Platform:** Responsive web app
- **Stack:** Next.js (App Router) + Supabase (Postgres, Storage, Edge Functions) + Clerk (sender auth) + Resend (transactional email)
- **Trust model:** Zero-knowledge — the server cannot read shared content, by design.

---

## 1. Product principles

1. **The server never sees plaintext.** Encryption and decryption happen only in the browser. The secret key lives in the URL fragment (`#…`), which browsers never transmit to a server.
2. **Be honest about strength.** Every control belongs to one of three tiers (below). The UI must not promise more than a tier can deliver.
3. **Sender is in control.** Each share carries a policy the sender configures. Sensible presets reduce decision fatigue; every toggle stays editable.
4. **Minimize metadata.** Even filenames are encrypted. The server stores only what it must to enforce policy.
5. **Self-hostable.** For a privacy product, the ability to run your own instance is a feature, not an afterthought.

### The three tiers of protection

| Tier | Controls | Guarantee |
|---|---|---|
| **Cryptographic** | content encryption, password-wrapped key | Absolute — protected by math, not policy. |
| **Server-enforced** | expiry, revoke, one-time / max-views, recipient OTP, access logging, notify-on-open | Reliable — the server holds the ciphertext and can refuse to release it. |
| **Client-honored** | view-only (block download), **tamper-resistant watermark**, screenshot deterrence | Best-effort deterrent — enforced by the Wisp viewer. The watermark is burned into rendered pixels (not a strippable DOM overlay) and carries an invisible forensic layer, so leaks — even screenshots/photos — stay *traceable to the recipient*. Raises removal cost sharply, but an authorized viewer holding the plaintext can still, in principle, defeat it. |

---

## 2. Threat model

### Wisp protects against
- **Network eavesdroppers** — TLS in transit + content already encrypted client-side.
- **A compromised or curious server / storage / database** — only ciphertext and minimal metadata are stored; keys never reach the server.
- **Link leakage** — password protection and/or required recipient identity mean a leaked link alone is insufficient.
- **Over-retention** — expiry, one-time view, and revoke bound how long content is reachable.
- **Wrong recipient / accountability gaps** — per-recipient links + email OTP + identity-stamped audit log + watermark.

### Wisp does NOT protect against (non-goals — state these plainly in the UI)
- **The analog hole.** Once an authorized recipient can *see* content, they can copy it (screenshot, photo, extract from browser memory). No web app can revoke or corrupt a file that has already been rendered/saved. "View-only" and the tamper-resistant/forensic watermark are **traceability and deterrence** tools — they make leaks costly and attributable, **not** impossible.
- **A malicious app server.** Because the crypto code is delivered by the web server, a compromised server could serve key-stealing JS. This is the inherent limit of *all* browser-delivered E2E. Mitigated (never eliminated) by CSP, SRI, reproducible/published builds, a minimal client, and the self-host option.
- **Endpoint compromise.** A recipient's malware-infected device is out of scope.
- **True remote-wipe of downloaded files.** Only achievable with a controlled native client + enterprise DRM — out of scope for the web v1 (see Roadmap Phase 3).

---

## 3. Cryptographic design

All primitives via the browser-native **Web Crypto API**, except the password KDF (Argon2id via WASM — `hash-wasm`).

### Encryption (sender, in-browser)
1. Generate a random 256-bit **content encryption key (CEK)**.
2. Encrypt payload with **AES-256-GCM**. Files are encrypted in **chunks** (e.g. 4 MB) each with its own nonce, so large files don't exhaust memory.
3. Encrypt **metadata** (filename, size, content-type) with the CEK too — the server never learns the filename.
4. Generate a random **link-key** and split the secret model:
   - The **link-key** is placed in the URL fragment: `https://wisp.app/s/<id>#<link-key>`.
   - If **password** is enabled: derive a wrapping key from the password with **Argon2id** (store `salt` + `params`), and encrypt the CEK with it → `wrapped_cek`.
   - The CEK is reconstructed at decrypt time from the link-key **and** (if set) the password. When both are required, a leaked link alone is useless.
5. Upload `ciphertext`, `wrapped_cek`, `kdf_salt`, `kdf_params`, `encrypted_metadata`, and the `policy` to the server. Receive a short **share id**.

### Decryption (recipient, in-browser)
1. Pass any server-enforced gates (identity OTP, view count) → server returns a short-lived **signed URL** to the ciphertext.
2. Fetch ciphertext. If password-protected, prompt → Argon2id → unwrap CEK. Combine with `#link-key`.
3. Decrypt and render locally. **The fragment key and plaintext never leave the browser.**

### Fragment hygiene
- `Referrer-Policy: no-referrer` on all pages so the fragment can't leak via the `Referer` header.
- Strip the fragment from browser history where feasible; never log full URLs anywhere.

---

## 4. Configurable share policy

The sender sets a policy per share. Each control is an independent toggle; the `policy` object is stored as JSONB (server-visible metadata — not content, so still zero-knowledge).

```jsonc
// shares.policy
{
  "expiresIn": "24h",              // server-enforced
  "maxViews": 1,                   // server-enforced ("one-time" = 1)
  "password": true,                // cryptographic (Argon2id-wrapped CEK)
  "requireIdentity": true,         // server-enforced (email OTP)
  "recipients": ["jane@x.com"],    // allowlist; drives per-recipient links
  "viewOnly": true,                // client-honored (block download)
  "watermark": {                   // client-honored
    "enabled": true,
    "fields": ["email", "timestamp", "ip"]
  },
  "notifyOnOpen": true             // server-enforced
}
```

### Toggle dependencies (enforce in the UI)
- **View-only** applies only to types Wisp can render in-browser (PDF, images, plain text). For other types (`.zip`, `.xlsx`, …) it is disabled and the share falls back to encrypted download — state this inline.
- **Watermark** works without identity (stamps timestamp + link id), but shows *who* only when **Require identity** is on. Nudge the user to enable both together.
- **One-time / max-views + multiple recipients:** because each recipient gets their own link, the view limit is enforced **per recipient**, not globally. Tooltip must say so.

### Presets (pre-fill toggles; still editable)
- **Maximum privacy** — view-only · watermark · identity · one-time · 24h · password
- **Standard** — identity · 7d · 3 views · notify-on-open
- **Quick share** — link-only · 7d · unlimited

---

## 5. Recipient identity & audit trail

When **Require identity** is on:

1. Sender lists recipient emails. Wisp mints **one link per recipient** (distinct `id`), so every access maps to exactly one identity and each recipient is individually revocable.
2. Recipient opens their link → enters their email → Wisp sends a **one-time code** via a custom OTP flow (Edge Function + Resend): a random 6-digit code is generated, stored **hashed** with a short expiry and an attempt cap, and emailed only to allowlisted addresses.
3. On verify, the gating layer checks the verified email against the share's **allowlist**, atomically consumes a view, and returns a signed URL. Access is logged as `jane@x.com · opened · <ts> · <ip-hash>`.
4. The verified email is what the **watermark** paints across the rendered document — identity and watermark reinforce each other.
5. The **sender** reads the audit trail via their **management token** (senders have no heavy account either).

> **Resolved — auth split.** Recipients stay **account-less**: identity is proven by a **custom Edge-Function OTP** (hashed codes, short expiry, per-IP/per-share rate limiting, constant-time compare, attempt caps) verified against the share's allowlist — no user record is ever created for a recipient. **Clerk** handles **sender** authentication only, and only when a sender wants a persistent dashboard (see §5b). We deliberately do *not* use Clerk for recipient verification: it would mint a user per recipient and inflate MAU billing for a one-time gate.

### 5b. Sender accounts (Clerk — optional)

Senders are **anonymous by default**: creating a share yields a **management link** (`/manage/<id>#<mgmt-token>`) that gates revoke + audit with no login. Signing in with **Clerk** is optional and unlocks a persistent **"My shares" dashboard**: share history, cross-share audit, and reliable notify-on-open delivery to a known address. When a Clerk-authenticated sender creates a share, we associate it with their Clerk `user_id` (`shares.owner_user_id`); anonymous shares carry only the `management_token_hash`. This preserves the "anyone can share" property while rewarding sign-in with continuity. *(Self-host note: Clerk is a hosted dependency — self-hosted instances can run management-token-only or swap in another sender-auth provider.)*

---

## 6. System architecture

```
Browser (Next.js client, Web Crypto + Argon2id WASM)
  │  encrypt / decrypt happen HERE only — fragment key never sent
  ▼
Next.js App Router
  ├─ Clerk middleware            authenticates SENDERS (optional; dashboard/history)
  ├─ Server Components / static viewer shell
  └─ Route Handlers (server-side, Supabase secret-key client)
        • POST /api/shares             create share (store ciphertext ref + metadata + policy)
        • POST /api/shares/:id/otp     recipient: generate + email hashed OTP (rate-limited)
        • POST /api/shares/:id/access  gate: verify OTP vs allowlist + atomic view-consume → signed URL
        • POST /api/shares/:id/revoke  management-token- or Clerk-owner-gated delete
        • GET  /api/shares/:id/audit   management-token- or Clerk-owner-gated log read
  ▼
Clerk                            SENDER identity (optional accounts, dashboard)
Supabase
  ├─ Storage (PRIVATE bucket)   ciphertext blobs; released only via short-TTL createSignedUrl()
  ├─ Postgres                    shares, recipients, access_log, otp_codes; RLS on
  │     └─ RPC consume_view()    atomic decrement + burn
  └─ pg_cron + pg_net            periodic sweeper → deletes expired blobs + rows + stale OTPs
Resend                          transactional email (OTP codes, share links, notify-on-open)
```

**Division of responsibility**
- **Sender auth** is handled by **Clerk** (optional); recipient identity is a **custom OTP** gate — no recipient accounts.
- **Synchronous gating** (create, OTP, access, revoke, audit) lives in **Next.js Route Handlers** using a Supabase client authenticated with the **secret key** (`sb_secret_…`, the successor to the legacy `service_role` JWT — it runs as the `service_role` Postgres role), initialized with `db: { schema: 'wisp' }` so all queries and `rpc()` calls target the dedicated **`wisp`** schema — single codebase, server-side secrets never shipped to the browser.
- **API keys.** Legacy `anon`/`service_role` JWT keys are not used anywhere (deprecated by Supabase, end of 2026). The **browser ships no Supabase key at all**: it reaches Storage only through pre-signed upload/download URLs (plain `fetch`) and the DB only through our Route Handlers. The **publishable key** (`sb_publishable_…`, successor to `anon`) is needed only if the client ever adopts supabase-js directly; the **secret key** stays server-side, in env, always.
- **Scheduled/background** work (expiry + stale-OTP sweep) runs via **pg_cron** calling a protected endpoint with **pg_net** (`net.http_post`).
- **Ciphertext is never public.** The private Storage bucket is read only through short-lived signed URLs issued *after* policy checks pass.

---

## 7. Data model (Postgres — dedicated `wisp` schema)

All Wisp objects live in a dedicated **`wisp`** schema (not `public`), for isolation. It must be added to **Exposed schemas** in the Supabase API settings so the server's secret-key client can reach it, and the supabase-js client is initialized with `db: { schema: 'wisp' }` (see §6).

```sql
-- All Wisp objects live in a dedicated `wisp` schema (not public).
create schema if not exists wisp;
set search_path = wisp;                 -- create the objects below inside wisp

-- One row per share (or per recipient link when identity is required).
create table shares (
  id                    text primary key,          -- opaque, URL-safe
  ciphertext_ref        text not null,             -- path in private Storage bucket
  wrapped_cek           bytea,                     -- null when no password
  kdf_salt              bytea,
  kdf_params            jsonb,                     -- argon2id params
  encrypted_metadata    bytea not null,            -- filename/size/type, encrypted
  policy                jsonb not null,
  management_token_hash text not null,             -- hash of sender's mgmt secret
  parent_share_id       text references shares(id),-- set for per-recipient children
  owner_user_id         text,                      -- Clerk user id; null for anonymous senders
  created_at            timestamptz not null default now(),
  expires_at            timestamptz
);

-- Only when policy.requireIdentity is true.
create table recipients (
  id            uuid primary key default gen_random_uuid(),
  share_id      text not null references shares(id) on delete cascade,
  email_hash    text not null,                     -- store hash, not raw email
  link_id       text not null unique,              -- the per-recipient share id
  views_remaining int not null,
  verified_at   timestamptz,
  revoked       boolean not null default false
);

-- Metadata-only audit; never content.
create table access_log (
  id           bigserial primary key,
  share_id     text not null references shares(id) on delete cascade,
  recipient_id uuid references recipients(id),
  ts           timestamptz not null default now(),
  ip_hash      text,                               -- hashed, not raw IP
  user_agent   text,
  action       text not null,                      -- view | download | otp_fail | revoke
  result       text not null                       -- allowed | denied | expired | exhausted
);

-- Custom recipient OTP: hashed codes, short-lived, attempt-capped.
create table otp_codes (
  id           uuid primary key default gen_random_uuid(),
  share_id     text not null references shares(id) on delete cascade,
  email_hash   text not null,
  code_hash    text not null,                     -- hash of the 6-digit code
  expires_at   timestamptz not null,
  attempts     int not null default 0,            -- cap to blunt brute force
  consumed     boolean not null default false
);

-- Atomic burn-after-read: decrement only if views remain, in one statement.
create or replace function consume_view(p_share_id text)
returns int language sql
set search_path = wisp as $$
  update shares s
     set policy = jsonb_set(policy, '{maxViews}',
                            to_jsonb((policy->>'maxViews')::int - 1))
   where s.id = p_share_id
     and (policy->>'maxViews')::int > 0
     and (s.expires_at is null or s.expires_at > now())
  returning (policy->>'maxViews')::int;
$$;
-- (For per-recipient limits, decrement recipients.views_remaining analogously.)

-- Lock table access to the service_role role ONLY. Clients never touch the
-- DB directly — all access is mediated by Next.js Route Handlers using the
-- secret key (sb_secret_…), which runs as service_role. anon/authenticated
-- (i.e. anything reachable with a publishable key) deliberately get no grants.
grant usage      on schema wisp             to service_role;
grant all on all tables    in schema wisp   to service_role;
grant all on all routines  in schema wisp   to service_role;
grant all on all sequences in schema wisp   to service_role;
alter default privileges in schema wisp grant all on tables    to service_role;
alter default privileges in schema wisp grant all on sequences to service_role;
```

Enable **RLS** on all tables as defense-in-depth (even though `service_role` bypasses it); clients never query them directly — all access is mediated by Route Handlers using the service role, which apply the gating logic explicitly. Note this **intentionally departs** from Supabase's default "expose to `anon, authenticated, service_role`" recipe: `anon`/`authenticated` get **no** grants on `wisp`, so even if the schema is reachable via the API, direct client access returns nothing.

---

## 8. Key server flows

### Create share
`POST /api/shares` — store `ciphertext_ref` (already uploaded to the private bucket via a signed *upload* URL), `wrapped_cek`, `encrypted_metadata`, `policy`, `management_token_hash`, and `expires_at`. If `requireIdentity`, create one child `shares` row + `recipients` row per email and email each recipient their unique link (Resend). Return the sender's management link.

### Access / decrypt
`POST /api/shares/:id/access`:
1. Load share; reject if expired or exhausted (log `denied/expired|exhausted`).
2. If `requireIdentity`: require a valid OTP verification for an allowlisted email (see *Request OTP* below); reject + log `otp_fail` on mismatch, expiry, or exceeded attempts.
3. Call `consume_view()` (atomic). If it returns ≥0, issue `createSignedUrl(ciphertext_ref, 60)` (short TTL).
4. Log `view/allowed` with `ip_hash`, `user_agent`, verified `recipient_id`. If `notifyOnOpen`, email the sender.
5. Client downloads ciphertext via the signed URL and decrypts locally.

> **Burn-after-read interstitial:** the viewer must show a "Click to reveal" confirmation *before* calling `/access`, so link-preview bots (Slack, iMessage) can't silently consume a one-time view.

### Request OTP (recipient)
`POST /api/shares/:id/otp` — rate-limited per IP + per share. Look up the recipient by `email_hash` in the allowlist; if present, generate a random 6-digit code, store its **hash** in `otp_codes` with a short `expires_at`, and email it via Resend. Verification happens inside `/access`: constant-time compare, enforce `expires_at` and the `attempts` cap, mark `consumed` on success. Return **uniform responses** regardless of whether the email is on the allowlist (no enumeration).

### Revoke & audit (sender)
`POST /api/shares/:id/revoke` and `GET /api/shares/:id/audit` — authorize via **either** the management token (validated against `management_token_hash`) **or** a Clerk session whose `user_id` matches `owner_user_id`. Then delete the blob + rows (revoke) or return `access_log` rows (audit).

### Expiry sweeper
`pg_cron` job (e.g. every 5 min) → `pg_net.http_post` to a protected sweep endpoint → delete Storage objects and rows where `expires_at < now()` or fully exhausted.

---

## 9. Client-side rendering (view-only & watermark)

- **View-only** documents are rendered in-browser (PDF.js for PDFs; `<canvas>`/`<img>` for images; escaped text for plain text). The raw decrypted bytes are never attached to a download affordance or object URL the user can right-click-save. *(Honest caveat surfaced in UI: does not stop screenshots.)*
- **Tamper-resistant watermark** (`policy.watermark.fields` = verified email · timestamp · IP · per-access nonce), built in two layers:
  1. **Visible, burned into pixels.** The watermark is composited **onto the same `<canvas>` as the page content** — a single raster with no separate DOM/CSS node to delete. There is no overlay element to right-click-remove; stripping it means repainting the document without it. Content is rendered *only* to canvas (no selectable text layer that could be lifted watermark-free).
  2. **Invisible forensic mark.** A robust, imperceptible identifier (frequency-domain **DCT/DWT**, not fragile LSB) is embedded in the rendered pixels, encoding the per-access nonce → recipient. Designed to **survive screenshots, photos, cropping, and re-compression**, so a leaked image still maps back to the exact `access_log` row.
- The watermark payload is **unique per access** (nonce tied to one `access_log` entry), so any leak is attributable to a single recipient + timestamp.
- **Downloads (non-view-only shares):** when a share permits download *and* requires a watermark, the client burns the visible + forensic mark into a re-encoded copy (e.g. `pdf-lib` for PDFs) before offering it — the zero-knowledge server can't watermark ciphertext it can't read.
- **Honest tier note:** even tamper-resistant/forensic watermarking is **client-honored**. It sharply raises the cost of clean removal and keeps leaks attributable through screenshots, but a determined recipient holding the plaintext can still, in principle, defeat it. Traceability + deterrence, not cryptographic prevention — microcopy must say so.

---

## 10. Security hardening

- **CSP**: strict `default-src 'self'`; no inline scripts; nonce/hash-based. **SRI** on all bundles.
- **Reproducible, published builds** so the served client can be independently audited/pinned.
- **`Referrer-Policy: no-referrer`**, `X-Content-Type-Options: nosniff`, `Permissions-Policy` locked down.
- **Rate limiting** on `/access` and OTP endpoints (per-IP + per-share) to blunt brute force and enumeration; opaque, high-entropy share ids.
- **Store hashes, not raw values** for management tokens, recipient emails, and IPs.
- **No plaintext logging**, anywhere — enforce via a logging lint/review rule.
- **Upload limits** + client-side type checks; abuse/malware reporting path (note: we can't scan ciphertext — rely on reporting + rate limits).

---

## 11. Roadmap

- **Phase 0 — Crypto core.** Standalone, fully-tested TS module: AES-256-GCM encrypt/decrypt, chunked file streaming, Argon2id key-wrap, link-key/password secret model. Reviewed before any UI. *(Bugs here are fatal — build and prove it first.)*
- **Phase 1 — MVP.** Encrypt→upload→link→decrypt for text + small files. Policy scaffold wired for **expiry + view limit + password**. Burn-after-read interstitial. No identity yet.
- **Phase 2 — Full v1.** Per-recipient links + **custom email OTP** (Edge Function + Resend), identity-stamped audit trail, management token + **optional Clerk sender accounts** (revoke + audit + "my shares"), **view-only renderer (PDF.js)**, **tamper-resistant visible watermark burned into canvas**, notify-on-open, full toggle UI + presets, CSP/SRI/`no-referrer` hardening, rate limiting.
- **Phase 3 — Enhancements.** **Invisible forensic watermark** (DCT/DWT surviving screenshots) + download-time watermark burning, streamed large files, more renderers, self-host packaging, stronger sender SSO via Clerk, abuse handling, and (if ever needed) a native/desktop client with real DRM for true revoke-after-download.

---

## 12. Tech stack summary

| Concern | Choice |
|---|---|
| Framework | **Next.js** (App Router; Route Handlers for the API) |
| Symmetric crypto | Web Crypto API — **AES-256-GCM** |
| Password KDF | **Argon2id** via `hash-wasm` (WASM) |
| Database | **Supabase Postgres** — dedicated **`wisp`** schema (exposed to service-role only; RLS on) |
| Blob storage | **Supabase Storage** — private bucket, short-TTL `createSignedUrl` |
| Sender auth (optional) | **Clerk** (dashboard, share history, cross-share audit) |
| Recipient identity | **Custom OTP** — Edge Function + Resend (hashed codes, allowlist, rate-limited) |
| Scheduled jobs | Compose sweeper sidecar → `POST /api/sweep` (pg_cron + pg_net also works) |
| Transactional email | **Resend** (share links, notify-on-open) |
| Deploy | Docker (standalone Next.js) behind a Cloudflare Tunnel, pointed at hosted or self-hosted Supabase |

---

## 13. Resolved decisions

- **Sender accounts** — anonymous-by-default (management token); **optional Clerk sign-in** unlocks a "my shares" dashboard + cross-share audit. (§5b)
- **Recipient OTP** — **custom Edge-Function OTP + Resend**, no recipient accounts; Clerk is not used for recipient verification. (§5)
- **Abuse/malware** — content is unscannable by design (zero-knowledge), so mitigation is **user reporting + rate limits + upload caps**, not content scanning. (§10)
- **Watermark robustness** — **tamper-resistant**: visible mark burned into the canvas raster (Phase 2) + invisible forensic layer surviving screenshots (Phase 3). Remains client-honored — traceability, not prevention. (§9)

### Still open
- Invisible-forensic watermark: which DCT/DWT scheme, and the payload-capacity vs. robustness trade-off (Phase 3 spike).
- Whether to offer Clerk-verified *recipients* (stronger identity) as an enterprise option later, accepting the MAU cost.
- Self-hosting: Clerk is a hosted dependency — self-hosted instances run management-token-only or swap in another sender-auth provider.
