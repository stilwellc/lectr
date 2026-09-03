-- 0003 · retention-loop schema: saved_searches, alerts, collection_snapshots
-- (idempotent). Supersedes supabase/retention.sql MINUS the alerts.emailed_at
-- column, which belonged to the deleted email digest (NO EMAIL FEATURES —
-- standing law; 0005 drops it where it exists).
--
-- Ownership model (same as saved_lots): every row carries user_id, RLS
-- restricts all client access to auth.uid() = user_id. The nightly matchers
-- (scripts/match-alerts.ts, scripts/match-signal-alerts.ts) write alert rows
-- with the service key, which bypasses RLS — clients only read / flip seen.

-- ── saved_searches — a stored FeedFilters slice; a "follow" when query.player
--    is set; a per-user SYNTHETIC search when query._signal is set (signal
--    alerts hang under it). The nightly stamps last_matched after each pass.
create table if not exists public.saved_searches (
  id           uuid        not null default gen_random_uuid() primary key,
  user_id      uuid        not null references auth.users(id) on delete cascade,
  name         text        not null,
  query        jsonb       not null,
  created_at   timestamptz not null default now(),
  last_matched timestamptz
);
alter table public.saved_searches add column if not exists last_matched timestamptz;

alter table public.saved_searches enable row level security;

drop policy if exists "saved_searches owner select" on public.saved_searches;
drop policy if exists "saved_searches owner insert" on public.saved_searches;
drop policy if exists "saved_searches owner delete" on public.saved_searches;

create policy "saved_searches owner select" on public.saved_searches
  for select using (auth.uid() = user_id);
create policy "saved_searches owner insert" on public.saved_searches
  for insert with check (auth.uid() = user_id);
create policy "saved_searches owner delete" on public.saved_searches
  for delete using (auth.uid() = user_id);

-- ── alerts — one row per (search, lot) match, written nightly by the service
--    key. Clients read and mark seen; they never insert.
create table if not exists public.alerts (
  id         bigint      generated always as identity primary key,
  user_id    uuid        not null references auth.users(id) on delete cascade,
  search_id  uuid        not null references public.saved_searches(id) on delete cascade,
  lot_id     text        not null,
  created_at timestamptz not null default now(),
  seen       boolean     not null default false,
  unique (search_id, lot_id)
);

alter table public.alerts enable row level security;

drop policy if exists "alerts owner select" on public.alerts;
drop policy if exists "alerts owner update" on public.alerts;

create policy "alerts owner select" on public.alerts
  for select using (auth.uid() = user_id);
-- update covers markAllSeen (the client flips seen). No insert/delete
-- policies: only the service key writes rows; search deletion cascades.
create policy "alerts owner update" on public.alerts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── collection_snapshots — one row per user per day (client upsert on
--    user_id,snap_date — app/lib/snapshots.ts) powering the profile chart.
create table if not exists public.collection_snapshots (
  user_id         uuid        not null references auth.users(id) on delete cascade,
  snap_date       date        not null,
  total_paid      numeric,
  total_appraised numeric,
  pieces          integer,
  primary key (user_id, snap_date)
);

alter table public.collection_snapshots enable row level security;

drop policy if exists "collection_snapshots owner select" on public.collection_snapshots;
drop policy if exists "collection_snapshots owner insert" on public.collection_snapshots;
drop policy if exists "collection_snapshots owner update" on public.collection_snapshots;

create policy "collection_snapshots owner select" on public.collection_snapshots
  for select using (auth.uid() = user_id);
create policy "collection_snapshots owner insert" on public.collection_snapshots
  for insert with check (auth.uid() = user_id);
-- upsert's conflict path needs update
create policy "collection_snapshots owner update" on public.collection_snapshots
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
