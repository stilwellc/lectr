-- 0005 · drop alerts.emailed_at (idempotent).
-- NO EMAIL FEATURES — standing law (Aug 28 2026). The column was the dedupe
-- marker for the email digest (scripts/send-digest.ts, deleted Sep 2 2026);
-- nothing reads or writes it any more. Safe on a live table; a no-op where
-- supabase/retention.sql was never run.
alter table public.alerts drop column if exists emailed_at;
