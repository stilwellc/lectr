/**
 * safe-storage.ts — the one guarded door to the browser's site storage
 * (Oct 11 2026, /profile review R4 P1-2 / P3-8).
 *
 * Safari private windows, "Block all site data", a sandboxed frame or a full
 * quota make `window.localStorage` THROW — on the property read itself, not
 * only on setItem. Every helper here swallows that: a read is null, a write
 * reports false and can announce it (STORAGE_FAILED_EVENT) so the page says
 * "Couldn't keep that on this device" instead of a control that silently
 * does nothing. Nothing here ever throws.
 *
 * A refused write is still kept IN MEMORY for this page's life (and read
 * back first), so a reader in a private window can still run the quick
 * start, follow, and mark picks — it simply does not survive a reload.
 */

export const STORAGE_FAILED_EVENT = 'lectr-storage-failed';

type Area = 'local' | 'session';

function area(a: Area): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return a === 'local' ? window.localStorage : window.sessionStorage;
  } catch { return null; }
}

/** what the browser refused to keep, per area, for this page's life */
const memory: Record<Area, Map<string, string>> = { local: new Map(), session: new Map() };

/** a stored string, or null (absent, blocked, or unreadable) */
export function storageGet(key: string, a: Area = 'local'): string | null {
  const m = memory[a];
  if (m.has(key)) return m.get(key)!;
  try { return area(a)?.getItem(key) ?? null; } catch { return null; }
}

/** write; false when the browser refused (blocked / full) — the value is
 *  then held in memory for this page. `announce` (a write the reader asked
 *  for — a follow, a mark) tells the page so; background memory (theme,
 *  scroll, last view) fails quietly. */
export function storageSet(key: string, value: string, opts: { area?: Area; announce?: boolean } = {}): boolean {
  const a = opts.area ?? 'local';
  try {
    const s = area(a);
    if (!s) throw new Error('storage unavailable');
    s.setItem(key, value);
    memory[a].delete(key);
    return true;
  } catch {
    memory[a].set(key, value);
    if (opts.announce) storageFailed();
    return false;
  }
}

export function storageRemove(key: string, a: Area = 'local'): void {
  memory[a].delete(key);
  try { area(a)?.removeItem(key); } catch { /* nothing to remove */ }
}

/** a localStorage-shaped handle over the helpers above, for modules that
 *  take one (recs-signals, interests): setItem THROWS when the browser
 *  refused — the caller decides whether to retry or announce — but the
 *  value is held in memory either way */
export const deviceKV = {
  getItem: (k: string): string | null => storageGet(k),
  setItem: (k: string, v: string): void => { if (!storageSet(k, v)) throw new Error('storage refused'); },
  removeItem: (k: string): void => storageRemove(k),
};

/** tell the page a write the reader asked for did not stick */
export function storageFailed(): void {
  try { if (typeof window !== 'undefined') window.dispatchEvent(new Event(STORAGE_FAILED_EVENT)); } catch { /* no window */ }
}

/** the keys lectr keeps in this browser (the reset's scope): lectr-*, the
 *  older ray-* keys and the theme. Never the sign-in session (sb-*), and
 *  never the saved lots (ray-saved-lots: validated on read, and a reader's
 *  saves are not "settings" to wipe). */
export function isLectrKey(k: string): boolean {
  if (k === 'ray-saved-lots') return false;
  return k.startsWith('lectr-') || k.startsWith('ray-') || k === 'costil-theme' || k === 'mobi-theme';
}

/** "Reset this device's lectr data" — clears every lectr key in both areas;
 *  returns how many were removed (0 when storage is blocked) */
export function resetLectrStorage(): number {
  let n = 0;
  for (const m of Object.values(memory)) for (const k of Array.from(m.keys())) if (isLectrKey(k)) m.delete(k);
  for (const a of ['local', 'session'] as const) {
    const s = area(a);
    if (!s) continue;
    try {
      const keys: string[] = [];
      for (let i = 0; i < s.length; i++) { const k = s.key(i); if (k && isLectrKey(k)) keys.push(k); }
      for (const k of keys) { try { s.removeItem(k); n++; } catch { /* keep going */ } }
    } catch { /* blocked mid-way */ }
  }
  return n;
}
