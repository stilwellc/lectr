/**
 * exact-sale.ts — "This model last sold for" is the LATEST sale of the same
 * model / identity (r9, QA4 B3).
 *
 * value.exact used to be the pool's FIRST identity match — the most similar
 * one, not the most recent: Tête de fou printed "$575K · Nov 1996" over a
 * $1.06M Feb 2020 sale of the same work in the same pool. The engine now
 * picks the latest identity match (lib/value.ts); this resolves the same rule
 * on the client for values stamped before that engine: among the engine's own
 * pool rows, the latest sale that is the SAME model as the stamped match —
 * same maker, same title once the house's maker prefix is stripped, same
 * form, compatible size, no conflicting edition / reference / model key.
 */
import type { AuctionLot } from '../types';
import { sameForm, sizeRatio } from './similarity';

/** a title as an identity: accents, punctuation, life dates and the house's
 *  "MAKER (1881-1973)" / "(B. 1937)" prefix gone */
export function titleIdentity(title: string | null | undefined, maker?: string | null): string {
  let t = (title || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  t = t.replace(/\((?:b\.?|born|c\.?)?\s*\d{4}[^)]*\)/g, ' ');
  t = t.replace(/[^a-z0-9]+/g, ' ').trim();
  const m = (maker || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (m) {
    const parts = m.split(' ');
    const fwd = parts.join(' '), rev = [...parts].reverse().join(' ');
    for (const p of [fwd, rev]) if (p && t.startsWith(p + ' ')) { t = t.slice(p.length + 1); break; }
  }
  return t;
}

function conflict<T>(a: T | null | undefined, b: T | null | undefined): boolean {
  return a != null && b != null && a !== b;
}

/** the same model / identity as the stamped match */
export function sameModel(a: AuctionLot, b: AuctionLot): boolean {
  if (a.artist !== b.artist) return false;
  if (!sameForm(a, b)) return false;
  if (conflict(a.reference, b.reference) || conflict(a.modelKey, b.modelKey)) return false;
  if (conflict(a.editionTotal, b.editionTotal)) return false;
  const sr = sizeRatio(a, b);
  if (sr != null && sr > 1.25) return false;
  const ta = titleIdentity(a.title, makerName(a)), tb = titleIdentity(b.title, makerName(b));
  return !!ta && ta === tb;
}

function makerName(l: AuctionLot): string {
  // the slug reads as the maker's words ("pablo-picasso" → "pablo picasso")
  return (l.artist || '').replace(/-/g, ' ');
}

export interface ExactSale { id: string; realizedUsd: number; saleDate: string; cls: string }

/** same-model sales spanning more than this are not one identity — a title
 *  shared by a single screenprint and its portfolio (Warhol "Mao": $24K to
 *  $1.66M in one pool), or by different sizes/states with no dimensions */
export const AMBIGUOUS_SPREAD = 10;

/** The latest sale of the stamped match's model among `pool` (the engine's
 *  pool rows). Never earlier than the stamp; the stamp itself when nothing
 *  later is the same model; null when the title names no single identity in
 *  the pool (the same-model sales spread past AMBIGUOUS_SPREAD) — "this model
 *  last sold for" is then not a claim the data can make. */
export function latestExactSale(stamp: ExactSale, stampRow: AuctionLot | null | undefined, pool: readonly AuctionLot[]): ExactSale | null {
  if (!stampRow) return stamp;
  let best = stamp;
  let lo = stamp.realizedUsd, hi = stamp.realizedUsd;
  for (const r of pool) {
    if (r.id === stamp.id || r.status !== 'sold' || !(r.priceUsd && r.priceUsd > 0) || !r.saleDate) continue;
    if (!sameModel(stampRow, r)) continue;
    lo = Math.min(lo, r.priceUsd); hi = Math.max(hi, r.priceUsd);
    if (r.saleDate.slice(0, 10) <= best.saleDate.slice(0, 10)) continue;
    best = { id: r.id, realizedUsd: r.priceUsd, saleDate: r.saleDate, cls: stamp.cls };
  }
  if (lo > 0 && hi / lo > AMBIGUOUS_SPREAD) return null;
  return best;
}
