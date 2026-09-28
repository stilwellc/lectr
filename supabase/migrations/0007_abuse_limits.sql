-- 0007 · abuse limits on client-writable tables (idempotent).
-- RLS already confines every client write to the caller's own rows, but a
-- signed-in user (or a script holding their session) could still store
-- arbitrarily large values or millions of rows under their own user_id —
-- storage/egress abuse against a free-tier project. This file bounds both.
--
--   saved_lots            ≤ 1000 rows/user; text columns length-capped
--   saved_searches        ≤ 200 rows/user;  query ≤ 4 KB as text, name ≤ 200
--   collection_snapshots  ≤ 500 rows/user;  snap_date ≥ 2025-01-01 (CHECK)
--                          and ≤ today+1 (trigger); numbers non-negative and bounded.
--                          (0006's nightly purge keeps it at 400, so the cap
--                          only bites a client forging historical dates.)
--
-- CHECKs are added NOT VALID: existing rows are not re-checked (nothing live
-- is broken or blocks this file), every INSERT/UPDATE from now on is.
-- The row caps are BEFORE INSERT triggers. They let an upsert of an EXISTING
-- key through (the client's saved_lots / snapshot writes are upserts, which
-- fire BEFORE INSERT even when they resolve to an update), take a per-user
-- advisory lock so two concurrent inserts can't both squeeze past the cap,
-- and skip the service role (the nightly matchers write with the service key).
-- A capped insert fails with SQLSTATE 23514 (check_violation); the app
-- already surfaces write errors as "Couldn't save — try again."

-- ── length / range CHECKs ───────────────────────────────────────────────────
alter table public.saved_lots drop constraint if exists saved_lots_len_chk;
alter table public.saved_lots add constraint saved_lots_len_chk check (
      char_length(lot_id) <= 200
  and (saved_title  is null or char_length(saved_title)  <= 500)
  and (saved_artist is null or char_length(saved_artist) <= 200)
  and (note         is null or char_length(note)         <= 4000)
  and (paid_usd     is null or (paid_usd >= 0 and paid_usd < 1e12))
) not valid;

alter table public.saved_searches drop constraint if exists saved_searches_len_chk;
alter table public.saved_searches add constraint saved_searches_len_chk check (
      char_length(name) <= 200
  and octet_length(query::text) <= 4096
  and jsonb_typeof(query) = 'object'
) not valid;

alter table public.collection_snapshots drop constraint if exists collection_snapshots_range_chk;
alter table public.collection_snapshots add constraint collection_snapshots_range_chk check (
      snap_date >= date '2025-01-01'
  and (total_paid      is null or (total_paid      >= 0 and total_paid      < 1e12))
  and (total_appraised is null or (total_appraised >= 0 and total_appraised < 1e12))
  and (pieces          is null or (pieces          >= 0 and pieces          <= 100000))
) not valid;

-- ── per-user row caps ───────────────────────────────────────────────────────
create or replace function public.enforce_user_row_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cap int := tg_argv[0]::int;
  n   int;
begin
  -- the nightly matchers / sync write with the service key
  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext(tg_table_name || ':' || new.user_id::text));

  -- an upsert of a row that already exists resolves to an UPDATE — never capped
  if tg_table_name = 'saved_lots' then
    if exists (select 1 from public.saved_lots where user_id = new.user_id and lot_id = new.lot_id) then
      return new;
    end if;
    select count(*) into n from public.saved_lots where user_id = new.user_id;
  elsif tg_table_name = 'collection_snapshots' then
    -- the upper date bound lives here, not in the CHECK: current_date is not
    -- immutable, and a CHECK must be (dump/restore safety)
    if new.snap_date > current_date + 1 then
      raise exception 'lectr: snapshot date in the future' using errcode = 'check_violation';
    end if;
    if exists (select 1 from public.collection_snapshots where user_id = new.user_id and snap_date = new.snap_date) then
      return new;
    end if;
    select count(*) into n from public.collection_snapshots where user_id = new.user_id;
  elsif tg_table_name = 'saved_searches' then
    select count(*) into n from public.saved_searches where user_id = new.user_id;
  else
    return new;
  end if;

  if n >= cap then
    raise exception 'lectr: % limit reached (% per account)', tg_table_name, cap
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

revoke all on function public.enforce_user_row_cap() from public;
revoke all on function public.enforce_user_row_cap() from anon;
revoke all on function public.enforce_user_row_cap() from authenticated;

drop trigger if exists saved_lots_row_cap on public.saved_lots;
create trigger saved_lots_row_cap
  before insert on public.saved_lots
  for each row execute function public.enforce_user_row_cap('1000');

drop trigger if exists saved_searches_row_cap on public.saved_searches;
create trigger saved_searches_row_cap
  before insert on public.saved_searches
  for each row execute function public.enforce_user_row_cap('200');

drop trigger if exists collection_snapshots_row_cap on public.collection_snapshots;
create trigger collection_snapshots_row_cap
  before insert on public.collection_snapshots
  for each row execute function public.enforce_user_row_cap('500');
