'use client';

import type { SupabaseClient } from '@supabase/supabase-js';
import { afterFirstPaint } from './after-first-paint';

// Inlined at build time (NEXT_PUBLIC_*). When unset, the client is null and the
// whole app still runs — auth is simply disabled and saved lots fall back to
// localStorage (today's behaviour). Set both env vars to switch auth on; no
// code change needed.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/*
 * LAZY CLIENT (perf wave W18, Oct 11 2026). supabase-js is ~53 KB brotli and
 * the root layout's AccountProvider imported it on EVERY route, so a phone on
 * a slow link downloaded it before hydration — before a single lot row could
 * paint. The real client now loads in its own chunk on the first call; until
 * then `supabase` is a thin stand-in with the same surface the app uses:
 *
 *   supabase.from(t).<any chain>…   → a thenable that replays the chain on
 *   supabase.rpc(fn, args).<chain>…    the real client when awaited
 *   supabase.auth.<method>(…)       → a promise of the real method's result
 *   supabase.auth.onAuthStateChange → the real subscription shape, returned
 *                                     synchronously (registers on load;
 *                                     unsubscribe before load cancels it)
 *
 * Nullness is unchanged (null when auth is not configured), so every
 * `if (!supabase)` guard reads exactly as before. The PKCE ?code= exchange
 * still happens in the client's init — now on AccountProvider's first
 * auth call, once the first screen has painted (app/lib/after-first-paint;
 * at once on the reader's first tap or key) instead of at module evaluation.
 */
let real: Promise<SupabaseClient> | null = null;
export function loadSupabase(): Promise<SupabaseClient> {
  if (!real) {
    real = afterFirstPaint().then(() => import('@supabase/supabase-js')).then(({ createClient }) =>
      createClient(url!, anon!, {
        // PKCE, not the implicit flow: the redirect back from Google / the
        // magic link carries a one-time ?code= that supabase-js exchanges
        // (with the verifier it stashed in localStorage) during init, then
        // strips from the URL — tokens never ride in the URL fragment, so
        // they can't leak via history, Referer or a copied link. Caveat: a
        // magic link must be opened in the same browser that requested it.
        auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      }),
    );
  }
  return real;
}

type Step = { name: string; args: unknown[] };

/** a query chain recorded now and replayed on the real client when awaited */
function deferredChain(root: (c: SupabaseClient) => unknown, steps: Step[] = []): unknown {
  const run = () =>
    loadSupabase().then(c => {
      let q = root(c) as Record<string, (...a: unknown[]) => unknown>;
      for (const s of steps) q = q[s.name](...s.args) as typeof q;
      return q;
    });
  return new Proxy(function () {}, {
    get(_t, name) {
      if (name === 'then') return (f?: (v: unknown) => unknown, r?: (e: unknown) => unknown) => run().then(f, r);
      if (name === 'catch') return (r?: (e: unknown) => unknown) => run().catch(r);
      if (name === 'finally') return (f?: () => void) => run().finally(f);
      if (typeof name === 'symbol') return undefined;
      return (...args: unknown[]) => deferredChain(root, [...steps, { name, args }]);
    },
  });
}

const auth = new Proxy({}, {
  get(_t, name) {
    if (typeof name === 'symbol') return undefined;
    if (name === 'onAuthStateChange') {
      return (cb: Parameters<SupabaseClient['auth']['onAuthStateChange']>[0]) => {
        let live: { unsubscribe: () => void } | null = null;
        let gone = false;
        loadSupabase().then(c => {
          if (gone) return;
          live = c.auth.onAuthStateChange(cb).data.subscription;
        });
        return { data: { subscription: { unsubscribe: () => { gone = true; live?.unsubscribe(); } } } };
      };
    }
    return (...args: unknown[]) =>
      loadSupabase().then(c => (c.auth as unknown as Record<string, (...a: unknown[]) => unknown>)[name](...args));
  },
});

const lazyClient = {
  from: (table: string) => deferredChain(c => c.from(table)),
  rpc: (fn: string, args?: unknown, opts?: unknown) =>
    deferredChain(c => (c.rpc as unknown as (...a: unknown[]) => unknown)(fn, args, opts)),
  auth,
};

export const supabase: SupabaseClient | null =
  url && anon ? (lazyClient as unknown as SupabaseClient) : null;

export const authEnabled = !!supabase;
