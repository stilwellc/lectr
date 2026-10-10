/**
 * comps.ts — one lot's comp reads, computed at BUILD time (scripts/emit-r2-index.ts)
 * over ONLY the candidate partitions it can draw from (pools.ts), with the
 * SAME app/lib functions the certificate, the comps modal and the nightly
 * lot-pack emitter (scripts/emit-page-stats.ts) run. The stored answer is a
 * superset of the build-time LotPack, so LotPage / ComparableModal / the
 * profile desk read it through their existing pack paths. The API only
 * hands the stored bytes back (Free-plan CPU budget: no comp math at the edge).
 */
import type { AuctionLot } from '../../app/types';
import type { LotPack, PackRow } from '../../app/lib/page-data';
import { marketOf } from '../../app/constants';
import {
  appraiseLot, soldCompBand, isSportsScienceObject, contextComps,
  scienceReferenceBand, cultureReferenceBand, makerReferenceBand,
} from '../../app/lib/comps';
import { anchorPartitions } from './pools';
import { enginePoolOf } from '../../app/lib/engine-pool';
import { displayRow } from '../../functions/_lib/format';

const slim = (l: AuctionLot) => displayRow(l as unknown as Record<string, unknown>) as unknown as PackRow;

const byDateDesc = (a: AuctionLot, b: AuctionLot) => new Date(b.saleDate).getTime() - new Date(a.saleDate).getTime();
const pricesOf = (pool: AuctionLot[]) => pool.map(l => Math.round(l.priceUsd || 0)).filter(p => p > 0).sort((a, b) => a - b);

export interface ApiLotPack extends LotPack {
  ap?: { value: number; n: number; kind: 'edition' | 'form'; confidence: string } | null;
  mr?: { kind: string; confidence: string; med: number; q1: number; q3: number; n: number; scope?: string } | null;
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

/** the in-memory book the build computes over */
export interface CompSource {
  partition(key: string): AuctionLot[];
  byId(id: string): AuctionLot | undefined;
}

function union(input: AuctionLot[][]): AuctionLot[] {
  const parts = input.filter(p => p.length);
  if (parts.length === 0) return [];
  if (parts.length === 1) return parts[0];
  const seen = new Set<string>();
  const out: AuctionLot[] = [];
  for (const part of parts) for (const r of part) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}

export function compsFor(src: CompSource, lot: AuctionLot): CompsAnswer {
  const parts = anchorPartitions(lot);
  const mkt = marketOf(lot.artist);
  const sso = isSportsScienceObject(lot);
  const many = (keys: string[]) => union(keys.map(k => src.partition(k)));
  const formPool = many(parts.form);
  const idPool = parts.identity ? many([parts.identity]) : [];
  // the maker-book pool LotPage reads (same artist; form ∪ identity covers
  // every candidate compPoolRead / appraiseLot can admit)
  const pool = union([formPool, idPool]);

  const pack: ApiLotPack = {};
  if (sso) {
    const band = soldCompBand(lot, idPool);
    if (band) pack.b = { form: band.form, median: band.median, low: band.low, high: band.high, n: band.n, confidence: band.confidence, rows: [...band.pool].sort(byDateDesc).map(slim) };
  }
  if (!pack.b) {
    // (r7 — one lot, one number) the engine's pool for every lot it valued:
    // a call, "at comparable market", or a value it held the flag back on
    // (app/lib/engine-pool — the lot page's and the build pack's exact read)
    const ep = enginePoolOf(lot.value);
    if (ep) {
      const resolved = ep.ids.map(id => src.byId(id))
        .filter((x): x is AuctionLot => !!x && x.status === 'sold' && !!x.priceUsd);
      pack.c = {
        n: ep.n, med: ep.med,
        form: lot.formKey || null, kind: 'form', resolved: resolved.length,
        rows: [...resolved].sort(byDateDesc).map(slim), ps: pricesOf(resolved),
      };
    }
    // (Oct 6 2026, wave 3) NO FALLBACK READ: a lot the engine declined gets
    // no comp call and no signal (was the client signalWithPool read)
  }
  // (Oct 6 2026, wave 4) an appraisal only on a lot the ENGINE valued — a
  // lot it declined carries no client-side number in its pack
  const ap = lot.value ? appraiseLot(lot, pool) : null;
  pack.ap = ap ? { value: ap.value, n: ap.n, kind: ap.kind, confidence: String(ap.confidence) } : null;
  pack.a = ap?.value ?? null;
  if (mkt === 'science') pack.r = scienceReferenceBand(lot, many(parts.science));
  else if (mkt === 'culture') pack.r = cultureReferenceBand(lot, many(parts.culture));
  pack.mr = makerReferenceBand(lot, formPool);
  if (parts.group) {
    const rows = src.partition(parts.group).filter(r => r.repeatSaleGroupId === lot.repeatSaleGroupId);
    if (!rows.some(r => r.id === lot.id)) rows.push(lot);
    if (rows.length >= 2) pack.p = rows.sort((a, b) => ((a.saleDate || '') < (b.saleDate || '') ? -1 : 1)).map(slim);
  }

  // the modal's context list: only when there is neither a call nor a band —
  // comps.contextComps, the modal's exact read (guarded: a pool that fails the
  // engine's floor / dispersion / ×5 scale guards is no pool)
  let ctx: PackRow[] = [];
  if (!pack.c && !pack.b) ctx = contextComps(lot, formPool).rows.map(slim);

  const exId = lot.value?.exact?.id;
  const ex = exId ? src.byId(String(exId)) : undefined;
  return { id: lot.id, pack, ctx, exact: ex ? slim(ex) : null };
}

/** an answer that carries nothing a surface would print */
export function isEmptyAnswer(a: CompsAnswer): boolean {
  const p = a.pack;
  return !p.b && !p.c && !p.ap && !p.r && !p.mr && !p.p && !a.ctx.length && !a.exact;
}
