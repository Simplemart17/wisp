-- Wisp schema (SPEC §7) — squashed 2026-07-03 from the seven Phase 0–3
-- migrations into one baseline describing the final state. On a hosted
-- project, add "wisp" to Exposed schemas: Dashboard → Settings → API.

create schema if not exists wisp;
set search_path = wisp;

-- One row per share; per-recipient links (identity shares, SPEC §5) are child
-- rows that reference their parent for content instead of duplicating the
-- ciphertext ref / wrapped key / metadata / policy — a policy edit is one row
-- update. Content columns are null for children; the CHECK forces parents to
-- carry the payload.
create table if not exists shares (
  id                    text primary key,           -- opaque, URL-safe, high-entropy
  ciphertext_ref        text,                       -- path in private Storage bucket (parents)
  wrapped_cek           bytea,                      -- null when no password
  kdf_salt              bytea,
  kdf_params            jsonb,                      -- argon2id params
  encrypted_metadata    bytea,                      -- filename/size/type, encrypted (parents)
  policy                jsonb,                      -- CONFIGURED policy; never mutated
  management_token_hash text,                       -- hash of sender's mgmt secret (parents)
  parent_share_id       text references shares(id) on delete cascade,
  owner_user_id         text,                       -- Clerk user id; null for anonymous senders
  created_at            timestamptz not null default now(),
  expires_at            timestamptz,
  -- Live per-share view counter (anonymous shares); null = unlimited.
  -- policy->>'maxViews' stays the configured maximum, this column is the state.
  views_remaining       int,
  constraint shares_parent_or_content check (
    parent_share_id is not null
    or (
      ciphertext_ref is not null
      and encrypted_metadata is not null
      and policy is not null
      and management_token_hash is not null
    )
  )
);

-- Only when policy.requireIdentity is true.
create table if not exists recipients (
  id                     uuid primary key default gen_random_uuid(),
  share_id               text not null references shares(id) on delete cascade,
  email_hash             text not null,             -- store hash, not raw email
  link_id                text not null unique,      -- the per-recipient share id
  views_remaining        int,                       -- null = unlimited
  verified_at            timestamptz,
  revoked                boolean not null default false,
  -- Masked display label (e.g. "j***@example.com") so the sender's manage page
  -- stays readable without storing the raw address (email_hash is the identity).
  email_hint             text,
  -- Single-use signing ticket, minted by /access after the OTP gate passes and
  -- presented to /sign. Stored hashed; cleared on use.
  sign_ticket_hash       text,
  sign_ticket_expires_at timestamptz
);

-- Metadata-only audit; never content.
create table if not exists access_log (
  id           bigserial primary key,
  share_id     text not null references shares(id) on delete cascade,
  recipient_id uuid references recipients(id),
  ts           timestamptz not null default now(),
  ip_hash      text,                                -- hashed, not raw IP
  user_agent   text,
  action       text not null,                       -- view | download | otp_fail | revoke
  result       text not null                        -- allowed | denied | expired | exhausted
);

-- Custom recipient OTP: hashed codes, short-lived, attempt-capped.
create table if not exists otp_codes (
  id           uuid primary key default gen_random_uuid(),
  share_id     text not null references shares(id) on delete cascade,
  email_hash   text not null,
  code_hash    text not null,                       -- hash of the 6-digit code
  expires_at   timestamptz not null,
  attempts     int not null default 0,              -- cap to blunt brute force
  consumed     boolean not null default false
);

-- Abuse reporting (SPEC §10, §13). Content is unscannable by design
-- (zero-knowledge), so mitigation is user reporting + rate limits.
create table if not exists reports (
  id         bigserial primary key,
  share_id   text,                 -- loose reference; the share may be deleted later
  reason     text not null,        -- illegal | malware | phishing | other
  details    text,
  ip_hash    text,
  created_at timestamptz not null default now()
);

-- Zero-knowledge e-signatures: the envelope (doc hash, ephemeral ECDSA public
-- key, signature, typed name) is encrypted client-side under an HKDF subkey of
-- the share's CEK — the server attests WHO signed (OTP-verified recipient) and
-- WHEN, but can never read WHAT was signed, not even the document's hash.
create table if not exists signatures (
  id                 uuid primary key default gen_random_uuid(),
  share_id           text not null references shares(id) on delete cascade, -- parent share
  recipient_id       uuid not null references recipients(id) on delete cascade,
  encrypted_envelope bytea not null,                -- sealed client-side; opaque to the server
  ip_hash            text,
  created_at         timestamptz not null default now(),
  unique (recipient_id)                             -- one signature per recipient link
);

-- Operational indexes for the access paths.
create index if not exists recipients_share_id_idx   on recipients (share_id);
create index if not exists otp_codes_share_email_idx on otp_codes (share_id, email_hash);
create index if not exists access_log_share_id_idx   on access_log (share_id);
create index if not exists shares_expires_at_idx     on shares (expires_at);
create index if not exists shares_parent_idx         on shares (parent_share_id);
create index if not exists signatures_share_id_idx   on signatures (share_id);
-- The 'My shares' dashboard filters by owner_user_id.
create index if not exists shares_owner_user_id_idx
  on shares (owner_user_id)
  where owner_user_id is not null;

-- Atomic burn-after-read: decrement only if views remain, in one statement.
-- Returns the remaining count, or no row when denied (exhausted/expired).
-- null views_remaining = unlimited and is never decremented here.
create or replace function consume_view(p_share_id text)
returns int language sql
set search_path = wisp as $$
  update shares s
     set views_remaining = s.views_remaining - 1
   where s.id = p_share_id
     and s.views_remaining > 0
     and (s.expires_at is null or s.expires_at > now())
  returning s.views_remaining;
$$;

-- Atomic per-recipient burn: NULL views = unlimited (returns -1 so callers can
-- distinguish "allowed, unlimited" from "no row = denied").
create or replace function consume_recipient_view(p_link_id text)
returns int language sql
set search_path = wisp as $$
  update recipients r
     set views_remaining = case when r.views_remaining is null
                                then null else r.views_remaining - 1 end
   where r.link_id = p_link_id
     and not r.revoked
     and (r.views_remaining is null or r.views_remaining > 0)
  returning coalesce(r.views_remaining, -1);
$$;

-- Atomic OTP attempt claim. The 5-attempt cap is enforced in the OUTER WHERE,
-- evaluated after the target row is locked, so concurrent /access requests
-- cannot each read a stale `attempts` and collectively exceed the cap (a
-- read-then-update here would be a TOCTOU that lets a burst bypass the limit
-- and brute-force the 6-digit code). Returns the code hash of the newest live
-- code for constant-time comparison in the route, or no row when capped/expired.
create or replace function claim_otp_attempt(p_share_id text, p_email_hash text)
returns table (id uuid, code_hash text)
language sql
set search_path = wisp as $$
  update otp_codes o
     set attempts = attempts + 1
   where o.id = (
           select c.id
             from otp_codes c
            where c.share_id = p_share_id
              and c.email_hash = p_email_hash
              and not c.consumed
              and c.expires_at > now()
            order by c.expires_at desc
            limit 1
         )
     and o.attempts < 5
  returning o.id, o.code_hash;
$$;

-- Defense-in-depth: RLS on (service_role bypasses it; nothing else has grants).
alter table shares     enable row level security;
alter table recipients enable row level security;
alter table access_log enable row level security;
alter table otp_codes  enable row level security;
alter table reports    enable row level security;
alter table signatures enable row level security;

-- Lock table access to the service_role role ONLY. Clients never touch the
-- DB directly — all access is mediated by Next.js Route Handlers using the
-- secret key (sb_secret_…), which runs as service_role. anon/authenticated
-- (i.e. anything reachable with a publishable key) deliberately get no grants.
grant usage on schema wisp                          to service_role;
grant all on all tables    in schema wisp           to service_role;
grant all on all routines  in schema wisp           to service_role;
grant all on all sequences in schema wisp           to service_role;
alter default privileges in schema wisp grant all on tables    to service_role;
alter default privileges in schema wisp grant all on sequences to service_role;
alter default privileges in schema wisp grant all on routines  to service_role;

-- Private ciphertext bucket. No storage policies on purpose: storage RLS
-- denies anon/authenticated by default, and the server's secret key (service
-- role) bypasses it — same trust model as the wisp schema above.
insert into storage.buckets (id, name, public)
values ('wisp', 'wisp', false)
on conflict (id) do nothing;

-- Sweeper (optional): run ONCE against the deployed project's SQL editor —
-- NOT part of this migration, because pg_cron/pg_net only exist where the
-- extensions are enabled (Dashboard → Database → Extensions) and the bearer
-- secret must never be committed. With the real WISP_SWEEP_SECRET inlined:
--
-- select cron.schedule('wisp-sweep', '*/5 * * * *', $$
--   select net.http_post(
--     url     := 'https://wisp.targaet.app/api/sweep',
--     headers := '{"Authorization": "Bearer <WISP_SWEEP_SECRET>"}'::jsonb
--   );
-- $$);
