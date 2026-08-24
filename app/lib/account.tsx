'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { User } from '@supabase/supabase-js';
import { supabase, authEnabled } from './supabase';
import type { AuctionLot } from '../types';
import { craftTitle } from '../utils';

/**
 * The account layer. ONE responsibility beyond auth: saved lots are scoped to a
 * user. Everything else in the app stays public — only saving (and the /saved
 * view) needs a session. Degrades gracefully: with no Supabase keys the app
 * behaves exactly as before (saved lots in localStorage), so nothing breaks
 * until auth is provisioned.
 */

const STORAGE_KEY = 'ray-saved-lots';

/** SIGNED SIGNAL CONVENTION (Aug 24 2026): signalPct saved on/after this date
 *  carries the signal's DIRECTION in its sign — positive = Below Market (comps
 *  sit pct% above the ask; the app-wide signalMagnitude convention), negative =
 *  Above Market. Entries saved BEFORE this date stored the raw label-less
 *  magnitude (always positive, direction lost) — readers MUST treat those as
 *  direction-unknown. Use signalCallOf() to interpret; never read the sign of
 *  a legacy value as a direction. */
// The cutover carries a THREE-DAY BUFFER past the deploy: a tab still running
// the pre-rebuild bundle writes the old unsigned magnitude, and a date-only
// gate would misread its Above-Market saves as 'below'. Values written in the
// buffer window are treated as direction-unknown (bounded data loss, zero
// misreads). The durable fix is a sig_v column on saved_lots — until then the
// date is the only marker we can ship without DDL.
export const SIGNED_SIGNAL_SINCE = '2026-08-27';

export type SignalCall =
  | { dir: 'below' | 'above'; pct: number }   // pct = positive magnitude
  | { dir: 'unknown'; pct: number };          // legacy save — direction lost

/** Interpret a SavedMeta's signal-at-save under the signed convention. */
export function signalCallOf(meta: { savedAt: string; signalPct: number | null } | undefined): SignalCall | null {
  if (!meta || meta.signalPct == null) return null;
  const legacy = (meta.savedAt || '').slice(0, 10) < SIGNED_SIGNAL_SINCE;
  if (legacy) return { dir: 'unknown', pct: Math.abs(meta.signalPct) };
  return meta.signalPct >= 0
    ? { dir: 'below', pct: meta.signalPct }
    : { dir: 'above', pct: -meta.signalPct };
}

export interface SavedMeta {
  savedAt: string;
  estMid: number | null;
  /** signed under SIGNED_SIGNAL_SINCE — see signalCallOf() */
  signalPct: number | null;
  bidCount: number | null;
  /** the user marked this past lot as one they OWN — it joins their collection */
  owned?: boolean;
  /** snapshot of the lot at save time, so an orphaned save (the crawl dropped
   *  the lot) still says WHAT it was — additive; older saves simply lack it */
  title?: string | null;
  artist?: string | null;
}
interface SavedEntry extends SavedMeta { id: string; }

function entryFromLot(id: string, lot?: AuctionLot): SavedEntry {
  const lo = lot?.estimateLow || lot?.estimateHigh || 0;
  const hi = lot?.estimateHigh || lot?.estimateLow || 0;
  return {
    id,
    savedAt: new Date().toISOString(),
    estMid: lo || hi ? (lo + hi) / 2 : null,
    // signed convention: Below Market keeps its positive magnitude, Above
    // Market is stored negative — direction survives the save
    signalPct: lot?.signal
      ? (lot.signal.label === 'Above Market' ? -Math.abs(lot.signal.pct) : Math.abs(lot.signal.pct))
      : null,
    bidCount: lot?.bidCount ?? null,
    owned: false,
    title: lot?.title ? craftTitle(lot.title) : null,
    artist: lot?.artist ?? null,
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
        owned: e.owned === true,
        title: typeof e.title === 'string' ? e.title : null,
        artist: typeof e.artist === 'string' ? e.artist : null,
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
    owned: r.owned === true,
    // defensive reads — `select('*')` simply won't carry these keys until the
    // saved_title/saved_artist migration runs; older rows carry null
    title: typeof r.saved_title === 'string' ? r.saved_title : null,
    artist: typeof r.saved_artist === 'string' ? r.saved_artist : null,
  };
}
function entryToRow(userId: string, e: SavedEntry) {
  return { user_id: userId, lot_id: e.id, saved_at: e.savedAt, est_mid: e.estMid, signal_pct: e.signalPct, bid_count: e.bidCount, owned: e.owned ?? false, saved_title: e.title ?? null, saved_artist: e.artist ?? null };
}
// The saved_title/saved_artist columns are ADDITIVE — until the migration runs,
// PostgREST rejects a write that names them. Detect that one failure mode and
// retry the write without the new columns so saving never breaks pre-migration.
const NEW_COLS = /saved_title|saved_artist/i;
function stripNewCols(row: ReturnType<typeof entryToRow>) {
  const { saved_title: _t, saved_artist: _a, ...rest } = row;
  return rest;
}
async function upsertSaved(userId: string, list: SavedEntry[], opts: { onConflict: string; ignoreDuplicates?: boolean }) {
  const rows = list.map(e => entryToRow(userId, e));
  let { error } = await supabase!.from('saved_lots').upsert(rows, opts);
  if (error && NEW_COLS.test(error.message)) {
    ({ error } = await supabase!.from('saved_lots').upsert(rows.map(stripNewCols), opts));
  }
  return { error };
}

interface AccountValue {
  authEnabled: boolean;
  user: User | null;
  authReady: boolean;
  /** the initial saved-lots load has resolved (cloud fetch done; immediate in
   *  localStorage mode and when signed out) — gates the /saved empty state */
  savedReady: boolean;
  signInWithEmail: (email: string) => Promise<{ ok: boolean; message: string }>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  // saved lots — same shape the app already consumes
  savedIds: string[];
  savedMeta: Record<string, SavedMeta>;
  isSaved: (id: string) => boolean;
  toggle: (id: string, lot?: AuctionLot) => void;
  /** ids of saved lots the user marked as OWNED (their collection) */
  ownedIds: string[];
  toggleOwned: (id: string) => void;
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
  const [savedReady, setSavedReady] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const migratedRef = useRef(false);
  // ── auth-race guard: while the sign-in select() is in flight, every toggle
  // is recorded here; the snapshot merge replays them so a save (or unsave)
  // made in that window is never clobbered by the pre-write snapshot.
  const fetchInFlight = useRef(false);
  const mutationLog = useRef<Map<string, SavedEntry | 'DELETED'>>(new Map());
  // mirror of entries for reads inside stable callbacks (toggle) without making
  // the callback depend on entries (which would rebind every save button constantly)
  const entriesRef = useRef<SavedEntry[]>([]);
  entriesRef.current = entries;

  // Non-blocking toast — so a failed save/unsave says WHY instead of the star
  // silently snapping back. setState identity is stable, so callbacks can call
  // flash() without depending on it.
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = useCallback((msg: string) => {
    setNotice(msg);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 3400);
  }, []);

  // ── auth session ──
  useEffect(() => {
    if (!supabase) { setEntries(readStored()); setSavedReady(true); return; } // localStorage-only mode
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
    if (!user) { setEntries([]); setSavedReady(true); return; }
    setSavedReady(false); // a fresh session's saves are in flight
    let cancelled = false;
    fetchInFlight.current = true;
    mutationLog.current.clear();
    (async () => {
      // one-time: lift any localStorage saves into the account, then clear them.
      // Only clear localStorage AFTER a clean upsert — a failed upload followed by
      // an unconditional clear would wipe the saves from both places (data loss).
      if (!migratedRef.current) {
        migratedRef.current = true;
        const local = readStored();
        if (local.length) {
          const { error } = await upsertSaved(user.id, local, { onConflict: 'user_id,lot_id', ignoreDuplicates: true });
          if (!error) writeStored([]);
          else { console.error('[account] migration upsert failed, keeping local:', error.message); migratedRef.current = false; }
        }
      }
      const { data, error } = await supabase!.from('saved_lots').select('*').eq('user_id', user.id);
      // On a query error `data` is null — do NOT blank the user's saves; keep
      // whatever is already in state and let the next run retry.
      // the fetch RESOLVED either way — even on error the gate must open, or
      // a failed query would hold /saved on the loading state forever
      if (error) {
        console.error('[account] load saved lots failed:', error.message);
        // only the effect that OWNS the fetch may close the race window — a
        // stale effect's late error must not strip the successor's protection
        if (!cancelled) { fetchInFlight.current = false; setSavedReady(true); }
        return;
      }
      if (cancelled) return;
      let loaded = (data || []).map(rowToEntry);
      // replay toggles that raced the select: the snapshot predates their
      // writes, so apply them over it instead of letting it clobber them
      if (mutationLog.current.size) {
        const log = new Map(mutationLog.current);
        loaded = loaded.filter(e => log.get(e.id) !== 'DELETED');
        log.forEach((v, id) => {
          if (v === 'DELETED') return;
          const i = loaded.findIndex(e => e.id === id);
          if (i >= 0) loaded[i] = v; else loaded.push(v);
        });
      }
      fetchInFlight.current = false;
      mutationLog.current.clear();
      setEntries(loaded);
      setSavedReady(true);
      // Replay a save the user queued before signing in (they clicked the star
      // while logged out; we sent them through auth and back here). Completes
      // the intent instead of dropping it.
      try {
        const raw = localStorage.getItem('lectr-pending-save');
        if (raw) {
          localStorage.removeItem('lectr-pending-save');
          const pend = JSON.parse(raw) as SavedEntry;
          if (pend?.id && !loaded.some(e => e.id === pend.id)) {
            setEntries(prev => (prev.some(p => p.id === pend.id) ? prev : [...prev, pend]));
            upsertSaved(user.id, [pend], { onConflict: 'user_id,lot_id' })
              .then(({ error: e2 }) => { if (e2) console.error('[account] pending-save replay failed:', e2.message); });
          }
        }
      } catch { /* private mode / bad json */ }
    })();
    return () => { cancelled = true; };
    // depend on the stable user id, not the User object — token refresh emits a
    // fresh User instance each time and would otherwise re-fetch on a timer.
  }, [user?.id]);

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
    // auth on → saving requires a session. Remember what they were trying to
    // save (survives the OAuth full-page redirect via localStorage) so it
    // completes automatically once they're signed in — the click isn't lost.
    if (!user) {
      // persist the intent even from bare-id call sites — the click must
      // survive the OAuth full-page redirect either way
      try { localStorage.setItem('lectr-pending-save', JSON.stringify(entryFromLot(lotId, lot))); } catch { /* private mode */ }
      setLoginOpen(true);
      return;
    }
    // Supabase query builders are LAZY — they only run when awaited or .then()'d.
    // (`void builder` builds the request but never sends it — the original bug
    // where saves never persisted.) Fire the write with .then() so it executes,
    // and log any error instead of failing silently. Optimistic UI regardless.
    // Optimistic UI, but roll the state change back if the write fails so the
    // star never lies about what's actually persisted.
    const exists = entriesRef.current.some(e => e.id === lotId);
    if (exists) {
      const removed = entriesRef.current.find(e => e.id === lotId);
      if (fetchInFlight.current) mutationLog.current.set(lotId, 'DELETED');
      setEntries(prev => prev.filter(e => e.id !== lotId));
      supabase.from('saved_lots').delete().eq('user_id', user.id).eq('lot_id', lotId)
        .then(({ error }) => {
          if (error) {
            console.error('[account] unsave failed:', error.message);
            if (mutationLog.current.get(lotId) === 'DELETED') mutationLog.current.delete(lotId);
            if (removed) setEntries(prev => (prev.some(p => p.id === lotId) ? prev : [...prev, removed]));
            flash("Couldn't update your watchlist — try again.");
          }
        });
    } else {
      const e = entryFromLot(lotId, lot);
      if (fetchInFlight.current) mutationLog.current.set(lotId, e);
      setEntries(prev => (prev.some(p => p.id === lotId) ? prev : [...prev, e]));
      upsertSaved(user.id, [e], { onConflict: 'user_id,lot_id' })
        .then(({ error }) => {
          if (error) {
            console.error('[account] save failed:', error.message);
            if (mutationLog.current.get(lotId) === e) mutationLog.current.delete(lotId);
            setEntries(prev => prev.filter(p => p.id !== lotId));
            flash("Couldn't save the lot — try again.");
          }
        });
      if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(8);
    }
  }, [user]);

  const savedIds = useMemo(() => entries.map(e => e.id), [entries]);
  const savedMeta = useMemo<Record<string, SavedMeta>>(() => {
    const out: Record<string, SavedMeta> = {};
    for (const e of entries) out[e.id] = { savedAt: e.savedAt, estMid: e.estMid, signalPct: e.signalPct, bidCount: e.bidCount, owned: e.owned, title: e.title, artist: e.artist };
    return out;
  }, [entries]);
  const isSaved = useCallback((id: string) => entries.some(e => e.id === id), [entries]);
  const ownedIds = useMemo(() => entries.filter(e => e.owned).map(e => e.id), [entries]);

  // Mark/unmark a saved past lot as OWNED — optimistic, rolled back on a
  // failed write, mirrored to localStorage in no-auth mode.
  const toggleOwned = useCallback((lotId: string) => {
    const cur = entriesRef.current.find(e => e.id === lotId);
    if (!cur) return;
    const next = !cur.owned;
    const updated = { ...cur, owned: next };
    if (fetchInFlight.current) mutationLog.current.set(lotId, updated);
    setEntries(prev => prev.map(e => (e.id === lotId ? { ...e, owned: next } : e)));
    if (!supabase) {
      const updated = entriesRef.current.map(e => (e.id === lotId ? { ...e, owned: next } : e));
      writeStored(updated);
      return;
    }
    if (!user) return; // entries only exist when signed in under auth mode
    supabase.from('saved_lots').update({ owned: next }).eq('user_id', user.id).eq('lot_id', lotId)
      .then(({ error }) => {
        if (error) {
          console.error('[account] toggleOwned failed:', error.message);
          if (mutationLog.current.get(lotId) === updated) mutationLog.current.delete(lotId);
          setEntries(prev => prev.map(e => (e.id === lotId ? { ...e, owned: !next } : e)));
          flash("Couldn't update your collection — try again.");
        }
      });
  }, [user, flash]);

  // Return the user to the page they were ON (not always /saved) so a save
  // started from the home feed or an artist page lands them back in context.
  const returnTo = () => (typeof window !== 'undefined' ? window.location.href : '/');
  const signInWithEmail = useCallback(async (email: string) => {
    if (!supabase) return { ok: false, message: 'Sign-in is not configured yet.' };
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: returnTo() } });
    return error ? { ok: false, message: error.message } : { ok: true, message: 'Check your email for the sign-in link.' };
  }, []);
  const signInWithGoogle = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: returnTo() } });
  }, []);
  // Only meaningful in auth mode — never blow away the localStorage-mode list.
  const signOut = useCallback(async () => { if (!supabase) return; await supabase.auth.signOut(); setEntries([]); migratedRef.current = false; }, []);

  const openLogin = useCallback(() => setLoginOpen(true), []);
  const closeLogin = useCallback(() => setLoginOpen(false), []);
  // memoized: a toast flash or unrelated provider render must not re-render
  // every save button and page consuming the account context
  const value = useMemo<AccountValue>(() => ({
    authEnabled, user, authReady, savedReady,
    signInWithEmail, signInWithGoogle, signOut,
    savedIds, savedMeta, isSaved, toggle, ownedIds, toggleOwned,
    loginOpen, openLogin, closeLogin,
  }), [user, authReady, savedReady, signInWithEmail, signInWithGoogle, signOut,
    savedIds, savedMeta, isSaved, toggle, ownedIds, toggleOwned, loginOpen, openLogin, closeLogin]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {loginOpen && <LoginModal />}
      {notice && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed', left: '50%', bottom: 'calc(24px + env(safe-area-inset-bottom, 0px))',
            transform: 'translateX(-50%)', zIndex: 300, maxWidth: 'min(92vw, 360px)',
            background: 'rgba(28,26,20,0.96)', color: 'var(--color-fg)', border: '1px solid var(--hairline)',
            borderRadius: 10, padding: '11px 16px', fontSize: 13.5, lineHeight: 1.35, textAlign: 'center',
            boxShadow: '0 8px 30px rgba(12,10,6,0.5)', backdropFilter: 'blur(6px)',
          }}
        >
          {notice}
        </div>
      )}
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
  const { authEnabled, user, authReady, savedReady, signInWithEmail, signInWithGoogle, signOut, loginOpen, openLogin, closeLogin } = useAccount();
  return { authEnabled, user, authReady, savedReady, signInWithEmail, signInWithGoogle, signOut, loginOpen, openLogin, closeLogin };
}

// ── The login sheet — Google-only ──
function LoginModal() {
  const { signInWithGoogle, closeLogin } = useAccount();
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prevFocus = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; // scroll-lock the page behind
    cardRef.current?.querySelector<HTMLElement>('button, a[href], input')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { closeLogin(); return; }
      if (e.key !== 'Tab' || !cardRef.current) return;
      const f = Array.from(cardRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input, [tabindex]:not([tabindex="-1"])'));
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1], active = document.activeElement;
      const inside = active instanceof Node && cardRef.current.contains(active);
      if (e.shiftKey ? (active === first || !inside) : (active === last || !inside)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prevOverflow; prevFocus?.focus(); };
  }, [closeLogin]);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="ray-auth-scrim" role="presentation" onClick={closeLogin}>
      <div ref={cardRef} className="ray-auth-card" role="dialog" aria-modal="true" aria-label="Sign in" onClick={e => e.stopPropagation()}>
        <div className="ray-auth-head">
          <span className="ray-auth-title">Sign in to save lots</span>
          <button className="ray-auth-x" aria-label="Close" onClick={closeLogin}>
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true" style={{ display: 'block' }}>
              <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
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
.ray-auth-scrim { position: fixed; inset: 0; z-index: 400; display: flex; align-items: center; justify-content: center; padding: 20px; background: rgba(15,14,10,0.66); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); animation: rayAuthIn 160ms var(--ease-signature) both; }
.ray-auth-card { width: 100%; max-width: 380px; background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: 16px; padding: 22px 22px 24px; animation: rayAuthUp 220ms var(--ease-signature) both; }
.ray-auth-head { display: flex; align-items: center; justify-content: space-between; }
.ray-auth-title { font-size: 16px; font-weight: 700; color: var(--color-fg); letter-spacing: -0.01em; }
.ray-auth-x { border: none; background: none; color: var(--color-text-muted); font-size: 15px; cursor: pointer; padding: 6px; margin: -6px; }
.ray-auth-lede { font-size: 13px; line-height: 1.5; color: var(--color-text-secondary); margin: 8px 0 18px; }
.ray-auth-google { width: 100%; display: flex; align-items: center; justify-content: center; gap: 10px; padding: 11px; border-radius: 10px; border: 1px solid var(--color-border); background: #fff; color: #1f1f1f; font-family: var(--font-sans), sans-serif; font-size: 14px; font-weight: 600; cursor: pointer; }
.ray-auth-google:hover { background: #f3f3f3; }
@keyframes rayAuthIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes rayAuthUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
`;
