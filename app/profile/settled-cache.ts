/**
 * settled-cache.ts — the corpus rows of this desk's SETTLED saves, kept on
 * this device (W19, Oct 11 2026).
 *
 * The picks (Today's Top 3, Lots you may like, For your collection) read
 * the reader's saves as seeds, and a settled save seeds from its corpus row
 * — which lives in the ~35MB archive, not the live book. So the picks used
 * to wait for the archive (or its 20s deadline): on a phone over Slow 4G the
 * desk painted at ~13s and Top 3 at ~35s. A settled lot's row does not
 * change, so once the archive has resolved a save, its row is kept here and
 * the next visit deals the picks the moment the live book lands — from the
 * same rows the archive will hand over, so nothing reshuffles when it does.
 *
 * `null` = the archive answered and does not carry this save (a gone lot:
 * it seeds from the save's own snapshot, before and after the archive).
 * Public catalogue rows only; never sent anywhere; every access wrapped.
 */
import type { AuctionLot } from '../types';

export const SETTLED_ROWS_KEY = 'lectr-settled-rows';
const VERSION = 1;
/** a row bigger than this is not kept (it would crowd the device's storage) */
const MAX_ROW_CHARS = 8_000;
const MAX_ROWS = 150;

export type SettledRows = Map<string, AuctionLot | null>;

export function readSettledRows(): SettledRows {
  const out: SettledRows = new Map();
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(SETTLED_ROWS_KEY) : null;
    if (!raw) return out;
    const j = JSON.parse(raw) as { v?: number; rows?: Record<string, unknown> };
    if (!j || j.v !== VERSION || !j.rows || typeof j.rows !== 'object') return out;
    for (const [id, r] of Object.entries(j.rows)) {
      if (r === null) { out.set(id, null); continue; }
      const l = r as Partial<AuctionLot>;
      if (l && typeof l === 'object' && typeof l.id === 'string' && typeof l.title === 'string' && typeof l.artist === 'string' && l.status !== 'upcoming') out.set(id, l as AuctionLot);
    }
  } catch { /* private mode / corrupted: no cache, the archive decides */ }
  return out;
}

/**
 * After the archive lands: keep the row of every settled save (by the id it
 * was saved under), `null` for one the archive does not carry. Live saves
 * are not kept (the live book carries them). Saves no longer on the desk drop out.
 */
export function writeSettledRows(savedIds: readonly string[], resolve: (id: string) => AuctionLot | undefined): SettledRows {
  const rows: Record<string, AuctionLot | null> = {};
  const out: SettledRows = new Map();
  let n = 0;
  for (const id of savedIds) {
    if (n >= MAX_ROWS) break;
    const l = resolve(id);
    if (l && l.status === 'upcoming') continue;
    if (l && JSON.stringify(l).length > MAX_ROW_CHARS) continue;
    rows[id] = l ?? null;
    out.set(id, l ?? null);
    n++;
  }
  try { localStorage.setItem(SETTLED_ROWS_KEY, JSON.stringify({ v: VERSION, rows })); } catch { /* full / blocked: next visit waits for the archive */ }
  return out;
}
