# UI-A handoff — the supabase bundle (P1-11)

**Finding.** `@supabase/supabase-js` + `@supabase/auth-js` (≈119 KB gz) ship on every
page because `app/lib/account.tsx:6` does `import { supabase, authEnabled } from
'./supabase'` at module scope, and `app/lib/supabase.ts` calls `createClient()` at
module scope. `AccountProvider` sits in `app/layout.tsx`, so the static import chain
`layout → account → supabase → @supabase/*` lands in the shared client bundle.

**Why it cannot be fixed from `layout.tsx` alone.** The only lever the layout has is
`dynamic(() => import('./lib/account').then(m => m.AccountProvider), { ssr: false })`.
That defers the chunk, but a `ssr:false` wrapper does not render its children on the
server — every page's HTML would be emitted empty inside `<main>` in the static export
(SEO, OG crawlers, and the no-JS first paint all lose the page). Not acceptable for a
static-export site whose lot/maker permalinks are the product. So the laziness has to
live in the data layer.

**Plan (owner: data agent — `app/lib/account.tsx`, `app/lib/supabase.ts`).**

1. `supabase.ts` stops creating the client at module scope. Export:
   ```ts
   export const authEnabled = !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
   let client: Promise<SupabaseClient> | null = null;
   export function getSupabase(): Promise<SupabaseClient> {
     if (!client) client = import('@supabase/supabase-js').then(({ createClient }) =>
       createClient(url!, anon!, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }));
     return client;
   }
   /** true when a persisted session exists — the only case worth paying for the client at boot */
   export function hasPersistedSession(): boolean {
     try { return Object.keys(localStorage).some(k => k.startsWith('sb-') && k.endsWith('-auth-token')); } catch { return false; }
   }
   ```
   Keep the `import type { SupabaseClient, User }` lines — types cost nothing.
2. `account.tsx` boot effect: `if (!authEnabled) return; if (!hasPersistedSession() &&
   !location.hash.includes('access_token') && !location.search.includes('code=')) return;`
   then `getSupabase().then(sb => { sb.auth.getSession(); sb.auth.onAuthStateChange(...) })`.
   The OAuth-return checks matter: `detectSessionInUrl` needs the client on the landing
   after Google redirects back, and there is no persisted key yet at that moment.
3. `signInWithGoogle` / any cloud read+write (`snapshots.ts`, saved-search sync,
   alerts) go through `await getSupabase()`. Every existing `supabase?.from(...)` call
   becomes `(await getSupabase()).from(...)` — the null-client branches stay as the
   `authEnabled === false` branches they already are.
4. Verify: `npx next build` then `ls -la out/_next/static/chunks | sort -k5 -n | tail`
   — the supabase chunk should be its own file and absent from `main-app`/`layout`
   chunks; a signed-out session in the Network panel loads no `@supabase` chunk until
   Sign in is clicked; a signed-in reload still restores the session.

No layout.tsx change is needed once the data layer is lazy; the provider stays where it is.
