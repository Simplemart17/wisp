# Wisp

**Zero-knowledge sharing for sensitive documents and messages.** The sender's
browser encrypts content *before* upload; the server only ever stores
ciphertext; the recipient decrypts locally. The decryption key lives in the
URL fragment (`/s/<id>#<key>`), which browsers never transmit to any server.

Full design: [SPEC.md](SPEC.md).

## Features

- **End-to-end encryption** — AES-256-GCM in STREAM-style chunks (large files
  never sit in memory), keys derived and used only in the browser.
- **Password protection** (cryptographic) — Argon2id-wrapped key; a leaked
  link alone is useless.
- **Expiry, view limits, burn-after-read** (server-enforced) — atomic view
  consumption; a "click to reveal" interstitial keeps link-preview bots from
  silently burning one-time views.
- **Recipient identity** (server-enforced) — per-recipient links + email OTP
  (hashed codes, attempt caps, no-enumeration responses); every open is
  logged against a verified identity.
- **View-only + watermark** (client-honored, honestly labeled) — content
  renders only to `<canvas>`; a visible identity tile plus an invisible
  DCT forensic mark are burned into the pixels. Trace leaks at `/decode`.
- **Document signing** (zero-knowledge e-signatures) — verified recipients
  sign in their browser: an ECDSA P-256 signature over the exact plaintext,
  sealed under a key derived from the share's CEK. The server attests *who*
  and *when* (OTP identity + timestamp) but can never read *what* was signed;
  anyone who can open the share verifies signatures locally.
- **Revoke & audit** — anonymous senders get a one-time management link;
  hard-delete the blob, or revoke a single recipient.
- **Notify-on-open**, abuse reporting, hashed IPs everywhere, nonce-based CSP,
  `Referrer-Policy: no-referrer` (fragment hygiene).

## Stack

Next.js (App Router) · Supabase (Postgres `wisp` schema + private Storage) ·
Resend (email, optional) · hash-wasm (Argon2id) · PDF.js · pdf-lib.

Uses Supabase's **new API keys**: the server authenticates with the secret key
(`sb_secret_…`); the browser ships **no** Supabase key at all (signed URLs
only). Legacy `anon`/`service_role` JWTs are not used.

## Local development

Prereqs: Node 20+, pnpm, Docker, [Supabase CLI](https://supabase.com/docs/guides/cli).

```bash
pnpm install
supabase start          # local Postgres + Storage; applies supabase/migrations
pnpm dev                # uses .env.development.local → local stack
```

Emails (OTP codes, share links) print to the dev-server console unless
`RESEND_API_KEY` is set.

```bash
pnpm test               # vitest — crypto core, policy, forensic watermark
pnpm typecheck && pnpm lint && pnpm build
```

## Hosted deployment (Vercel + Supabase)

1. Create a Supabase project. Apply the schema:
   `supabase link --project-ref <ref> && supabase db push`
   (or paste `supabase/migrations/*.sql` into the SQL editor, in order).
2. Dashboard → **Settings → Data API → Exposed schemas**: add `wisp`.
3. Create the private Storage bucket `wisp` (or let the app's first upload
   fail and create it by hand — private, ~50 MiB file limit on free tier).
4. Deploy to Vercel with the env vars below.

## Self-hosting

```bash
docker build -t wisp .
docker run -p 3007:3007 \
  -e SUPABASE_URL=... -e SUPABASE_SECRET_KEY=... \
  -e WISP_IP_SALT=$(openssl rand -hex 16) wisp
```

The image serves on port `3007` (override with `-e PORT=…`).

Point it at any Supabase project — hosted or
[self-hosted Supabase](https://supabase.com/docs/guides/self-hosting).

### Docker + Cloudflare Tunnel

`docker-compose.yml` runs the app with a [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
as the only ingress — no ports are published on the host, so the app is
reachable exclusively through your Cloudflare hostname.

1. Zero Trust dashboard → **Networks → Tunnels → Create a tunnel**
   (Cloudflared connector) and copy the **token**.
2. On the tunnel, add a **Public Hostname** (e.g. `wisp.example.com`) with
   Service **`http://app:3007`** — that's the app container's address on the
   compose network.
3. Configure and launch:

   ```bash
   cp .env.deploy.example .env.deploy   # fill in TUNNEL_TOKEN, Supabase, etc.
   docker compose --env-file .env.deploy up -d --build
   ```

Notes: behind Cloudflare the default `WISP_TRUSTED_PROXY_DEPTH=1` is correct.
The Clerk publishable key is baked into the browser bundle at image build
time, so changing it needs a rebuild (`up -d --build`). For the expiry
sweeper, point pg_cron at `https://<your-hostname>/api/sweep` with your
`WISP_SWEEP_SECRET` as the bearer token.

## Environment

| Variable | Required | Purpose |
|---|---|---|
| `SUPABASE_URL` | yes | Project URL |
| `SUPABASE_SECRET_KEY` | yes | `sb_secret_…` key — server-side only |
| `RESEND_API_KEY` | no | Real email delivery (console log otherwise) |
| `WISP_EMAIL_FROM` | no | From address for outgoing mail |
| `WISP_IP_SALT` | recommended | Salts hashed IPs in the audit log (random per-process if unset) |
| `WISP_TRUSTED_PROXY_DEPTH` | recommended | Trusted reverse-proxy count for spoof-resistant client IP (default 1) |
| `WISP_SWEEP_SECRET` | no | Enables `POST /api/sweep` (expiry cleanup via pg_cron) |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | no | Enables optional sender accounts + "My shares" dashboard |
| `CLERK_SECRET_KEY` | no | Server side of the Clerk integration |

## Honest limits (read SPEC §2)

Once someone can *see* content they can copy it — view-only and watermarks are
**traceability and deterrence**, not prevention. Browser-delivered E2E means a
malicious server could ship key-stealing JS; self-hosting and CSP shrink, but
don't eliminate, that trust. The forensic watermark v1 survives re-encoding
and noise, not cropping/scaling/photographing a screen.
