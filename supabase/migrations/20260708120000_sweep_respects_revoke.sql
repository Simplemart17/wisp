-- Review fix: the identity-exhaustion clause treated "every recipient revoked
-- OR out of views" as sweepable, so revoking the last recipient hard-deleted
-- the parent share, ciphertext, and audit trail within one sweep cycle —
-- contradicting the per-recipient revoke contract (the parent, blob, and
-- audit deliberately stay; only the child link dies).
--
-- New rule: an identity share is reclaimed on exhaustion only when EVERY
-- recipient's counter is spent (views_remaining = 0), regardless of revoked
-- state. A revoked-but-unused link keeps the share (and its audit history)
-- alive until expiry, exactly like before the sweeper reclaimed identity
-- shares at all. Content stays unreachable either way — revoked links 404.

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
              and (r.views_remaining is null or r.views_remaining > 0)
         )
       )
     )
   limit 500;
$$;
