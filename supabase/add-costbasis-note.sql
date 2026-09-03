-- SUPERSEDED (Sep 2 2026) by supabase/migrations/0001_saved_lots.sql.
-- Historical record only.
-- Cost basis + private notes on saved lots (Aug 28 2026).
-- "I won it" books a piece at the realized hammer price; paid_usd lets the
-- collector record what THEY actually paid (private sale, different premium,
-- negotiated). note is a private free-text field on the piece.
-- Additive + idempotent — run once in the Supabase SQL editor. The client
-- already tolerates their absence (NEW_COLS fallback) but edits only persist
-- across reloads once these exist.
alter table public.saved_lots
  add column if not exists paid_usd numeric,
  add column if not exists note     text;
