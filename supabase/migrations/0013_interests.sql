-- Quick-start interests on the account (Oct 29 2026): the markets a reader
-- picked and the price range they stated lived on the DEVICE only
-- (localStorage `lectr-interests`), so a signed-in reader's picks differed by
-- device and the Daily Desk could not see their markets or range.
--
--   user_interests   one row per user: markets (the quick start's market
--                    keys), min_usd / max_usd (the stated range, hammer-basis
--                    USD; either side null = open), updated_at.
--
-- The client (app/lib/account) lifts the device's interests into the account
-- the first time a signed-in reader has none, then the account is the source
-- and the device mirrors it (write-through on change). The Daily Desk runner
-- (scripts/daily-desk-send, service role) reads it beside saved_searches.
-- Additive + idempotent — run once in the Supabase SQL editor. The client
-- tolerates its absence (session-only with a toast, as the other columns do).

create table if not exists public.user_interests (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  markets     text[] not null default '{}',
  min_usd     numeric,
  max_usd     numeric,
  updated_at  timestamptz not null default now()
);

alter table public.user_interests enable row level security;
drop policy if exists "user_interests owner select" on public.user_interests;
create policy "user_interests owner select" on public.user_interests for select using (auth.uid() = user_id);
drop policy if exists "user_interests owner insert" on public.user_interests;
create policy "user_interests owner insert" on public.user_interests for insert with check (auth.uid() = user_id);
drop policy if exists "user_interests owner update" on public.user_interests;
create policy "user_interests owner update" on public.user_interests for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "user_interests owner delete" on public.user_interests;
create policy "user_interests owner delete" on public.user_interests for delete using (auth.uid() = user_id);
