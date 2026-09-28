'use client';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Inlined at build time (NEXT_PUBLIC_*). When unset, the client is null and the
// whole app still runs — auth is simply disabled and saved lots fall back to
// localStorage (today's behaviour). Set both env vars to switch auth on; no
// code change needed.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabase: SupabaseClient | null =
  url && anon
    ? createClient(url, anon, {
        // PKCE, not the implicit flow: the redirect back from Google / the
        // magic link carries a one-time ?code= that supabase-js exchanges
        // (with the verifier it stashed in localStorage) during init, then
        // strips from the URL — tokens never ride in the URL fragment, so
        // they can't leak via history, Referer or a copied link. Caveat: a
        // magic link must be opened in the same browser that requested it.
        auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      })
    : null;

export const authEnabled = !!supabase;
