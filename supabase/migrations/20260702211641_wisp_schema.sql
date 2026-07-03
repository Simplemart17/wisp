-- Wisp schema — SPEC §7. Run this in the Supabase SQL editor (or `supabase db push`).
-- Afterwards, add "wisp" to Exposed schemas: Dashboard → Settings → API → Exposed schemas.

create schema if not exists wisp;
set search_path = wisp;

-- One row per share (or per recipient link when identity is required, Phase 2).
create table if not exists shares (
  id                    text primary key,          -- opaque, URL-safe, high-entropy
  ciphertext_ref        text not null,             -- path in private Storage bucket
  wrapped_cek           bytea,                     -- null when no password
  kdf_salt              bytea,
  kdf_params            jsonb,                     -- argon2id params
  encrypted_metadata    bytea not null,            -- filename/size/type, encrypted
  policy                jsonb not null,
  management_token_hash text not null,             -- hash of sender's mgmt secret
  parent_share_id       text references shares(id),-- set for per-recipient children (Phase 2)
  owner_user_id         text,                      -- Clerk user id; null for anonymous senders
  created_at            timestamptz not null default now(),
  expires_at            timestamptz
);

-- Only when policy.requireIdentity is true (Phase 2).
create table if not exists recipients (
  id              uuid primary key default gen_random_uuid(),
  share_id        text not null references shares(id) on delete cascade,
  email_hash      text not null,                   -- store hash, not raw email
  link_id         text not null unique,            -- the per-recipient share id
  views_remaining int not null,
  verified_at     timestamptz,
  revoked         boolean not null default false
);

-- Metadata-only audit; never content.
create table if not exists access_log (
  id           bigserial primary key,
  share_id     text not null references shares(id) on delete cascade,
  recipient_id uuid references recipients(id),
  ts           timestamptz not null default now(),
  ip_hash      text,                               -- hashed, not raw IP
  user_agent   text,
  action       text not null,                      -- view | download | otp_fail | revoke
  result       text not null                       -- allowed | denied | expired | exhausted
);

-- Custom recipient OTP: hashed codes, short-lived, attempt-capped (Phase 2).
create table if not exists otp_codes (
  id           uuid primary key default gen_random_uuid(),
  share_id     text not null references shares(id) on delete cascade,
  email_hash   text not null,
  code_hash    text not null,                      -- hash of the 6-digit code
  expires_at   timestamptz not null,
  attempts     int not null default 0,             -- cap to blunt brute force
  consumed     boolean not null default false
);

-- Atomic burn-after-read: decrement only if views remain, in one statement.
-- Returns the remaining view count, or no row when denied (exhausted/expired).
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

-- Defense-in-depth: RLS on (service_role bypasses it; nothing else has grants).
alter table shares     enable row level security;
alter table recipients enable row level security;
alter table access_log enable row level security;
alter table otp_codes  enable row level security;

-- Lock table access to the service_role role ONLY. Clients never touch the
-- DB directly — all access is mediated by Next.js Route Handlers using the
-- secret key (sb_secret_…), which runs as service_role. anon/authenticated
-- (i.e. anything reachable with a publishable key) deliberately get no grants.
grant usage on schema wisp                         to service_role;
grant all on all tables    in schema wisp          to service_role;
grant all on all routines  in schema wisp          to service_role;
grant all on all sequences in schema wisp          to service_role;
alter default privileges in schema wisp grant all on tables    to service_role;
alter default privileges in schema wisp grant all on sequences to service_role;
alter default privileges in schema wisp grant all on routines  to service_role;

-- Phase 1 sweeper (optional): enable pg_cron + pg_net in Dashboard → Database →
-- Extensions, set your deployed URL + WISP_SWEEP_SECRET, then schedule:
--
-- select cron.schedule('wisp-sweep', '*/5 * * * *', $$
--   select net.http_post(
--     url     := 'https://<your-app-host>/api/sweep',
--     headers := '{"Authorization": "Bearer <WISP_SWEEP_SECRET>"}'::jsonb
--   );
-- $$);
