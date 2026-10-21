-- My max (Oct 20 2026): the collector's own ceiling on a watched lot — the
-- price THEY would pay. The desk grades it against the hammer (Record), sums
-- it in Budget and flags a live bid that passes it (Today, Watching).
-- Additive + idempotent — run once in the Supabase SQL editor. The client
-- tolerates its absence (NEW_COLS fallback: session-only with a toast) and
-- never sends it in the full-row upsert, so saves keep working pre-migration.
alter table public.saved_lots
  add column if not exists max_usd numeric;
