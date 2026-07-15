-- lectr · saved-lots schema. Run once in the Supabase SQL editor.
-- Saved lots are scoped per user by row-level security: a signed-in user can
-- only ever read/write their own rows. No server code trusts the client — the
-- database enforces ownership.

create table if not exists public.saved_lots (
  user_id    uuid        not null references auth.users(id) on delete cascade,
  lot_id     text        not null,
  saved_at   timestamptz not null default now(),
  est_mid    numeric,          -- baseline estimate midpoint at save time
  signal_pct numeric,          -- baseline under/over signal at save time
  bid_count  integer,          -- baseline bid count at save time
  primary key (user_id, lot_id)
);

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
