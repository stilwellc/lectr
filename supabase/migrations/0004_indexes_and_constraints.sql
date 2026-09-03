-- 0004 · indexes + the saved_searches uniqueness contract (idempotent).
--
-- Indexes match the exact client / nightly predicates:
--   alerts(user_id, seen)              — unseen HEAD-count (app/lib/alerts.ts) +
--                                        the retention purge (seen & old)
--   alerts(user_id, created_at desc)   — inbox page: newest 200 per user
--   saved_searches(user_id)            — every per-user read, the matcher's scan
--   lots(updated_at)                   — sync sweep (created in 0002; repeated
--                                        here so this file stands alone)
create index if not exists alerts_user_seen_idx        on public.alerts (user_id, seen);
create index if not exists alerts_user_created_idx     on public.alerts (user_id, created_at desc);
create index if not exists saved_searches_user_idx     on public.saved_searches (user_id);
create index if not exists lots_updated_at_idx         on public.lots (updated_at);

-- ── unique (user_id, query) on saved_searches ───────────────────────────────
-- The client used to enforce "already saved" by fetching every search and
-- comparing JSON strings (a race: two tabs / a double-tap saved twice). The
-- database now owns it; app/lib/alerts.ts save() treats a 23505 as 'exists'.
-- jsonb equality is order-insensitive, so {"a":1,"b":2} = {"b":2,"a":1}.
--
-- DEDUPE FIRST (a unique constraint won't build over existing duplicates):
-- keep the OLDEST search per (user_id, query), re-point the duplicates'
-- alerts at the survivor (dropping any that would collide on the alerts
-- (search_id, lot_id) uniqueness), then delete the duplicate searches.
do $$
begin
  create temp table _dupe_searches on commit drop as
    select s.id, s.user_id, s.query,
           first_value(s.id) over (partition by s.user_id, s.query order by s.created_at, s.id) as survivor
    from public.saved_searches s;
  delete from _dupe_searches where id = survivor;

  -- alerts that would collide with one the survivor already carries: drop
  delete from public.alerts a
  using _dupe_searches d
  where a.search_id = d.id
    and exists (select 1 from public.alerts b where b.search_id = d.survivor and b.lot_id = a.lot_id);

  -- the rest move to the survivor
  update public.alerts a
  set search_id = d.survivor
  from _dupe_searches d
  where a.search_id = d.id;

  delete from public.saved_searches s using _dupe_searches d where s.id = d.id;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'saved_searches_user_query_key' and conrelid = 'public.saved_searches'::regclass
  ) then
    alter table public.saved_searches
      add constraint saved_searches_user_query_key unique (user_id, query);
  end if;
end $$;
