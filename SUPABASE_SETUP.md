# Turning on login (Supabase) — ~10 minutes

Login + per-user saved lots are already built into the app. They stay **dormant**
until you add two env vars, so nothing breaks in the meantime (saved lots keep
working off `localStorage`). Only the **save action** and the **`/saved`** page
are gated — everything else is public.

## 1. Create the project (free)
1. Go to https://supabase.com → **New project** (free tier). Pick a region near your users.
2. Wait for it to provision (~2 min).

## 2. Apply the schema — `supabase/migrations/`, in order
Open **SQL Editor** and run each file **in numeric order**. Every file is
idempotent (safe to re-run on a live project; a fresh project and the prod
project converge on the same schema):

| # | file | what it creates |
| --- | --- | --- |
| 0001 | `migrations/0001_saved_lots.sql` | `saved_lots` + RLS, incl. `owned`, `saved_title`, `saved_artist`, `paid_usd`, `note` |
| 0002 | `migrations/0002_lots.sql` | `lots` (the nightly query-layer mirror) + public-read RLS + `updated_at` / `sale_date` indexes |
| 0003 | `migrations/0003_retention_loop.sql` | `saved_searches`, `alerts`, `collection_snapshots` + RLS |
| 0004 | `migrations/0004_indexes_and_constraints.sql` | alert/search indexes; **dedupes** `saved_searches` then adds `unique (user_id, query)` |
| 0005 | `migrations/0005_drop_emailed_at.sql` | drops the dead email-digest column (NO EMAIL FEATURES) |
| 0006 | `migrations/0006_retention_purge.sql` | `retention_purge()` (seen alerts > 90d, snapshots capped at 400/user) + its pg_cron schedule |

For 0006 enable **pg_cron** first (Database → Extensions) so the schedule
installs; without it the file still creates the function and prints a NOTICE
telling you to call it nightly via RPC with the service key instead.

The flat files beside `migrations/` (`saved-lots.sql`, `add-owned-column.sql`,
`add-costbasis-note.sql`, `retention.sql`) are the **superseded** originals,
kept as the historical record — do not run them on a new project.

## 3. Configure auth URLs
**Authentication → URL Configuration:**
- **Site URL:** `https://lectr.bid`
- **Redirect URLs:** add `https://lectr.bid/saved` and `http://localhost:3000/saved`

Email (magic-link) sign-in is on by default — you're done for magic link.

### Optional: Google one-click sign-in
1. In **Google Cloud Console** → APIs & Services → Credentials → create an **OAuth client ID** (type: Web).
   - **Authorized redirect URI:** `https://<your-project-ref>.supabase.co/auth/v1/callback`
2. In Supabase → **Authentication → Providers → Google** → paste the Client ID + Secret → enable.
   (Until this is done, the "Continue with Google" button just won't work; magic link always does.)

## 4. Get the keys
**Project Settings → API:**
- `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
- `anon` `public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `service_role` key → `SUPABASE_SERVICE_KEY` (**secret** — the nightly sync/matchers only; never in the client build)

(The anon key is safe to expose publicly — RLS is what protects the data.)

## 5. Add the env vars everywhere the site is built
These are inlined at **build time**, so they must be present wherever `next build` runs:
- **Local:** copy `.env.local.example` → `.env.local` and fill both in.
- **Cloudflare Pages:** Settings → Environment variables → add both to **Production** (and Preview).
- **GitHub Actions (`deploy.yml`, `nightly.yml`):** add both as repo **Variables** (public-safe) and `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` as repo **Secrets** for the nightly sync job.

## 6. Rebuild + deploy
Next build with the vars present flips auth on automatically: a "Sign in" appears
in the nav, the save button prompts sign-in, and `/saved` becomes per-user.
Existing localStorage saves upload to the account on first sign-in.

## Standing laws
- **NO EMAIL FEATURES.** Alerts live in-product only. No mailer, no digest, no
  Resend key — the schema carries no email column (0005 removes the last one).
- The `lots` table is a **query layer**, never the source of truth (R2 is). See
  `docs/data-pipeline.md` for its retention contract.
