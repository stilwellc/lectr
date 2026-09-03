-- 0001 · saved_lots — the per-user watchlist + collection (idempotent).
-- Consolidates supabase/saved-lots.sql + add-owned-column.sql +
-- add-costbasis-note.sql and adds the two columns the app has written since
-- Aug 2026 but that only ever existed in the live DB (saved_title /
-- saved_artist — written by app/lib/account.tsx entryToRow, read by
-- scripts/match-signal-alerts.ts for a rolled-off lot's market).
-- Every statement is re-runnable: create if not exists / add column if not
-- exists / drop-then-create policies.

create table if not exists public.saved_lots (
  user_id      uuid        not null references auth.users(id) on delete cascade,
  lot_id       text        not null,
  saved_at     timestamptz not null default now(),
  est_mid      numeric,          -- baseline estimate midpoint at save time
  signal_pct   numeric,          -- baseline signed signal at save time (+ = below)
  bid_count    integer,          -- baseline bid count at save time
  owned        boolean     not null default false,
  saved_title  text,             -- title snapshot — survives the lot rolling off the tape
  saved_artist text,             -- maker/player slug snapshot — market derivation fallback
  paid_usd     numeric,          -- what the collector actually paid (cost basis)
  note         text,             -- private free-text note on the piece
  primary key (user_id, lot_id)
);

alter table public.saved_lots add column if not exists owned        boolean not null default false;
alter table public.saved_lots add column if not exists saved_title  text;
alter table public.saved_lots add column if not exists saved_artist text;
alter table public.saved_lots add column if not exists paid_usd     numeric;
alter table public.saved_lots add column if not exists note         text;

alter table public.saved_lots enable row level security;

drop policy if exists "saved_lots owner select" on public.saved_lots;
drop policy if exists "saved_lots owner insert" on public.saved_lots;
drop policy if exists "saved_lots owner update" on public.saved_lots;
drop policy if exists "saved_lots owner delete" on public.saved_lots;

create policy "saved_lots owner select" on public.saved_lots
  for select using (auth.uid() = user_id);
create policy "saved_lots owner insert" on public.saved_lots
  for insert with check (auth.uid() = user_id);
create policy "saved_lots owner update" on public.saved_lots
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "saved_lots owner delete" on public.saved_lots
  for delete using (auth.uid() = user_id);
