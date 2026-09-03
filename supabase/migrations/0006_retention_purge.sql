-- 0006 · REAL retention: the purge function + its nightly schedule (idempotent).
-- Before this file nothing in the repo ever DELETED a retention-loop row —
-- supabase/retention.sql is a SCHEMA file despite its name. Contract:
--   alerts               — a SEEN alert older than 90 days is gone. Unseen
--                          alerts are never purged (the inbox badge is honest).
--   collection_snapshots — at most 400 per user (the profile chart reads the
--                          most recent 180; 400 ≈ 13 months of daily rows).
-- The function runs as the table owner (security definer) and is NOT
-- callable by anon/authenticated — only the service key (RPC) or pg_cron.
create or replace function public.retention_purge()
returns table (alerts_deleted bigint, snapshots_deleted bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  a bigint := 0;
  s bigint := 0;
begin
  delete from public.alerts
   where seen
     and created_at < now() - interval '90 days';
  get diagnostics a = row_count;

  delete from public.collection_snapshots cs
   using (
     select user_id, snap_date,
            row_number() over (partition by user_id order by snap_date desc) as rn
       from public.collection_snapshots
   ) r
   where cs.user_id = r.user_id
     and cs.snap_date = r.snap_date
     and r.rn > 400;
  get diagnostics s = row_count;

  return query select a, s;
end $$;

revoke all on function public.retention_purge() from public;
revoke all on function public.retention_purge() from anon;
revoke all on function public.retention_purge() from authenticated;
grant execute on function public.retention_purge() to service_role;

-- Schedule: pg_cron at 07:20 UTC daily (after the 06:00 nightly's sync job).
-- Supabase ships pg_cron; enable it once under Database → Extensions. Where
-- the extension is absent this block only NOTICEs — then run the purge from
-- the nightly instead (service key):
--   curl -X POST "$SUPABASE_URL/rest/v1/rpc/retention_purge" \
--        -H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_KEY"
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'lectr-retention-purge') then
      perform cron.unschedule('lectr-retention-purge');
    end if;
    perform cron.schedule('lectr-retention-purge', '20 7 * * *', 'select public.retention_purge()');
    raise notice 'lectr-retention-purge scheduled daily at 07:20 UTC';
  else
    raise notice 'pg_cron is not installed — enable it (Database → Extensions) and re-run this file, or call retention_purge() nightly via RPC with the service key';
  end if;
end $$;
