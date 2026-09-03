-- 0002 · lots — the query layer mirror of the live book (idempotent).
-- Reconstructed from every code site that touches the table:
--   writer: scripts/sync-lots-db.ts (service key; upsert on id, sweep)
--   readers: app/components/LotPage.tsx (anon REST: ?id=eq.<id>&select=data)
--            app/components/AlertsInbox.tsx (anon: select id,data in (...))
-- The R2 corpus is the source of truth; this table is a permalink /
-- inbox fast path and is PUBLIC-READ (anon select) — every column here is
-- already public on the site. Only the service key writes.

create table if not exists public.lots (
  id              text        primary key,
  artist          text,
  market          text,
  status          text,
  sale_date       date,
  price_usd       numeric,
  est_low_usd     numeric,
  est_high_usd    numeric,
  title           text,
  image_url       text,
  house           text,
  sport           text,
  signal_label    text,
  signal_pct      numeric,
  value           jsonb,
  url             text,
  results_pending boolean     not null default false,
  data            jsonb,      -- the full slim client lot (slimForClient)
  updated_at      timestamptz not null default now()
);

-- additive guards for a table created before one of these columns existed
alter table public.lots add column if not exists artist          text;
alter table public.lots add column if not exists market          text;
alter table public.lots add column if not exists status          text;
alter table public.lots add column if not exists sale_date       date;
alter table public.lots add column if not exists price_usd       numeric;
alter table public.lots add column if not exists est_low_usd     numeric;
alter table public.lots add column if not exists est_high_usd    numeric;
alter table public.lots add column if not exists title           text;
alter table public.lots add column if not exists image_url       text;
alter table public.lots add column if not exists house           text;
alter table public.lots add column if not exists sport           text;
alter table public.lots add column if not exists signal_label    text;
alter table public.lots add column if not exists signal_pct      numeric;
alter table public.lots add column if not exists value           jsonb;
alter table public.lots add column if not exists url             text;
alter table public.lots add column if not exists results_pending boolean not null default false;
alter table public.lots add column if not exists data            jsonb;
alter table public.lots add column if not exists updated_at      timestamptz not null default now();

alter table public.lots enable row level security;

drop policy if exists "lots public read" on public.lots;
-- anon + authenticated may read every row; no insert/update/delete policy
-- exists, so only the service key (which bypasses RLS) can write.
create policy "lots public read" on public.lots
  for select using (true);

-- the sweep + retention predicates (sync-lots-db.ts) filter on these
create index if not exists lots_updated_at_idx on public.lots (updated_at);
create index if not exists lots_sale_date_idx  on public.lots (sale_date);
