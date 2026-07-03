-- Review hardening.

set search_path = wisp;

-- Atomic OTP attempt claim. The 5-attempt cap is enforced in the OUTER WHERE,
-- evaluated after the target row is locked, so concurrent /access requests
-- cannot each read a stale `attempts` and collectively exceed the cap (the
-- previous read-then-update was a TOCTOU that let a burst bypass the limit and
-- brute-force the 6-digit code). Returns the code hash of the newest live code
-- for constant-time comparison in the route, or no row when capped/expired.
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

-- The 'My shares' dashboard filters by owner_user_id; index it.
create index if not exists shares_owner_user_id_idx
  on shares (owner_user_id)
  where owner_user_id is not null;
