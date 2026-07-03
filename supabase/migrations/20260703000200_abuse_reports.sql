-- Phase 3: abuse reporting (SPEC §10, §13). Content is unscannable by design
-- (zero-knowledge), so mitigation is user reporting + rate limits.

set search_path = wisp;

create table if not exists reports (
  id         bigserial primary key,
  share_id   text,                -- loose reference; the share may be deleted later
  reason     text not null,       -- illegal | malware | phishing | other
  details    text,
  ip_hash    text,
  created_at timestamptz not null default now()
);

alter table reports enable row level security;
