-- Collection tracking: a saved past lot can be marked as OWNED, joining the
-- user's collection (tracked with an assumed value client-side).
-- APPLIED 2026-07-17 via the management API — kept here as the record.
alter table public.saved_lots
  add column if not exists owned boolean not null default false;
