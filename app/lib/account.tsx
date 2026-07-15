'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { User } from '@supabase/supabase-js';
import { supabase, authEnabled } from './supabase';
import type { AuctionLot } from '../types';

/**
 * The account layer. ONE responsibility beyond auth: saved lots are scoped to a
 * user. Everything else in the app stays public — only saving (and the /saved
 * view) needs a session. Degrades gracefully: with no Supabase keys the app
 * behaves exactly as before (saved lots in localStorage), so nothing breaks
 * until auth is provisioned.
 */

const STORAGE_KEY = 'ray-saved-lots';

export interface SavedMeta {
  savedAt: string;
  estMid: number | null;
  signalPct: number | null;
  bidCount: number | null;
}
interface SavedEntry extends SavedMeta { id: string; }

function entryFromLot(id: string, lot?: AuctionLot): SavedEntry {
  const lo = lot?.estimateLow || lot?.estimateHigh || 0;
  const hi = lot?.estimateHigh || lot?.estimateLow || 0;
  return {
    id,
    savedAt: new Date().toISOString(),
    estMid: lo || hi ? (lo + hi) / 2 : null,
    signalPct: lot?.signal?.pct ?? null,
    bidCount: lot?.bidCount ?? null,
  };
}

// localStorage read + legacy migration (bare string[] → entries), preserved for
// the no-auth fallback path and for the one-time upload to the cloud on login.
function readStored(): SavedEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const now = new Date().toISOString();
    const entries: SavedEntry[] = [];
    for (const e of parsed) {
      if (typeof e === 'string') entries.push({ id: e, savedAt: now, estMid: null, signalPct: null, bidCount: null });
      else if (e && typeof e === 'object' && typeof e.id === 'string') entries.push({
        id: e.id,
        savedAt: typeof e.savedAt === 'string' ? e.savedAt : now,
        estMid: typeof e.estMid === 'number' ? e.estMid : null,
        signalPct: typeof e.signalPct === 'number' ? e.signalPct : null,
        bidCount: typeof e.bidCount === 'number' ? e.bidCount : null,
      });
    }
    return entries;
  } catch { return []; }
}
function writeStored(entries: SavedEntry[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(entries)); } catch { /* private mode */ }
}
function rowToEntry(r: Record<string, unknown>): SavedEntry {
  return {
    id: String(r.lot_id),
    savedAt: (r.saved_at as string) || new Date().toISOString(),
    estMid: (r.est_mid as number) ?? null,
    signalPct: (r.signal_pct as number) ?? null,
    bidCount: (r.bid_count as number) ?? null,
  };
}
function entryToRow(userId: string, e: SavedEntry) {
  return { user_id: userId, lot_id: e.id, saved_at: e.savedAt, est_mid: e.estMid, signal_pct: e.signalPct, bid_count: e.bidCount };
}

interface AccountValue {
  authEnabled: boolean;
  user: User | null;
  authReady: boolean;
  signInWithEmail: (email: string) => Promise<{ ok: boolean; message: string }>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  // saved lots — same shape the app already consumes
  savedIds: string[];
  savedMeta: Record<string, SavedMeta>;
  isSaved: (id: string) => boolean;
  toggle: (id: string, lot?: AuctionLot) => void;
  // login UI
  loginOpen: boolean;
  openLogin: () => void;
  closeLogin: () => void;
}

const Ctx = createContext<AccountValue | null>(null);

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState<boolean>(!authEnabled); // ready immediately when auth is off
  const [entries, setEntries] = useState<SavedEntry[]>([]);
  const [loginOpen, setLoginOpen] = useState(false);
  const migratedRef = useRef(false);
  // mirror of entries for reads inside stable callbacks (toggle) without making
  // the callback depend on entries (which would rebind every save button constantly)
  const entriesRef = useRef<SavedEntry[]>([]);
  entriesRef.current = entries;

  // ── auth session ──
  useEffect(() => {
    if (!supabase) { setEntries(readStored()); return; } // localStorage-only mode
    supabase.auth.getSession().then(({ data }) => { setUser(data.session?.user ?? null); setAuthReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
      setAuthReady(true);
      if (session?.user) setLoginOpen(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // ── saved lots follow the user ──
  useEffect(() => {
    if (!supabase) return; // localStorage mode already loaded above
    if (!user) { setEntries([]); return; }
    let cancelled = false;
    (async () => {
      // one-time: lift any localStorage saves into the account, then clear them
      if (!migratedRef.current) {
        migratedRef.current = true;
        const local = readStored();
        if (local.length) {
          await supabase!.from('saved_lots').upsert(local.map(e => entryToRow(user.id, e)), { onConflict: 'user_id,lot_id', ignoreDuplicates: true });
          writeStored([]);
        }
      }
      const { data } = await supabase!.from('saved_lots').select('*').eq('user_id', user.id);
      if (!cancelled) setEntries((data || []).map(rowToEntry));
    })();
    return () => { cancelled = true; };
  }, [user]);

  const toggle = useCallback((lotId: string, lot?: AuctionLot) => {
    // no auth configured → localStorage, exactly like before
    if (!supabase) {
      setEntries(prev => {
        const next = prev.some(e => e.id === lotId) ? prev.filter(e => e.id !== lotId) : [...prev, entryFromLot(lotId, lot)];
        writeStored(next);
        if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(8);
        return next;
      });
      return;
    }
    // auth on → saving requires a session
    if (!user) { setLoginOpen(true); return; }
    // Supabase query builders are LAZY — they only run when awaited or .then()'d.
    // (`void builder` builds the request but never sends it — the original bug
    // where saves never persisted.) Fire the write with .then() so it executes,
    // and log any error instead of failing silently. Optimistic UI regardless.
    const exists = entriesRef.current.some(e => e.id === lotId);
    if (exists) {
      setEntries(prev => prev.filter(e => e.id !== lotId));
      supabase.from('saved_lots').delete().eq('user_id', user.id).eq('lot_id', lotId)
        .then(({ error }) => { if (error) console.error('[account] unsave failed:', error.message); });
    } else {
      const e = entryFromLot(lotId, lot);
      setEntries(prev => (prev.some(p => p.id === lotId) ? prev : [...prev, e]));
      supabase.from('saved_lots').upsert(entryToRow(user.id, e), { onConflict: 'user_id,lot_id' })
        .then(({ error }) => { if (error) console.error('[account] save failed:', error.message); });
      if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(8);
    }
  }, [user]);

  const savedIds = useMemo(() => entries.map(e => e.id), [entries]);
  const savedMeta = useMemo<Record<string, SavedMeta>>(() => {
    const out: Record<string, SavedMeta> = {};
    for (const e of entries) out[e.id] = { savedAt: e.savedAt, estMid: e.estMid, signalPct: e.signalPct, bidCount: e.bidCount };
    return out;
  }, [entries]);
  const isSaved = useCallback((id: string) => entries.some(e => e.id === id), [entries]);

  const signInWithEmail = useCallback(async (email: string) => {
    if (!supabase) return { ok: false, message: 'Sign-in is not configured yet.' };
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: window.location.origin + '/saved' } });
    return error ? { ok: false, message: error.message } : { ok: true, message: 'Check your email for the sign-in link.' };
  }, []);
  const signInWithGoogle = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin + '/saved' } });
  }, []);
  const signOut = useCallback(async () => { if (supabase) await supabase.auth.signOut(); setEntries([]); migratedRef.current = false; }, []);

  const value: AccountValue = {
    authEnabled, user, authReady,
    signInWithEmail, signInWithGoogle, signOut,
    savedIds, savedMeta, isSaved, toggle,
    loginOpen, openLogin: () => setLoginOpen(true), closeLogin: () => setLoginOpen(false),
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      {loginOpen && <LoginModal />}
    </Ctx.Provider>
  );
}

export function useAccount(): AccountValue {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAccount must be used within AccountProvider');
  return c;
}

/** Auth-only slice, for the nav + gates. */
export function useAuth() {
  const { authEnabled, user, authReady, signInWithEmail, signInWithGoogle, signOut, loginOpen, openLogin, closeLogin } = useAccount();
  return { authEnabled, user, authReady, signInWithEmail, signInWithGoogle, signOut, loginOpen, openLogin, closeLogin };
}

// ── The login sheet — Google-only ──
function LoginModal() {
  const { signInWithGoogle, closeLogin } = useAccount();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeLogin(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeLogin]);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="ray-auth-scrim" role="presentation" onClick={closeLogin}>
      <div className="ray-auth-card" role="dialog" aria-modal="true" aria-label="Sign in" onClick={e => e.stopPropagation()}>
        <div className="ray-auth-head">
          <span className="ray-auth-title">Sign in to save lots</span>
          <button className="ray-auth-x" aria-label="Close" onClick={closeLogin}>✕</button>
        </div>
        <p className="ray-auth-lede">Your saved lots follow you across devices — and only you can see them.</p>

        <button className="ray-auth-google" onClick={() => signInWithGoogle()}>
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h11.8c-.5 2.7-2 5-4.3 6.6v5.5h7C42.6 36.9 45.1 31.2 45.1 24.5z"/><path fill="#34A853" d="M24 46c5.8 0 10.6-1.9 14.2-5.2l-7-5.5c-1.9 1.3-4.4 2.1-7.2 2.1-5.5 0-10.2-3.7-11.9-8.7H4.9v5.7C8.5 41.6 15.7 46 24 46z"/><path fill="#FBBC05" d="M12.1 28.7c-.4-1.3-.7-2.7-.7-4.2s.3-2.9.7-4.2v-5.7H4.9C3.4 17.6 2.5 20.7 2.5 24s.9 6.4 2.4 9.1l7.2-4.4z"/><path fill="#EA4335" d="M24 11.1c3.1 0 5.9 1.1 8.1 3.2l6.1-6.1C34.6 4.8 29.8 2.9 24 2.9 15.7 2.9 8.5 7.3 4.9 14.9l7.2 5.7c1.7-5 6.4-8.7 11.9-8.7z"/></svg>
          Continue with Google
        </button>
      </div>
      <style dangerouslySetInnerHTML={{ __html: AUTH_CSS }} />
    </div>,
    document.body
  );
}

const AUTH_CSS = `
.ray-auth-scrim { position: fixed; inset: 0; z-index: 400; display: flex; align-items: center; justify-content: center; padding: 20px; background: rgba(6,7,9,0.66); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); animation: rayAuthIn 160ms var(--ease-signature) both; }
.ray-auth-card { width: 100%; max-width: 380px; background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: 16px; padding: 22px 22px 24px; animation: rayAuthUp 220ms var(--ease-signature) both; }
.ray-auth-head { display: flex; align-items: center; justify-content: space-between; }
.ray-auth-title { font-size: 16px; font-weight: 700; color: var(--color-fg); letter-spacing: -0.01em; }
.ray-auth-x { border: none; background: none; color: var(--color-text-muted); font-size: 15px; cursor: pointer; padding: 6px; margin: -6px; }
.ray-auth-lede { font-size: 13px; line-height: 1.5; color: var(--color-text-secondary); margin: 8px 0 18px; }
.ray-auth-google { width: 100%; display: flex; align-items: center; justify-content: center; gap: 10px; padding: 11px; border-radius: 10px; border: 1px solid var(--color-border); background: #fff; color: #1f1f1f; font-family: var(--font-sans), sans-serif; font-size: 14px; font-weight: 600; cursor: pointer; }
.ray-auth-google:hover { background: #f3f3f3; }
.ray-auth-or { display: flex; align-items: center; gap: 12px; margin: 16px 0; color: var(--color-text-faint); font-size: 12px; }
.ray-auth-or::before, .ray-auth-or::after { content: ''; flex: 1; height: 1px; background: var(--color-border); }
.ray-auth-form { display: flex; flex-direction: column; gap: 10px; }
.ray-auth-input { width: 100%; padding: 11px 13px; border-radius: 10px; border: 1px solid var(--color-border); background: var(--color-bg); color: var(--color-fg); font-family: var(--font-sans), sans-serif; font-size: 16px; outline: none; }
.ray-auth-input:focus { border-color: var(--color-text-muted); }
.ray-auth-submit { width: 100%; padding: 11px; border-radius: 10px; border: none; background: var(--color-up); color: #05140c; font-family: var(--font-sans), sans-serif; font-size: 14px; font-weight: 700; cursor: pointer; }
.ray-auth-submit:disabled { opacity: 0.6; cursor: default; }
.ray-auth-sent { padding: 12px; border-radius: 10px; background: rgba(47,191,113,0.12); color: var(--color-up); font-size: 13.5px; text-align: center; font-weight: 600; }
.ray-auth-err { font-size: 12.5px; color: var(--color-down); }
@keyframes rayAuthIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes rayAuthUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
`;
