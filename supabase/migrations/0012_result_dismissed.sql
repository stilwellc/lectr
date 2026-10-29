-- Results to confirm — "none of these were me" (Oct 28 2026). A settled watch
-- the reader did not win stays a settled watch (History, Record) but leaves
-- the Did-you-win inbox on Today and the Needs-you count for good. The desk
-- sets it in one tap for every result still waiting; marking a lot "I won it"
-- later still books it (owned wins).
-- Additive + idempotent — run once in the Supabase SQL editor. The client
-- tolerates its absence (NEW_COLS fallback: session-only with a toast).
alter table public.saved_lots
  add column if not exists result_dismissed boolean not null default false;
