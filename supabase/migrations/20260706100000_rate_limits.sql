-- Durable rate limiting (SPEC §10). The previous limiter was an in-process
-- Map: counters vanished on every container restart and would silently
-- multiply across instances. This moves the counter into Postgres — one
-- atomic upsert per checked request, shared by every process.
--
-- Privacy: keys arrive as salted hashes of "scope:client-ip" (see
-- src/lib/server/ratelimit.ts) — raw IPs never reach this table, matching
-- the access_log's hashed-IP policy.

set search_path = wisp;

create table if not exists rate_limits (
  key          text primary key,          -- salted hash, never a raw IP
  window_start timestamptz not null,
  count        int not null default 0
);

-- Stale windows are garbage-collected by the sweeper.
create index if not exists rate_limits_window_start_idx on rate_limits (window_start);

-- Fixed-window counter, atomic under concurrency (the ON CONFLICT row lock
-- serializes racing requests). Returns true while the window still has
-- budget. Fixed windows admit up to 2x max across one boundary — an accepted
-- trade for a single-statement counter.
create or replace function consume_rate_limit(p_key text, p_max int, p_window_ms bigint)
returns boolean language sql
set search_path = wisp as $$
  insert into rate_limits as rl (key, window_start, count)
  values (p_key, now(), 1)
  on conflict (key) do update
     set count        = case when rl.window_start <= now() - make_interval(secs => p_window_ms / 1000.0)
                             then 1 else rl.count + 1 end,
         window_start = case when rl.window_start <= now() - make_interval(secs => p_window_ms / 1000.0)
                             then now() else rl.window_start end
  returning count <= p_max;
$$;
