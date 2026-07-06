-- Post-create share edits (SPEC §8 management surface): extend expiry and
-- top up view counters without re-encrypting and re-sending a fresh link.
-- Expiry is an absolute-value column update (PostgREST can express that);
-- counter bumps are relative, so each is one atomic RPC. Unlimited (null)
-- counters are never modified — "no row" tells the caller there was nothing
-- to add to.

set search_path = wisp;

create or replace function add_share_views(p_share_id text, p_n int)
returns int language sql
set search_path = wisp as $$
  update shares s
     set views_remaining = s.views_remaining + p_n
   where s.id = p_share_id
     and s.parent_share_id is null
     and s.views_remaining is not null
  returning s.views_remaining;
$$;

-- share_id is checked alongside link_id so a management token for one share
-- can never bump a recipient link belonging to another.
create or replace function add_recipient_views(p_share_id text, p_link_id text, p_n int)
returns int language sql
set search_path = wisp as $$
  update recipients r
     set views_remaining = r.views_remaining + p_n
   where r.share_id = p_share_id
     and r.link_id = p_link_id
     and not r.revoked
     and r.views_remaining is not null
  returning r.views_remaining;
$$;
