/**
 * comps-api.ts — one lot's comp reads, computed at the edge over ONLY the
 * candidate partitions it can draw from (pools.ts), with the SAME app/lib
 * functions the certificate, the comps modal and the nightly lot-pack
 * emitter (scripts/emit-page-stats.ts) run. The answer is a superset of the
 * build-time LotPack so LotPage / ComparableModal / the profile desk read it
 * through their existing pack paths.
 */
import type { AuctionLot } from '../../app/types';
import type { LotPack, PackRow } from '../../app/lib/page-data';
import { marketOf } from '../../app/constants';
import {
  signalWithPool, appraiseLot, soldCompBand, isSportsScienceObject, areComparable,
  scienceReferenceBand, cultureReferenceBand, makerReferenceBand,
} from '../../app/lib/comps';
import { scoreComparable } from '../../app/lib/comp-score';
import { anchorPartitions } from './pools';
import type { Store } from './store';

/** the bookkeeping no page reads (emit-page-stats' maker-shard DROP list) */
const DROP = new Set(['firstSeen', '_vn', 'entitySrc', 'heightCm', 'widthCm', 'depthCm', 'subjectKeys', 'itemClass', 'drill']);
export function slimRow(l: Record<string, unknown>): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const k in l) if (!DROP.has(k)) o[k] = l[k];
  return o;
}
const slim = (l: AuctionLot) => slimRow(l as unknown as Record<string, unknown>) as unknown as PackRow;

const MAX_CONTEXT = 15;
const byDateDesc = (a: AuctionLot, b: AuctionLot) => new Date(b.saleDate).getTime() - new Date(a.saleDate).getTime();
const pricesOf = (pool: AuctionLot[]) => pool.map(l => Math.round(l.priceUsd || 0)).filter(p => p > 0).sort((a, b) => a - b);

export interface ApiLotPack extends LotPack {
  /** appraiseLot over the maker book (always computed — the profile desk's
      collection value and its "same-edition comps" read) */
  ap?: { value: number; n: number; kind: 'edition' | 'form'; confidence: string } | null;
  /** makerReferenceBand (unique works' context range on the profile desk) */
  mr?: { kind: string; confidence: string; med: number; q1: number; q3: number; n: number; scope?: string } | null;
  /** the client-read signal behind `c` when the engine made no call */
  sig?: unknown;
}
export interface CompsAnswer {
  id: string;
  pack: ApiLotPack;
  /** modal context rows (no call, no band): top gated comps by similarity */
  ctx: PackRow[];
  /** the engine's exact-item repeat sale, resolved */
  exact: PackRow | null;
}

function dedupe(rows: Record<string, unknown>[][]): AuctionLot[] {
  const seen = new Set<string>();
  const out: AuctionLot[] = [];
  for (const part of rows) for (const r of part) {
    const id = String(r.id);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(r as unknown as AuctionLot);
  }
  return out;
}

export async function compsFor(store: Store, lot: AuctionLot): Promise<CompsAnswer> {
  const parts = anchorPartitions(lot);
  const mkt = marketOf(lot.artist);
  const sso = isSportsScienceObject(lot);
  const many = async (keys: string[]) => dedupe(await Promise.all(keys.map(k => store.partition(k))));
  const [formPool, idPool, sciPool, culPool, groupRows] = await Promise.all([
    many(parts.form),
    parts.identity ? many([parts.identity]) : Promise.resolve([] as AuctionLot[]),
    mkt === 'science' ? many(parts.science) : Promise.resolve([] as AuctionLot[]),
    mkt === 'culture' ? many(parts.culture) : Promise.resolve([] as AuctionLot[]),
    parts.group ? many([parts.group]) : Promise.resolve([] as AuctionLot[]),
  ]);
  // the maker-book pool LotPage reads (same artist; form ∪ identity covers
  // every candidate compPoolRead / appraiseLot can admit)
  const pool = dedupe([formPool as unknown as Record<string, unknown>[], idPool as unknown as Record<string, unknown>[]]);

  const pack: ApiLotPack = {};
  if (sso) {
    const band = soldCompBand(lot, idPool);
    if (band) pack.b = { form: band.form, median: band.median, low: band.low, high: band.high, n: band.n, confidence: band.confidence, rows: band.pool.map(slim) };
  }
  if (!pack.b) {
    const ev = lot.value;
    const evSane = !ev || ev.compRatio == null || (ev.compRatio <= 5 && ev.compRatio >= 1 / 5);
    if (ev && ev.signal && ev.compRatio != null && evSane) {
      // 'at comparable market' = the engine looked and called it fair: no call
      if (!ev.signal.label.startsWith('at')) {
        const ids = (ev.poolIds || []).map(String);
        const got = await store.rowsById(ids);
        const resolved = ids.map(id => got.get(id) as unknown as AuctionLot | undefined)
          .filter((x): x is AuctionLot => !!x && x.status === 'sold' && !!x.priceUsd);
        pack.c = {
          n: ev.n || resolved.length,
          med: (ev as { compMedianUsd?: number | null }).compMedianUsd ?? ev.compValueUsd ?? null,
          form: lot.formKey || null, kind: 'form', resolved: resolved.length,
          rows: [...resolved].sort(byDateDesc).map(slim), ps: pricesOf(resolved),
        };
      }
    } else {
      const read = signalWithPool(lot, pool);
      if (read) {
        pack.c = {
          n: read.pool.length, med: read.signal.med ?? null, form: String(read.signal.form), kind: read.signal.kind,
          resolved: read.pool.length, rows: [...read.pool].sort(byDateDesc).map(slim), ps: pricesOf(read.pool),
        };
        pack.sig = read.signal;
      }
    }
  }
  const ap = appraiseLot(lot, pool);
  pack.ap = ap ? { value: ap.value, n: ap.n, kind: ap.kind, confidence: String(ap.confidence) } : null;
  pack.a = ap?.value ?? null;
  if (mkt === 'science') pack.r = scienceReferenceBand(lot, sciPool);
  else if (mkt === 'culture') pack.r = cultureReferenceBand(lot, culPool);
  pack.mr = makerReferenceBand(lot, formPool);
  if (lot.repeatSaleGroupId) {
    const rows = groupRows.filter(r => r.repeatSaleGroupId === lot.repeatSaleGroupId);
    if (!rows.some(r => r.id === lot.id)) rows.push(lot);
    if (rows.length >= 2) pack.p = rows.sort((a, b) => ((a.saleDate || '') < (b.saleDate || '') ? -1 : 1)).map(slim);
  }

  // the modal's context list: only when there is neither a call nor a band
  let ctx: PackRow[] = [];
  if (!pack.c && !pack.b) {
    const scored = formPool
      .filter(l => l.artist === lot.artist && l.status === 'sold' && l.priceUsd && l.id !== lot.id && areComparable(lot, l))
      .map(s => ({ lot: s, score: scoreComparable(lot, s) }));
    scored.sort((a, b) => (Math.abs(a.score - b.score) > 0.01 ? b.score - a.score : byDateDesc(a.lot, b.lot)));
    ctx = scored.slice(0, MAX_CONTEXT).map(x => slim(x.lot));
  }

  let exact: PackRow | null = null;
  const exId = lot.value?.exact?.id;
  if (exId) {
    const r = await store.rowById(String(exId));
    exact = r ? slim(r as unknown as AuctionLot) : null;
  }
  return { id: lot.id, pack, ctx, exact };
}
