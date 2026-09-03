-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ SUPERSEDED (Sep 2 2026) by supabase/migrations/0003_retention_loop.sql  ║
-- ║ (+ 0004 indexes/unique, 0005 drops emailed_at, 0006 the actual purge).  ║
-- ║ Kept as the historical record only — run the migrations/ files instead. ║
-- ║                                                                          ║
-- ║ NAMING NOTE: despite its name this file is a SCHEMA file for the         ║
-- ║ "retention loop" (saved searches → alerts). It contains NO retention     ║
-- ║ DELETES — no row was ever purged by it. Real data retention (seen        ║
-- ║ alerts > 90d, collection_snapshots capped at 400/user) lives in          ║
-- ║ migrations/0006_retention_purge.sql.                                     ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
-- lectr · retention-loop schema: saved searches, alerts, collection snapshots.
-- Run once in the Supabase SQL editor. These tables were live in prod before
-- this file existed; it was reconstructed for the GA audit from every code
-- read/write site (app/lib/alerts.ts, app/profile/page.tsx,
-- scripts/match-alerts.ts) so the enforced policies are auditable in-repo.
-- Prod RLS behavior verified 2026-07 by live anon probing: cross-user SELECT
-- returns empty, anon INSERT rejected 42501. Idempotent — safe to re-run.
--
-- Ownership model (same as saved-lots.sql): every row carries user_id, RLS
-- restricts all client access to auth.uid() = user_id. The nightly matcher
-- (scripts/match-alerts.ts) writes alert rows with the service key, which
-- bypasses RLS — clients only ever read/flip their own.

-- ── saved_searches — a stored FeedFilters slice; a "follow" when query.player
--    is set. The nightly stamps last_matched after each match pass.
create table if not exists public.saved_searches (
  id           uuid        not null default gen_random_uuid() primary key,
  user_id      uuid        not null references auth.users(id) on delete cascade,
  name         text        not null,
  query        jsonb       not null,
  created_at   timestamptz not null default now(),
  last_matched timestamptz
);

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
-- update covers markAllSeen — the client flips seen without an explicit
-- user filter, so this policy IS the scoping. No insert/delete policies:
-- only the service key writes rows; search deletion cascades.
create policy "alerts owner update" on public.alerts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- emailed_at — REMOVED. It was the email digest's dedupe marker; the digest
-- was deleted under the NO EMAIL FEATURES law and migrations/0005 drops the
-- column. The statement is kept commented so the historical record is honest:
--   alter table public.alerts add column if not exists emailed_at timestamptz;

-- ── collection_snapshots — one row per user per day (client upsert on
--    user_id,snap_date) powering the profile over-time chart.
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
