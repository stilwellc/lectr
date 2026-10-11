-- 0009 · the growth loop (idempotent). REQUIRES 0008_return_loop.sql first.
--
--   track_event   the fixed vocabulary grows by the growth-loop verbs
--                 (app/lib/analytics.ts EVENTS — the two lists move together;
--                 app/lib/__tests__/analytics.test.ts fails if they drift).
--                 Still anonymous DAILY counts: (day, event) → n, nothing else.
--   push_log      a fourth kind, 'matches': one push per user per UTC day when
--                 the nightly matcher (scripts/match-alerts.ts) found new lots
--                 for their follows / saved searches. lot_id carries the day
--                 ('matches:YYYY-MM-DD') so the existing PK dedupes it.
--
-- NO EMAIL FEATURES: nothing here stores or derives an address.

-- ── 1 · the event vocabulary ────────────────────────────────────────────────
create or replace function public.track_event(p_event text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  -- a fixed vocabulary: anything else is dropped, so the table can never be
  -- used as a free-text store
  allowed constant text[] := array[
    'save_lot', 'unsave_lot', 'maxbid_view', 'outbound_house',
    'push_optin', 'pro_interest', 'calendar_add',
    'qs_start', 'qs_done', 'follow', 'unfollow', 'pick_more', 'pick_less',
    'pick_open', 'signin_click', 'save_search', 'profile_view'
  ];
  -- global ceilings (unchanged from 0008): spam-BOUNDED, never unbounded —
  -- at most one row per event per day
  per_minute constant int := 600;
  per_day    constant int := 20000;
  m  timestamptz := date_trunc('minute', now());
  used int;
begin
  if p_event is null or not (p_event = any(allowed)) then
    return;
  end if;

  insert into public.event_rate as r (minute, n) values (m, 1)
    on conflict (minute) do update set n = r.n + 1
    returning r.n into used;
  if used > per_minute then
    return;
  end if;

  insert into public.event_counts as c (day, event, n) values (current_date, p_event, 1)
    on conflict (day, event) do update set n = c.n + 1
    where c.n < per_day;

  if random() < 0.02 then
    delete from public.event_rate where minute < now() - interval '1 hour';
  end if;
end $$;

revoke all on function public.track_event(text) from public;
grant execute on function public.track_event(text) to anon, authenticated;

-- ── 2 · push_log learns the 'matches' kind ──────────────────────────────────
alter table public.push_log drop constraint if exists push_log_kind_check;
alter table public.push_log add constraint push_log_kind_check
  check (kind in ('close24', 'close1', 'hammer', 'matches'));
