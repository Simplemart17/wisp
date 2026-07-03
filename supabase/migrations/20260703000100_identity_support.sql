-- Phase 2: recipient identity (SPEC §5) — per-recipient links, OTP gating,
-- and the operational indexes the access paths need.

set search_path = wisp;

-- Children (per-recipient share rows) must not block parent deletion.
alter table shares drop constraint shares_parent_share_id_fkey;
alter table shares
  add constraint shares_parent_share_id_fkey
  foreign key (parent_share_id) references shares(id) on delete cascade;

-- Unlimited per-recipient views are represented as NULL.
alter table recipients alter column views_remaining drop not null;

-- Masked display label (e.g. "j***@example.com") so the sender's manage page
-- stays readable without storing the raw address (email_hash is the identity).
alter table recipients add column if not exists email_hint text;

create index if not exists recipients_share_id_idx on recipients (share_id);
create index if not exists otp_codes_share_email_idx on otp_codes (share_id, email_hash);
create index if not exists access_log_share_id_idx on access_log (share_id);
create index if not exists shares_expires_at_idx on shares (expires_at);
create index if not exists shares_parent_idx on shares (parent_share_id);

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
