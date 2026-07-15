# Turning on login (Supabase) — ~10 minutes

Login + per-user saved lots are already built into the app. They stay **dormant**
until you add two env vars, so nothing breaks in the meantime (saved lots keep
working off `localStorage`). Only the **save action** and the **`/saved`** page
are gated — everything else is public.

## 1. Create the project (free)
1. Go to https://supabase.com → **New project** (free tier). Pick a region near your users.
2. Wait for it to provision (~2 min).

## 2. Create the table
Open **SQL Editor** → paste the contents of [`supabase/saved-lots.sql`](supabase/saved-lots.sql) → **Run**.
This creates `saved_lots` with row-level security so each user only ever sees their own rows.

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

(The anon key is safe to expose publicly — RLS is what protects the data.)

## 5. Add the env vars everywhere the site is built
These are inlined at **build time**, so they must be present wherever `next build` runs:
- **Local:** copy `.env.local.example` → `.env.local` and fill both in.
- **Cloudflare Pages:** Settings → Environment variables → add both to **Production** (and Preview).
- **GitHub Actions (`deploy.yml`):** add both as repo **Variables** and pass them into the build step (they're public-safe, so Variables — not Secrets — is fine).

## 6. Rebuild + deploy
Next build with the vars present flips auth on automatically: a "Sign in" appears
in the nav, the save button prompts sign-in, and `/saved` becomes per-user.
Existing localStorage saves upload to the account on first sign-in.
