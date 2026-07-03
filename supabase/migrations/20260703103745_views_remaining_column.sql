-- Promote the live view counter out of the policy JSONB into a real column.
-- Previously consume_view() mutated policy->>'maxViews' in place with jsonb_set,
-- burying a live, mutable counter inside the immutable config document. Now
-- policy.maxViews is the CONFIGURED maximum (never mutated) and
-- shares.views_remaining is the live per-share counter (anonymous shares).
-- Per-recipient counters already live in recipients.views_remaining.

set search_path = wisp;

alter table shares add column if not exists views_remaining int;

-- Backfill the live counter from the (currently-mutated) policy value for
-- existing anonymous parents; null policy.maxViews stays null (unlimited).
update shares
   set views_remaining = (policy ->> 'maxViews')::int
 where parent_share_id is null
   and policy is not null
   and policy ->> 'maxViews' is not null;

-- Decrement the column, not the JSON. Returns the remaining count, or no row
-- when denied (exhausted / expired). null views_remaining = unlimited and is
-- never decremented here (anonymous shares with a limit always have a value).
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
