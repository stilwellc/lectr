/**
 * daily-desk — THE DAILY DESK email's contents for ONE reader (Oct 21 2026).
 * Pure: no network, no env — the runner (scripts/daily-desk-send.ts) hands it
 * the reader's watches, the live book, their settled results and picks, and
 * it returns the email's model, or null when there is nothing worth a send
 * (never an empty email: no closes, no results, no picks → no mail).
 *
 * Sections, in the order a collector acts on them:
 *   overMax     a live bid already past the reader's own max
 *   closing     watches that hammer within the next 36h, soonest first
 *   results     watches that sold since the last email (hammer vs est, vs your max)
 *   below       watches the engine reads below market (not already listed)
 *   picks       up to 3 lots from the recommender (follows + watches), unsaved
 */
import type { AuctionLot } from '../../app/types';
import { closeMsOf } from '../../app/lib/priority';
import { formatEstimate } from '../../app/lib/estimate-text';
import { liveSignalOf, fmtFace } from '../../app/lib/lot-face';
import { signalMagnitude } from '../../app/lib/comps';
import { craftTitle, httpsImg, sizedImg } from '../../app/utils';
import { closeIsTimed } from '../../app/lib/house-tz';
import { makerLineOf } from '../../app/lib/lot-labels';
import { baseId } from './push-plan';

export const CLOSING_WINDOW_MS = 36 * 3_600_000;
export const MAX_ROWS = 6;
export const PICKS_N = 3;

export interface WatchRow { lot_id: string; saved_title?: string | null; max_usd?: number | null; owned?: boolean | null; est_mid?: number | null }
export interface SoldRow { id: string; title?: string | null; house?: string | null; price_usd?: number | null; sale_date?: string | null; image_url?: string | null }
export interface PickIn { lot: AuctionLot; note: string }

export interface DeskItem {
  id: string; title: string; maker: string | null; house: string; img: string | null;
  est: string; when: string | null;
  sig: { dir: 'up' | 'down'; text: string } | null;
  max: string | null; bid: string | null; over: boolean;
}
export interface ResultItem { id: string; title: string; house: string; img: string | null; hammer: string; vsMax: string | null; inReach: boolean | null; vsEst: string | null }
export interface PickItem extends DeskItem { note: string }
export interface DeskEmail {
  subject: string; preheader: string; headline: string;
  overMax: DeskItem[]; closing: DeskItem[]; results: ResultItem[]; below: DeskItem[]; picks: PickItem[];
}

const bidUsdOf = (l: AuctionLot) => { const b = l.currentBid || 0; return !b ? 0 : !l.currency || l.currency === 'USD' ? b : b * (l.fxRate || 0); };
const pct = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(Math.round(x))}%`;

/** "today 7:00 PM" / "tomorrow" / "Thu" — the reader's clock (tz from the runner) */
export function whenText(ms: number | null, now: number, tz: string, timed = true): string | null {
  if (ms == null) return null;
  const day = (t: number) => new Date(t).toLocaleDateString('en-CA', { timeZone: tz });
  const d0 = day(now), d1 = day(now + 86_400_000), d = day(ms);
  // a sale the house dates without an hour: the day, never an invented clock
  const time = timed ? new Date(ms).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }) : '(time TBC)';
  if (d === d0) return `today ${time}`;
  if (d === d1) return `tomorrow ${time}`;
  return new Date(ms).toLocaleDateString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' });
}

function itemOf(l: AuctionLot, w: WatchRow | undefined, now: number, tz: string): DeskItem {
  const sig = liveSignalOf(l);
  const max = w?.max_usd && w.max_usd > 0 ? w.max_usd : null;
  const bid = bidUsdOf(l);
  return {
    id: l.id, title: craftTitle(l.title, l.auctionHouse), maker: makerLineOf(l).name || null, house: l.auctionHouse,
    img: l.imageUrl ? sizedImg(httpsImg(l.imageUrl), 240) ?? null : null, est: formatEstimate(l), when: whenText(closeMsOf(l), now, tz, closeIsTimed(l)),
    sig: sig ? { dir: sig.label === 'Below Market' ? 'up' : 'down', text: sig.label === 'Below Market' ? `${signalMagnitude(sig.label, sig.pct)} below market` : `${Math.min(Math.abs(sig.pct), 99)}% above market` } : null,
    max: max != null ? fmtFace(max) : null, bid: bid > 0 ? fmtFace(bid) : null, over: max != null && bid > max,
  };
}

export function planDesk(input: {
  now: number; tz?: string; watches: readonly WatchRow[]; live: ReadonlyMap<string, AuctionLot>;
  sold: readonly SoldRow[]; picks: readonly PickIn[]; lastSentOn?: string | null;
}): DeskEmail | null {
  const { now, watches, live, sold, picks } = input;
  const tz = input.tz || 'America/New_York';
  const byId = new Map(watches.map(w => [baseId(w.lot_id), w]));
  const used = new Set<string>();

  const liveWatched = watches.map(w => live.get(baseId(w.lot_id))).filter((l): l is AuctionLot => !!l);
  const overMax = liveWatched.map(l => itemOf(l, byId.get(baseId(l.id)), now, tz)).filter(i => i.over).slice(0, MAX_ROWS);
  overMax.forEach(i => used.add(baseId(i.id)));

  const closing = liveWatched
    .map(l => ({ l, ms: closeMsOf(l) }))
    .filter(x => x.ms != null && x.ms >= now && x.ms - now <= CLOSING_WINDOW_MS && !used.has(baseId(x.l.id)))
    .sort((a, b) => a.ms! - b.ms!)
    .slice(0, MAX_ROWS)
    .map(x => itemOf(x.l, byId.get(baseId(x.l.id)), now, tz));
  closing.forEach(i => used.add(baseId(i.id)));

  const since = input.lastSentOn || new Date(now - 2 * 86_400_000).toISOString().slice(0, 10);
  const results: ResultItem[] = sold
    .filter(s => (s.price_usd ?? 0) > 0 && (s.sale_date || '') >= since)
    .slice(0, MAX_ROWS)
    .map(s => {
      const w = byId.get(baseId(s.id));
      const price = s.price_usd as number;
      const max = w?.max_usd && w.max_usd > 0 ? w.max_usd : null;
      const est = w?.est_mid && w.est_mid > 0 ? w.est_mid : null;
      return {
        id: s.id, title: craftTitle(s.title || w?.saved_title || 'Lot', s.house || undefined), house: s.house || '', img: s.image_url ? sizedImg(httpsImg(s.image_url), 240) ?? null : null,
        hammer: fmtFace(price),
        vsMax: max != null ? `${pct((price / max - 1) * 100)} vs your max ${fmtFace(max)}` : null,
        inReach: max != null ? price <= max : null,
        vsEst: est != null ? `${pct((price / est - 1) * 100)} vs the estimate` : null,
      };
    });

  const below = liveWatched
    .filter(l => !used.has(baseId(l.id)) && liveSignalOf(l)?.label === 'Below Market')
    .slice(0, 3)
    .map(l => itemOf(l, byId.get(baseId(l.id)), now, tz));

  const watchedIds = new Set(watches.map(w => baseId(w.lot_id)));
  const pickItems: PickItem[] = picks
    .filter(p => !watchedIds.has(baseId(p.lot.id)))
    .slice(0, PICKS_N)
    .map(p => ({ ...itemOf(p.lot, undefined, now, tz), note: p.note }));

  if (!overMax.length && !closing.length && !results.length && !pickItems.length) return null;

  const closesToday = closing.filter(i => i.when?.startsWith('today')).length;
  const lead = overMax.length
    ? `${overMax.length} ${overMax.length === 1 ? 'bid has' : 'bids have'} passed your max`
    : closesToday
      ? `${closesToday} of yours ${closesToday === 1 ? 'closes' : 'close'} today`
      : closing.length
        ? `${closing.length} of yours ${closing.length === 1 ? 'closes' : 'close'} in the next 36 hours`
        : results.length
          ? `${results.length} of your watches sold`
          : `${pickItems.length} new ${pickItems.length === 1 ? 'pick' : 'picks'} for you`;
  const facts = [
    closing.length && !lead.includes('close') ? `${closing.length} closing` : null,
    results.length && !lead.includes('sold') ? `${results.length} sold` : null,
    below.length ? `${below.length} below market` : null,
    pickItems.length && !lead.includes('pick') ? `${pickItems.length} ${pickItems.length === 1 ? 'pick' : 'picks'}` : null,
  ].filter(Boolean).join(' · ');
  return {
    subject: `Your desk: ${lead}`,
    preheader: facts || 'Your watches, your results and today’s picks.',
    headline: `${lead[0].toUpperCase()}${lead.slice(1)}.`,
    overMax, closing, results, below, picks: pickItems,
  };
}
