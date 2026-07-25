-- Durable usage counters.
--
-- The OpenRouter spend guard previously lived in process memory, so it reset on every
-- deploy and restart. A cumulative ceiling that forgets its total is not a ceiling, so
-- the running total is kept here instead.
--
-- The same table backs an optional shared rate limiter. The service runs a single
-- replica today and its in-memory limiter is correct and faster for that, so the shared
-- backend is opt-in rather than the default.

create table public.usage_counters (
  scope text not null,
  key text not null,
  value numeric(20,10) not null default 0,
  expires_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (scope, key)
);

comment on table public.usage_counters is
  'Server-side counters for spend and rate limiting. Written only by the service role.';

-- Supports pruning expired rate-limit windows without scanning the whole table.
create index usage_counters_expires_at_idx
  on public.usage_counters (expires_at)
  where expires_at is not null;

-- No policies are defined on purpose. RLS is enabled so that the anon and authenticated
-- roles have no access at all; the service role bypasses RLS and is the only writer.
-- These counters are operational state, never user data.
alter table public.usage_counters enable row level security;

-- Adds to a cumulative counter and returns the new total. Atomic: concurrent workers
-- cannot lose an increment the way a read-modify-write would.
create or replace function public.add_usage_counter(
  p_scope text,
  p_key text,
  p_delta numeric
)
returns numeric
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_total numeric;
begin
  insert into public.usage_counters as c (scope, key, value, updated_at)
  values (p_scope, p_key, p_delta, now())
  on conflict (scope, key) do update
    set value = c.value + p_delta,
        updated_at = now()
  returning c.value into v_total;

  return v_total;
end;
$$;

-- Fixed-window rate limiter. The insert and the window roll happen in one statement, so
-- two requests arriving together cannot both observe a fresh window.
create or replace function public.hit_rate_limit(
  p_key text,
  p_window_ms integer,
  p_max integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_window interval := make_interval(secs => greatest(p_window_ms, 1000) / 1000.0);
  v_count numeric;
  v_reset timestamptz;
begin
  insert into public.usage_counters as c (scope, key, value, expires_at, updated_at)
  values ('rate_limit', p_key, 1, v_now + v_window, v_now)
  on conflict (scope, key) do update
    set value = case when c.expires_at is null or c.expires_at <= v_now then 1 else c.value + 1 end,
        expires_at = case when c.expires_at is null or c.expires_at <= v_now then v_now + v_window else c.expires_at end,
        updated_at = v_now
  returning c.value, c.expires_at into v_count, v_reset;

  return jsonb_build_object(
    'allowed', v_count <= p_max,
    'count', v_count,
    'reset_at', v_reset,
    'retry_after_seconds', greatest(1, ceil(extract(epoch from (v_reset - v_now))))
  );
end;
$$;

-- Reads a counter without modifying it, so the service can restore its running spend
-- total at startup.
create or replace function public.read_usage_counter(
  p_scope text,
  p_key text
)
returns numeric
language sql
security invoker
set search_path = ''
stable
as $$
  select coalesce(
    (select value from public.usage_counters where scope = p_scope and key = p_key),
    0
  );
$$;

-- Rate-limit rows are keyed by client, so the table is bounded by distinct clients
-- rather than by request volume. This clears windows that are long past.
create or replace function public.prune_usage_counters()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.usage_counters
  where expires_at is not null
    and expires_at < now() - interval '1 hour';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
