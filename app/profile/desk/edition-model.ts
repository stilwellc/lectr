/**
 * TODAY'S EDITION — the Daily Desk paper built on the desk (Oct 29 2026).
 * The pure half of app/profile/desk/edition.tsx: the desk's own data (saves +
 * meta, the live book, settled rows, the recs, follows) mapped onto the
 * runner's inputs, then the SAME planDesk + renderDesk the morning send
 * runs (scripts/lib/daily-desk*, which import nothing Node-only) — the
 * owner reads today's paper any time without waiting for 7 AM. No React,
 * no fetch here: the component hands in what it fetched (entity buckets,
 * receipts, backtest) and the clock.
 */
import type { AuctionLot } from '../../types';
import type { Rec } from '../../lib/recs';
import { recNote } from '../../lib/recs';
import type { Follow } from '../../lib/follows';
import type { SavedMeta } from '../../lib/account';
import { makerLineOf } from '../../lib/lot-labels';
import { lotFollowOf } from '../../lib/lot-follow';
import { marketNamesOf } from '../../lib/your-market';
import { planDesk, laneOf, leadingNameOf, ownedMakerOf, type PlanInput, type WatchRow, type SoldRow, type PickIn, type DeskEmail, type LastSale, type ReceiptsIn, type BacktestIn } from '../../../scripts/lib/daily-desk';
import { renderDesk } from '../../../scripts/lib/daily-desk-html';
import { baseId } from '../../../scripts/lib/push-plan';

export const TZ = 'America/New_York';

/** what the desk holds that the paper reads */
export interface EditionSource {
  now: number;
  savedIds: readonly string[];
  savedMeta: Readonly<Record<string, SavedMeta>>;
  /** the live book plus the desk's kept settled rows */
  book: readonly AuctionLot[];
  /** settled saves resolved to rows (status sold / past pending) */
  sold: readonly AuctionLot[];
  /** settled saves the archive knows only by price and day */
  soldOrphans: readonly { id: string; priceUsd: number; saleDate: string; provisional: boolean }[];
  recs: readonly Rec<AuctionLot>[];
  closingPicks: readonly Rec<AuctionLot>[];
  follows: readonly Follow[];
  /** results still waiting on "Did you win it?" (the desk's own count) */
  pendingResults: number;
  /** the last morning edition's day, when the prefs carry it */
  lastSentOn: string | null;
}

/** the desk's saves as the runner's rows */
export function watchRowsOf(src: Pick<EditionSource, 'savedIds' | 'savedMeta'>): WatchRow[] {
  return src.savedIds.map(id => {
    const m = src.savedMeta[id];
    return {
      lot_id: id, saved_title: m?.title ?? null, saved_artist: m?.artist ?? null, max_usd: m?.maxUsd ?? null, owned: m?.owned ?? false,
      est_mid: m?.estMid ?? null, bid_count: m?.bidCount ?? null, paid_usd: m?.paidUsd ?? null,
    };
  });
}

/** the settled rows the runner would read off public.lots */
export function soldRowsOf(src: Pick<EditionSource, 'sold' | 'soldOrphans' | 'savedMeta'>): SoldRow[] {
  const rows: SoldRow[] = src.sold
    .filter(l => l.status === 'sold')
    .map(l => ({ id: l.id, title: l.title, house: l.auctionHouse, artist: l.artist, price_usd: l.priceUsd ?? l.realizedUsd ?? null, sale_date: l.saleDate || null, image_url: l.imageUrl }));
  const seen = new Set(rows.map(r => baseId(r.id)));
  for (const o of src.soldOrphans) {
    if (o.provisional || seen.has(baseId(o.id))) continue;
    const m = src.savedMeta[o.id];
    rows.push({ id: o.id, title: m?.title ?? null, house: null, artist: m?.artist ?? null, price_usd: o.priceUsd, sale_date: o.saleDate, image_url: null });
  }
  return rows;
}

/** the recs as the paper's picks, laned as the runner lanes them */
export function picksOf(src: Pick<EditionSource, 'recs' | 'closingPicks' | 'savedMeta' | 'book'>): PickIn[] {
  const live = new Map(src.book.map(l => [baseId(l.id), l]));
  const whoFor = (seed: { lotId?: string }): string | null => {
    if (!seed.lotId) return null;
    const l = live.get(baseId(seed.lotId));
    return l ? makerLineOf(l).name || lotFollowOf(l)?.label || leadingNameOf(l.title) : leadingNameOf(src.savedMeta[seed.lotId]?.title);
  };
  const seen = new Set<string>();
  const out: PickIn[] = [];
  for (const r of [...src.closingPicks, ...src.recs]) {
    if (seen.has(r.lot.id)) continue;
    seen.add(r.lot.id);
    out.push({ lot: r.lot, note: recNote(r), lane: laneOf(r, whoFor(r.seed)) });
  }
  return out;
}

/** the entity ids whose buckets the paper reads: the followed names and the owned pieces' makers */
export function entityIdsOf(src: Pick<EditionSource, 'follows' | 'savedIds' | 'savedMeta' | 'book' | 'sold'>): string[] {
  const ids = new Set<string>();
  for (const n of marketNamesOf(src.follows, [])) if (n.id) ids.add(n.id);
  const live = new Map(src.book.map(l => [baseId(l.id), l]));
  const soldArtist = new Map(src.sold.map(l => [baseId(l.id), l.artist]));
  for (const w of watchRowsOf(src)) {
    if (!w.owned) continue;
    const id = ownedMakerOf(w, live.get(baseId(w.lot_id)) ?? null, soldArtist.get(baseId(w.lot_id))).id;
    if (id) ids.add(id);
  }
  return Array.from(ids);
}

/** the reader-local day `days` back from `now` */
export function dayBefore(now: number, days: number, tz = TZ): string {
  return new Date(now - days * 86_400_000).toLocaleDateString('en-CA', { timeZone: tz });
}

/** the runner's inputs from the desk's data; `welcome` is never on here (the window is the last edition's day, else yesterday) */
export function editionInputOf(src: EditionSource, got: { nameSold: ReadonlyMap<string, LastSale | null>; nameRecent: ReadonlyMap<string, readonly LastSale[]>; receipts: ReceiptsIn | null; backtest: BacktestIn | null }): PlanInput {
  const live = new Map(src.book.map(l => [baseId(l.id), l]));
  return {
    now: src.now, tz: TZ,
    watches: watchRowsOf(src), live, sold: soldRowsOf(src), picks: picksOf(src),
    lastSentOn: src.lastSentOn ?? dayBefore(src.now, 1),
    follows: src.follows, book: src.book, nameSold: got.nameSold, nameRecent: got.nameRecent,
    receipts: got.receipts, backtest: got.backtest, pendingResults: src.pendingResults,
  };
}

export function dateLabelOf(now: number, tz = TZ): string {
  return new Date(now).toLocaleDateString('en-US', { timeZone: tz, weekday: 'long', month: 'short', day: 'numeric' });
}

/** the paper's HTML as the morning send renders it, for a sandboxed iframe: the same renderer, every link to the top page,
 *  the unsubscribe link standing in for the one-click token the runner alone holds */
export function renderEdition(model: DeskEmail, origin: string, dateLabel: string): string {
  return renderDesk(model, { origin, unsubUrl: `${origin}/profile#account`, dateLabel, linkTarget: '_top' }).html;
}

export { planDesk };
