-- 0008 · the return loop + instrumentation (idempotent).
-- docs/RETENTION.md is the companion: the north-star metric, the event list,
-- and what stays inert until keys exist.
--
--   event_counts          anonymous DAILY counts of six product events. No
--                         user id, no IP, no session, no device — just
--                         (day, event) → n. Written ONLY through track_event().
--   event_rate            the per-minute global bucket that rate-limits
--                         track_event (same no-identity shape).
--   push_subscriptions    Web Push endpoints, owned by the signed-in user;
--                         registered/removed through two RPCs; ≤ 10 per user.
--   push_log              service-only dedupe ledger: one row per
--                         (user, lot, kind) ever sent — kind ∈ close24, close1,
--                         hammer. scripts/push-send.ts writes it.
--   push_lot_snap         service-only: the engine's forecast for a WATCHED lot
--                         while it was live (sync-lots-db nulls `value` on
--                         settle, so the hammer push needs its own copy).
--   pro_interest          the Pro fake-door: one row per user, optional price
--                         point $10 / $20 / $40. No email column, ever.
--   north_star_weekly     view (service-only): watched lots reaching the
--                         hammer per ISO week.
--
-- NO EMAIL FEATURES: nothing here stores or derives an address.

-- ── 1 · anonymous event counts ──────────────────────────────────────────────
create table if not exists public.event_counts (
  day   date   not null,
  event text   not null,
  n     bigint not null default 0,
  primary key (day, event)
);
alter table public.event_counts enable row level security;
-- no policies: anon/authenticated can neither read nor write the table
-- directly; track_event() (security definer) is the only door in.

create table if not exists public.event_rate (
  minute timestamptz not null primary key,
  n      int         not null default 0
);
alter table public.event_rate enable row level security;

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
    'push_optin', 'pro_interest', 'calendar_add'
  ];
  -- global ceilings. Counts are spam-BOUNDED, not spam-proof: a script can
  -- inflate them up to these caps (documented in docs/RETENTION.md), but it
  -- can never grow the table — at most 7 rows a day.
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

  -- the rate buckets are only useful for a minute; keep the table tiny
  if random() < 0.02 then
    delete from public.event_rate where minute < now() - interval '1 hour';
  end if;
end $$;

revoke all on function public.track_event(text) from public;
grant execute on function public.track_event(text) to anon, authenticated;

-- ── 2 · Web Push subscriptions ──────────────────────────────────────────────
create table if not exists public.push_subscriptions (
  id         bigint      generated always as identity primary key,
  user_id    uuid        not null references auth.users(id) on delete cascade,
  endpoint   text        not null unique,
  p256dh     text        not null,
  auth       text        not null,
  created_at timestamptz not null default now(),
  last_ok_at timestamptz,
  fail_count int         not null default 0
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions drop constraint if exists push_subscriptions_len_chk;
alter table public.push_subscriptions add constraint push_subscriptions_len_chk check (
      endpoint like 'https://%'
  and char_length(endpoint) <= 1024
  and char_length(p256dh) between 20 and 200
  and char_length(auth)   between 8 and 100
  and fail_count between 0 and 1000
) not valid;

alter table public.push_subscriptions enable row level security;

drop policy if exists "push_subscriptions owner select" on public.push_subscriptions;
drop policy if exists "push_subscriptions owner delete" on public.push_subscriptions;
create policy "push_subscriptions owner select" on public.push_subscriptions
  for select using (auth.uid() = user_id);
create policy "push_subscriptions owner delete" on public.push_subscriptions
  for delete using (auth.uid() = user_id);
-- no insert/update policy: writes go through register_push_subscription(),
-- which can hand an endpoint over from a previous account on the same browser
-- (the unique endpoint would otherwise be invisible-yet-conflicting under RLS)

-- row cap, same pattern as 0007 (advisory lock, service key exempt)
create or replace function public.enforce_push_sub_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('push_subscriptions:' || new.user_id::text));
  select count(*) into n from public.push_subscriptions where user_id = new.user_id;
  if n >= 10 then
    raise exception 'lectr: push_subscriptions limit reached (10 per account)'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke all on function public.enforce_push_sub_cap() from public, anon, authenticated;

drop trigger if exists push_subscriptions_row_cap on public.push_subscriptions;
create trigger push_subscriptions_row_cap
  before insert on public.push_subscriptions
  for each row execute function public.enforce_push_sub_cap();

create or replace function public.register_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'lectr: sign in to turn on notifications' using errcode = '42501';
  end if;
  -- the endpoint is an unguessable capability the caller's browser holds; a
  -- re-registration (same browser, maybe a different account) replaces it
  delete from public.push_subscriptions where endpoint = p_endpoint;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
    values (uid, p_endpoint, p_p256dh, p_auth);
end $$;
revoke all on function public.register_push_subscription(text, text, text) from public, anon;
grant execute on function public.register_push_subscription(text, text, text) to authenticated;

create or replace function public.unregister_push_subscription(p_endpoint text)
returns void
language sql
security invoker
set search_path = public
as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
$$;
revoke all on function public.unregister_push_subscription(text) from public, anon;
grant execute on function public.unregister_push_subscription(text) to authenticated;

-- ── 3 · push dedupe ledger + forecast snapshots (service key only) ──────────
create table if not exists public.push_log (
  user_id uuid        not null references auth.users(id) on delete cascade,
  lot_id  text        not null,
  kind    text        not null check (kind in ('close24', 'close1', 'hammer')),
  sent_at timestamptz not null default now(),
  primary key (user_id, lot_id, kind)
);
create index if not exists push_log_sent_at_idx on public.push_log (sent_at);
alter table public.push_log enable row level security;
-- no policies: the client never sees or writes the ledger

create table if not exists public.push_lot_snap (
  lot_id       text        primary key,
  forecast_usd numeric     check (forecast_usd is null or (forecast_usd >= 0 and forecast_usd < 1e12)),
  closes_at    timestamptz,
  title        text        check (title is null or char_length(title) <= 500),
  updated_at   timestamptz not null default now()
);
alter table public.push_lot_snap enable row level security;

-- ── 4 · Pro fake-door interest ──────────────────────────────────────────────
create table if not exists public.pro_interest (
  user_id     uuid        not null primary key references auth.users(id) on delete cascade,
  price_point int         check (price_point is null or price_point in (10, 20, 40)),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.pro_interest enable row level security;

drop policy if exists "pro_interest owner select" on public.pro_interest;
drop policy if exists "pro_interest owner insert" on public.pro_interest;
drop policy if exists "pro_interest owner update" on public.pro_interest;
drop policy if exists "pro_interest owner delete" on public.pro_interest;
create policy "pro_interest owner select" on public.pro_interest
  for select using (auth.uid() = user_id);
create policy "pro_interest owner insert" on public.pro_interest
  for insert with check (auth.uid() = user_id);
-- upsert's conflict path needs update (changing the price point)
create policy "pro_interest owner update" on public.pro_interest
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "pro_interest owner delete" on public.pro_interest
  for delete using (auth.uid() = user_id);

-- ── 5 · the north star: watched lots reaching the hammer, per week ──────────
-- A WATCH = a saved_lots row (owned or not) saved BEFORE its sale day ended.
-- REACHING THE HAMMER = the lot's settled row in public.lots says it SOLD with
-- a price. Lot ids can carry a trailing '~' alias (sync-lots-db), so the join
-- trims it on both sides. Weeks are ISO weeks (Monday start, UTC).
-- Caveats (docs/RETENTION.md): an unsave after the hammer removes the watch
-- from history; public.lots keeps 24 months, so older weeks thin out.
create or replace view public.north_star_weekly
with (security_invoker = true)
as
select
  date_trunc('week', l.sale_date)::date              as week,
  count(*)                                           as watched_lots_hammered,
  count(distinct s.user_id)                          as watchers,
  count(*) filter (where s.owned)                    as of_which_owned
from public.saved_lots s
join public.lots l
  on rtrim(l.id, '~') = rtrim(s.lot_id, '~')
where l.status = 'sold'
  and coalesce(l.price_usd, 0) > 0
  and l.sale_date is not null
  and s.saved_at < (l.sale_date + 1)::timestamptz
group by 1;

-- security_invoker: a client querying it would only ever see its own saves
-- (RLS on saved_lots) — but it is an ops number, so revoke it outright
revoke all on public.north_star_weekly from public, anon, authenticated;
grant select on public.north_star_weekly to service_role;
