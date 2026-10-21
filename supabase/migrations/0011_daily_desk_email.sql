-- The Daily Desk email (Oct 21 2026) — reverses the "no email features" law
-- at the owner's request: an OPT-IN morning email of the reader's own desk
-- (their watches closing, their results, picks from their follows).
--
--   email_prefs                 one row per user; daily = false until the
--                               reader turns it on in Account. unsub_token is
--                               the email's one-click unsubscribe key.
--   email_daily_recipients()    service-role only: who gets today's email,
--                               with the address from auth.users.
--   email_unsubscribe(token)    anon-callable: flips daily off for the row
--                               holding that token (the email's link / the
--                               List-Unsubscribe one-click POST). Knowing a
--                               token only ever turns email OFF.
-- Additive + idempotent — run once in the Supabase SQL editor.

create table if not exists public.email_prefs (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  daily        boolean not null default false,
  unsub_token  uuid not null default gen_random_uuid() unique,
  last_sent_on date,
  updated_at   timestamptz not null default now()
);

alter table public.email_prefs enable row level security;
drop policy if exists "email_prefs owner select" on public.email_prefs;
create policy "email_prefs owner select" on public.email_prefs for select using (auth.uid() = user_id);
drop policy if exists "email_prefs owner insert" on public.email_prefs;
create policy "email_prefs owner insert" on public.email_prefs for insert with check (auth.uid() = user_id);
drop policy if exists "email_prefs owner update" on public.email_prefs;
create policy "email_prefs owner update" on public.email_prefs for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.email_daily_recipients()
returns table (user_id uuid, email text, unsub_token uuid, last_sent_on date)
language sql security definer set search_path = public, auth as $$
  select p.user_id, u.email::text, p.unsub_token, p.last_sent_on
  from public.email_prefs p join auth.users u on u.id = p.user_id
  where p.daily and u.email is not null and u.email_confirmed_at is not null;
$$;
revoke all on function public.email_daily_recipients() from public, anon, authenticated;
grant execute on function public.email_daily_recipients() to service_role;

create or replace function public.email_unsubscribe(token uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.email_prefs set daily = false, updated_at = now() where unsub_token = token and daily;
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke all on function public.email_unsubscribe(uuid) from public;
grant execute on function public.email_unsubscribe(uuid) to anon, authenticated, service_role;
