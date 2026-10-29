'use client';
/**
 * THE RETURN (desk pass 6, Oct 29 2026) — where the reader left the desk,
 * so coming back from a lot lands them there, not at the top with every
 * room folded. The snapshot: scrollY, the folds open, the seats mounted, the
 * More rooms open. It lives in module memory (a soft navigation to /lot and
 * back keeps the JS context) and in sessionStorage (a full load that the
 * browser calls back_forward). A hash in the address bar wins over it — a
 * deep link is a deliberate landing (rail.tsx useHashLanding).
 *
 *   noteOpen / noteNear / noteClosed    the folds report their state
 *   noteScroll                          the page reports its y (throttled)
 *   snapFor(path)                       the snapshot to restore, or null
 *   takeReturn(path)                    the snapshot and the decision, once
 */
const KEY = 'lectr-desk-return';
/** a snapshot older than this is not a return, it is a new visit */
const FRESH_MS = 30 * 60_000;

export interface DeskAnchor { id: string; dy: number }
export interface DeskSnap {
  path: string;
  y: number;
  /** the element whose top sat `dy` px under the chrome when the reader left */
  anchor?: DeskAnchor | null;
  open: string[];
  near: string[];
  closed: string[];
  at: number;
}

let mem: DeskSnap | null = null;
let timer = 0;

function blank(path: string): DeskSnap { return { path, y: 0, open: [], near: [], closed: [], at: Date.now() }; }
function current(): DeskSnap {
  const path = typeof window !== 'undefined' ? window.location.pathname : '/profile';
  if (!mem || mem.path !== path) mem = blank(path);
  return mem;
}
function persist(): void {
  if (timer) return;
  timer = window.setTimeout(() => {
    timer = 0;
    try { window.sessionStorage.setItem(KEY, JSON.stringify(mem)); } catch { /* storage blocked */ }
  }, 300);
}
const add = (list: string[], id: string) => { if (!list.includes(id)) list.push(id); };
const drop = (list: string[], id: string) => { const i = list.indexOf(id); if (i >= 0) list.splice(i, 1); };

export function noteOpen(id: string, open: boolean): void { const s = current(); if (open) add(s.open, id); else drop(s.open, id); s.at = Date.now(); persist(); }
export function noteNear(id: string): void { const s = current(); add(s.near, id); s.at = Date.now(); persist(); }
export function noteClosed(id: string, open: boolean): void { const s = current(); if (open) add(s.closed, id); else drop(s.closed, id); s.at = Date.now(); persist(); }
export function noteScroll(y: number, anchor: DeskAnchor | null = null): void { const s = current(); s.y = y; s.anchor = anchor; s.at = Date.now(); persist(); }

/** the snapshot a mounting desk may restore from: module memory first (a soft
 *  return), else the session's copy when the browser says this load is a
 *  back/forward; null when there is nothing fresh — and never with a hash */
export function snapFor(path: string): DeskSnap | null {
  if (typeof window === 'undefined') return null;
  // (a FRESH snapshot outranks the hash: the section bar's jumps write #room, so a return nearly always carries one)
  if (mem && mem.path === path && Date.now() - mem.at < FRESH_MS && (mem.y > 0 || mem.open.length || mem.closed.length)) return mem;
  let nav = '';
  try { nav = (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type ?? ''; } catch { /* ignore */ }
  if (nav !== 'back_forward') return null;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    const s = raw ? (JSON.parse(raw) as DeskSnap) : null;
    if (s && s.path === path && Date.now() - s.at < FRESH_MS) { mem = s; return s; }
  } catch { /* ignore */ }
  return null;
}

/** does the snapshot hold this fold open / mounted / this More room open? */
export const wasOpen = (ids: readonly string[]): boolean => { const s = snapFor(typeof window !== 'undefined' ? window.location.pathname : '/profile'); return !!s && ids.some(id => s.open.includes(id)); };
export const wasNear = (ids: readonly string[]): boolean => { const s = snapFor(typeof window !== 'undefined' ? window.location.pathname : '/profile'); return !!s && ids.some(id => s.near.includes(id) || s.open.includes(id)); };
export const wasClosedOpen = (ids: readonly string[]): boolean => { const s = snapFor(typeof window !== 'undefined' ? window.location.pathname : '/profile'); return !!s && ids.some(id => s.closed.includes(id)); };
