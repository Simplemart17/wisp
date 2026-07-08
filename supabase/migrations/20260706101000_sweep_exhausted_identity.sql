-- Sweep coverage for exhausted identity shares. The PostgREST-side sweep
-- query could only express "expired OR views_remaining = 0", which reclaims
-- anonymous shares on exhaustion but left identity shares (per-recipient
-- counters) holding their ciphertext until expiry — up to 30 days after the
-- last permitted view. This RPC owns the full sweepability predicate: a
-- parent is sweepable when expired, exhausted (anonymous), or when every
-- recipient link is revoked or out of views.

set search_path = wisp;

create or replace function find_sweepable_shares()
returns table (id text, ciphertext_ref text) language sql
set search_path = wisp as $$
  select s.id, s.ciphertext_ref
    from shares s
   where s.parent_share_id is null
     and (
       (s.expires_at is not null and s.expires_at <= now())
       or s.views_remaining = 0
       or (
         (s.policy->>'requireIdentity')::boolean
         and exists (select 1 from recipients r where r.share_id = s.id)
         and not exists (
           select 1
             from recipients r
            where r.share_id = s.id
              and not r.revoked
              and (r.views_remaining is null or r.views_remaining > 0)
         )
       )
     )
   limit 500;
$$;
