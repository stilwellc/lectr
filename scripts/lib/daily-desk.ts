/**
 * daily-desk — THE DAILY DESK email's contents for ONE reader (Oct 21 2026;
 * THE NEWSPAPER Oct 29). Pure: no network, no env, no React — the runner
 * (scripts/daily-desk-send.ts) hands it the reader's watches, follows, the
 * live book, their settled results, the recommender's picks, the names' last
 * hammers and the served market files, and it returns the email's model.
 *
 * THE NEWSPAPER (Oct 29, the owner: "a collectibles newspaper of everything
 * you might want to look at"). A paper publishes daily: the plan is null
 * ONLY for a reader with nothing on the desk at all — no watch, no follow,
 * no result, no pick. Sections, in the order a collector reads them:
 *   glance    watching · next hammer · this week · picks (the cockpit)
 *   overMax   a live bid already past the reader's own max      ┐
 *   closing   watches that hammer within 36h, soonest first     │ NEEDS YOU
 *   results   watches sold since the last email (vs est, vs max)┘
 *   desk      every live watch NOT already under needs-you (a lot prints
 *             once in the paper; "+ the N above" keeps the count honest),
 *             DESK_ROWS then "and N more": bid + count, the engine's read,
 *             when it closes, and MOVEMENT — bids added since the save
 *             (saved_lots.bid_count; no baseline → no claim) and the room
 *             to your max
 *   week      a 7-day calendar of your watches, picks and your names' lots
 *   fresh     NEW FOR YOU — lots the crawl first saw since the last Desk
 *             (lot.firstSeen, the feed's own isNewLot: onboarding floods
 *             excluded) by a name or market the reader follows
 *   picks     the recommender's picks with their reasons, laned "Because
 *             you follow X" / "Because you saved Y" / "New to you"
 *   names     one ledger line per followed name: live lots, the soonest
 *             sale, the last settled hammer (the entity detail bucket)
 *   market    3–5 lines read off the served files: the engine's calls
 *             settled this week (receipts), the flag record (backtest), the
 *             biggest hammer yesterday in your markets, the most-bid lot
 *             tonight, below-market flags on the block, first-seen today,
 *             and YESTERDAY ON LECTR — your names' sales settled yesterday
 *             (the detail buckets' recent rows; the sold ledger is 19 MB
 *             and is never read here)
 * Every figure is derived from the payload; nothing here is invented.
 */
import type { AuctionLot } from '../../app/types';
import { closeMsOf } from '../../app/lib/priority';
import { formatEstimate } from '../../app/lib/estimate-text';
import { liveSignalOf, fmtFace } from '../../app/lib/lot-face';
import { signalMagnitude } from '../../app/lib/comps';
import { craftTitle, httpsImg, sizedImg, isOnBlock } from '../../app/utils';
import { closeIsTimed, houseCloseDayOf, dayEndMs } from '../../app/lib/house-tz';
import { makerLineOf } from '../../app/lib/lot-labels';
import { baseId } from './push-plan';
import { imageOf, rrPreviewImage } from '../../app/lib/house-images';
import { affinityOf, type Follow } from '../../app/lib/follows';
import { marketNamesOf, type MarketName } from '../../app/lib/your-market';
import { entityIdOf } from '../../app/lib/entity/live';
import { parseEntityId, CAT_MARKET } from '../../app/lib/entity/key';
import { pageHrefOf } from '../../app/lib/entity/kinds';
import { isFlagged } from '../../app/lib/flags';
import { isNewLot, houseBaselines } from '../../app/lib/feed-filters';
import { ARTIST_MARKET } from '../../app/constants';
import type { CatKey } from '../../app/lib/taxonomy';

export const CLOSING_WINDOW_MS = 36 * 3_600_000;
export const WEEK_MS = 7 * 86_400_000;
export const MAX_ROWS = 6;
/** live watches printed in full before "and N more" */
export const DESK_ROWS = 12;
export const FRESH_ROWS = 6;
export const PICKS_N = 8;
export const NAME_ROWS = 8;
export const WEEK_DAYS_N = 7;
/** the engine's weekly record prints only on this many graded calls */
export const RECORD_MIN_N = 5;
const DAY_MS = 86_400_000;

export interface WatchRow {
  lot_id: string; saved_title?: string | null; max_usd?: number | null; owned?: boolean | null; est_mid?: number | null;
  /** the bid count the save took (saved_lots.bid_count) — movement reads against it */
  bid_count?: number | null;
}
export interface SoldRow { id: string; title?: string | null; house?: string | null; price_usd?: number | null; sale_date?: string | null; image_url?: string | null }
export interface PickLane { kind: 'follow' | 'saved' | 'new'; label: string }
export interface PickIn { lot: AuctionLot; note: string; lane?: PickLane | null }
/** a name's last settled sale (the entity detail bucket's newest row) */
export interface LastSale { id: string; p: number; d: string; h: string; t: string }
export interface ReceiptRowIn { id: string; k: string; d: string; sd?: string; p: number; r?: number; m?: string; t?: string | null; h?: string | null }
export interface ReceiptsIn { rows: readonly ReceiptRowIn[] }
export interface BacktestIn { flagged?: { n: number; medianPerfPct: number } | null; unflagged?: { n: number; medianPerfPct: number } | null }

export interface DeskItem {
  id: string; title: string; maker: string | null; house: string; img: string | null;
  est: string; when: string | null;
  sig: { dir: 'up' | 'down'; text: string } | null;
  max: string | null; bid: string | null; over: boolean;
  /** "12 bids" (bid auctions) */
  bids: string | null;
}
export interface DeskRow extends DeskItem {
  /** bids added since the save ("+4 bids since you saved it"); null without a baseline */
  moved: string | null;
  /** the bid's distance from your max ("$1.2K under your max" / "past your max by $300") */
  room: string | null;
}
export interface ResultItem { id: string; title: string; house: string; img: string | null; hammer: string; vsMax: string | null; inReach: boolean | null; vsEst: string | null }
export interface PickItem extends DeskItem { note: string; lane: PickLane | null }
export interface WeekCell { day: string; dow: string; date: string; today: boolean; watches: number; picks: number; names: number }
export interface WeekCalendar { days: WeekCell[]; watches: number; picks: number; names: number }
export interface FreshSection { since: string; items: DeskItem[]; more: number }
export interface NameLine {
  label: string; href: string; live: number;
  soonest: { when: string; house: string } | null;
  last: { id: string; hammer: string; day: string; house: string; title: string } | null;
  /** a category follow: live lots only, no single name to read a hammer for */
  note: string | null;
}
export interface MarketLine { text: string; href: string; strong?: string }
export interface Glance {
  /** live watched lots */
  watching: number;
  /** their estimate midpoints summed in USD (two-sided estimates only), formatted; null when none */
  est: string | null;
  /** the soonest watched close: the day word (today / tomorrow / Wed, Nov 11), its clock when the house gave one, the lot */
  next: { id: string; title: string; when: string; time: string | null; /** the lot already prints under needs-you */ above: boolean } | null;
  /** watched closes inside 7 days (the 36h window included) */
  week: number;
  picks: number;
}
export interface DeskEmail {
  subject: string; preheader: string; headline: string;
  glance: Glance;
  overMax: DeskItem[]; closing: DeskItem[]; results: ResultItem[];
  /** the reader has watches at all (settled ones included) — the empty states read it */
  watched: number;
  desk: DeskRow[]; deskMore: number;
  /** live watches printed under needs-you instead (never twice) */
  deskAbove: number;
  week: WeekCalendar;
  fresh: FreshSection | null;
  picks: PickItem[];
  names: NameLine[];
  market: MarketLine[];
}

const bidUsdOf = (l: AuctionLot) => { const b = l.currentBid || 0; return !b ? 0 : !l.currency || l.currency === 'USD' ? b : b * (l.fxRate || 0); };
const pct = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(Math.round(x))}%`;
const n2 = (n: number) => n.toLocaleString('en-US');
const dayKeyIn = (ms: number, tz: string) => new Date(ms).toLocaleDateString('en-CA', { timeZone: tz });
const dayLabel = (day: string, o: Intl.DateTimeFormatOptions) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { ...o, timeZone: 'UTC' });
/** a catalogue-length title closed at a whole word inside the cap (the Goldin bat ran five lines) */
const TITLE_CAP = 96;
function cut(s: string, n: number): string {
  if (s.length <= n) return s;
  const h = s.slice(0, n - 1);
  const sp = h.lastIndexOf(' ');
  return `${(sp > n * 0.5 ? h.slice(0, sp) : h).replace(/[\s,;:.—–-]+$/, '')}…`;
}
const plural = (n: number, one: string, many = `${one}s`) => `${n2(n)} ${n === 1 ? one : many}`;

/** "today 7:00 PM" / "tomorrow" / "Thu" — the reader's clock (tz from the runner) */
export function whenText(ms: number | null, now: number, tz: string, timed = true): string | null {
  if (ms == null) return null;
  const d0 = dayKeyIn(now, tz), d1 = dayKeyIn(now + DAY_MS, tz), d = dayKeyIn(ms, tz);
  // a sale the house dates without an hour: the day, never an invented clock
  const time = timed ? new Date(ms).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }) : '(time TBC)';
  if (d === d0) return `today ${time}`;
  if (d === d1) return `tomorrow ${time}`;
  return new Date(ms).toLocaleDateString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' });
}

/** the day a close lands on: the reader's day for a timed close, the house's sale day for a date-only one */
function dayOf(l: AuctionLot, ms: number, tz: string): string {
  return closeIsTimed(l) ? dayKeyIn(ms, tz) : houseCloseDayOf(l);
}

function itemOf(l: AuctionLot, w: WatchRow | undefined, now: number, tz: string): DeskItem {
  const sig = liveSignalOf(l);
  const max = w?.max_usd && w.max_usd > 0 ? w.max_usd : null;
  const bid = bidUsdOf(l);
  return {
    id: l.id, title: cut(craftTitle(l.title, l.auctionHouse), TITLE_CAP), maker: makerLineOf(l).name || null, house: l.auctionHouse,
    img: sizedImg(httpsImg(imageOf(l)), 240) ?? null, est: formatEstimate(l), when: whenText(closeMsOf(l), now, tz, closeIsTimed(l)),
    sig: sig ? { dir: sig.label === 'Below Market' ? 'up' : 'down', text: sig.label === 'Below Market' ? `${signalMagnitude(sig.label, sig.pct)} below market` : `${Math.min(Math.abs(sig.pct), 99)}% above market` } : null,
    max: max != null ? fmtFace(max) : null, bid: bid > 0 ? fmtFace(bid) : null, over: max != null && bid > max,
    bids: l.bidCount && l.bidCount > 0 ? plural(l.bidCount, 'bid') : null,
  };
}

/** the desk row: the item plus its movement since the save */
function deskRowOf(l: AuctionLot, w: WatchRow | undefined, now: number, tz: string): DeskRow {
  const i = itemOf(l, w, now, tz);
  const base = w?.bid_count, cur = l.bidCount ?? null;
  let moved: string | null = null;
  if (base != null && cur != null) {
    const d = cur - base;
    moved = d > 0 ? `+${plural(d, 'bid')} since you saved it` : 'no new bids since you saved it';
  }
  const max = w?.max_usd && w.max_usd > 0 ? w.max_usd : null;
  const bid = bidUsdOf(l);
  const room = max == null ? null
    : bid <= 0 ? `your max ${fmtFace(max)}`
      : bid <= max ? `${fmtFace(max - bid)} under your max ${fmtFace(max)}`
        : `past your max ${fmtFace(max)} by ${fmtFace(bid - max)}`;
  return { ...i, moved, room };
}

/** the market a follow or a lot lives in (null when none speaks for it) */
function marketOfId(id: string | null | undefined): string | null {
  return id ? parseEntityId(id)?.market ?? null : null;
}
function marketOfFollow(f: Follow): string | null {
  if (f.kind === 'cat') return CAT_MARKET[f.key.split(':')[0] as CatKey] ?? null;
  if (f.kind === 'maker') return ARTIST_MARKET[f.key] ?? null;
  if (f.kind === 'entity') return marketOfId(f.key);
  return null;
}
function marketOfLot(l: AuctionLot): string | null {
  return marketOfId(entityIdOf(l)) ?? ARTIST_MARKET[l.artist] ?? null;
}

/** a name's live lots: the lot's entity key for a name with one, the follow's matcher for one without (the Names calendar's join) */
const nameMatches = (n: Pick<MarketName, 'id' | 'follow'>, l: AuctionLot) =>
  n.id ? entityIdOf(l) === n.id : affinityOf(l, [n.follow]) > 0;

function nameHref(n: MarketName): string {
  if (n.id) return pageHrefOf(n.id) || '/makers';
  if (n.follow.kind === 'cat') {
    const [cat, sub] = n.follow.key.split(':');
    return `/?${new URLSearchParams({ cat, ...(sub ? { sub } : {}), tab: 'all' }).toString()}`;
  }
  return `/makers/${encodeURIComponent(n.follow.key)}`;
}

const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export interface PlanInput {
  now: number; tz?: string;
  watches: readonly WatchRow[];
  live: ReadonlyMap<string, AuctionLot>;
  sold: readonly SoldRow[];
  picks: readonly PickIn[];
  lastSentOn?: string | null;
  follows?: readonly Follow[];
  /** the whole live book (the names, the week, "new for you" and the market read it) */
  book?: readonly AuctionLot[];
  /** entity id → its last settled sale (null: none on file) */
  nameSold?: ReadonlyMap<string, LastSale | null>;
  /** entity id → the detail bucket's recent settled rows (yesterday on lectr reads them) */
  nameRecent?: ReadonlyMap<string, readonly LastSale[]>;
  receipts?: ReceiptsIn | null;
  backtest?: BacktestIn | null;
}

export function planDesk(input: PlanInput): DeskEmail | null {
  const { now, watches, live, sold, picks } = input;
  const tz = input.tz || 'America/New_York';
  const follows = input.follows || [];
  const book = input.book || Array.from(live.values());
  const today = dayKeyIn(now, tz);
  const yesterday = dayKeyIn(now - DAY_MS, tz);
  const byId = new Map(watches.map(w => [baseId(w.lot_id), w]));
  const watchedIds = new Set(byId.keys());
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

  const since = input.lastSentOn || dayKeyIn(now - 2 * DAY_MS, tz);
  const results: ResultItem[] = sold
    .filter(s => (s.price_usd ?? 0) > 0 && (s.sale_date || '') >= since)
    .slice(0, MAX_ROWS)
    .map(s => {
      const w = byId.get(baseId(s.id));
      const price = s.price_usd as number;
      const max = w?.max_usd && w.max_usd > 0 ? w.max_usd : null;
      const est = w?.est_mid && w.est_mid > 0 ? w.est_mid : null;
      return {
        id: s.id, title: cut(craftTitle(s.title || w?.saved_title || 'Lot', s.house || undefined), TITLE_CAP), house: s.house || '', img: sizedImg(httpsImg(s.image_url || rrPreviewImage(s.id)), 240) ?? null,
        hammer: fmtFace(price),
        vsMax: max != null ? `${pct((price / max - 1) * 100)} vs your max ${fmtFace(max)}` : null,
        inReach: max != null ? price <= max : null,
        vsEst: est != null ? `${pct((price / est - 1) * 100)} vs the estimate` : null,
      };
    });

  // YOUR DESK TODAY — every live watch, soonest close first (undated last); a lot under needs-you prints there only
  const deskAll = liveWatched
    .map(l => ({ l, ms: closeMsOf(l) }))
    .filter(x => x.ms == null || x.ms >= now)
    .sort((a, b) => (a.ms ?? Infinity) - (b.ms ?? Infinity));
  const deskRest = deskAll.filter(x => !used.has(baseId(x.l.id)));
  const desk = deskRest.slice(0, DESK_ROWS).map(x => deskRowOf(x.l, byId.get(baseId(x.l.id)), now, tz));
  const deskMore = Math.max(0, deskRest.length - desk.length);
  const deskAbove = deskAll.length - deskRest.length;

  // the picks, laned: follow → saved → new to you, each lane's label kept in first-seen order
  const laneRank = { follow: 0, saved: 1, new: 2 } as const;
  const laneOrder = new Map<string, number>();
  const pickItems: PickItem[] = picks
    .filter(p => !watchedIds.has(baseId(p.lot.id)))
    .slice(0, PICKS_N)
    .map(p => ({ ...itemOf(p.lot, undefined, now, tz), note: p.note, lane: p.lane ?? null }));
  for (const p of pickItems) { const k = p.lane?.label ?? ''; if (!laneOrder.has(k)) laneOrder.set(k, laneOrder.size); }
  pickItems.sort((a, b) => (laneRank[a.lane?.kind ?? 'new'] - laneRank[b.lane?.kind ?? 'new']) || (laneOrder.get(a.lane?.label ?? '')! - laneOrder.get(b.lane?.label ?? '')!));
  const pickIds = new Set(pickItems.map(p => baseId(p.id)));

  // the names: every followed maker / player / subject / category (houses are not a name)
  const roster = marketNamesOf(follows, []);
  const onBlock = book.filter(l => isOnBlock(l, today, now));
  const nameLive = new Map<string, AuctionLot[]>();
  for (const n of roster) nameLive.set(n.key, onBlock.filter(l => nameMatches(n, l)));

  // THE WEEK — a 7-day calendar of your watches, picks and your names' lots (a lot once, under its strongest claim)
  const dayKeys = Array.from({ length: WEEK_DAYS_N }, (_, k) => dayKeyIn(now + k * DAY_MS, tz));
  const cells = new Map<string, WeekCell>(dayKeys.map(day => [day, {
    day, dow: dayLabel(day, { weekday: 'short' }), date: dayLabel(day, { month: 'short', day: 'numeric' }), today: day === today, watches: 0, picks: 0, names: 0,
  }]));
  const placed = new Set<string>();
  const place = (l: AuctionLot, kind: 'watches' | 'picks' | 'names') => {
    const id = baseId(l.id);
    if (placed.has(id)) return;
    const ms = closeMsOf(l);
    if (ms == null || ms < now) return;
    const c = cells.get(dayOf(l, ms, tz));
    if (!c) return;
    placed.add(id); c[kind]++;
  };
  for (const l of liveWatched) place(l, 'watches');
  for (const p of picks) if (pickIds.has(baseId(p.lot.id))) place(p.lot, 'picks');
  for (const ls of Array.from(nameLive.values())) for (const l of ls) if (!watchedIds.has(baseId(l.id))) place(l, 'names');
  const days = Array.from(cells.values());
  const week: WeekCalendar = { days, watches: days.reduce((s, d) => s + d.watches, 0), picks: days.reduce((s, d) => s + d.picks, 0), names: days.reduce((s, d) => s + d.names, 0) };

  // NEW FOR YOU — first seen since the last Desk (the feed's own "new": onboarding floods excluded), by a name or market you follow
  // (a house follow is every lot at the house — the nightly matcher caps it too; names and categories only here)
  const freshFollows = follows.filter(f => f.kind !== 'house');
  let fresh: FreshSection | null = null;
  if (freshFollows.length && book.some(l => l.firstSeen)) {
    // "new" = first seen AFTER the last Desk's day (the feed's rule); a first paper reads since yesterday
    const lastDesk = input.lastSentOn && input.lastSentOn < today ? input.lastSentOn : null;
    const prev = lastDesk ?? dayKeyIn(now - 2 * DAY_MS, tz);
    const baselines = houseBaselines(book, today);
    const hits = onBlock
      .filter(l => !watchedIds.has(baseId(l.id)) && isNewLot(l, { today, prevVisitDay: prev, baselines }))
      .map(l => ({ l, a: Math.max(affinityOf(l, freshFollows as Follow[]), roster.some(n => n.id && nameMatches(n, l)) ? 1 : 0) }))
      .filter(x => x.a > 0)
      .sort((a, b) => (b.a - a.a) || ((closeMsOf(a.l) ?? Infinity) - (closeMsOf(b.l) ?? Infinity)));
    fresh = {
      since: `first seen on lectr since ${lastDesk ? `your last Desk (${dayLabel(lastDesk, { weekday: 'short', month: 'short', day: 'numeric' })})` : 'yesterday'}, on the block and by a name or category you follow — house onboarding floods left out`,
      items: hits.slice(0, FRESH_ROWS).map(x => itemOf(x.l, undefined, now, tz)),
      more: Math.max(0, hits.length - FRESH_ROWS),
    };
  }

  // YOUR NAMES — one ledger line each, the names with lots live first
  const names: NameLine[] = roster
    .map(n => {
      const ls = nameLive.get(n.key) || [];
      const soon = ls.map(l => ({ l, ms: closeMsOf(l) })).filter(x => x.ms != null && x.ms >= now).sort((a, b) => a.ms! - b.ms!)[0] ?? null;
      const last = n.id ? input.nameSold?.get(n.id) ?? null : null;
      return {
        label: n.label, href: nameHref(n), live: ls.length,
        soonest: soon ? { when: whenText(soon.ms, now, tz, closeIsTimed(soon.l)) || 'scheduled', house: soon.l.auctionHouse } : null,
        last: last ? { id: last.id, hammer: fmtFace(last.p), day: dayLabel(last.d, { month: 'short', day: 'numeric' }), house: last.h, title: cut(craftTitle(last.t, last.h), 60) } : null,
        note: n.id ? null : n.follow.kind === 'cat' ? 'category follow · live lots only' : 'live lots only',
      };
    })
    .sort((a, b) => (b.live - a.live) || a.label.localeCompare(b.label))
    .slice(0, NAME_ROWS);

  // THE MARKET — read off the served files, each line linked into lectr
  const myMarkets = new Set<string>();
  for (const f of follows) { const m = marketOfFollow(f); if (m) myMarkets.add(m); }
  for (const l of liveWatched) { const m = marketOfLot(l); if (m) myMarkets.add(m); }
  const market: MarketLine[] = [];
  const rows = input.receipts?.rows || [];
  const weekAgo = dayKeyIn(now - WEEK_MS, tz);
  const settled = rows.filter(r => (r.r ?? 0) > 0 && r.p > 0 && (r.sd || '') >= weekAgo && (r.sd || '') <= today);
  const med = median(settled.map(r => (r.r as number) / r.p));
  // r = realized USD, p = the call's predicted all-in USD (calls-ledger): the median r/p, said with its sign
  if (settled.length >= RECORD_MIN_N && med != null) {
    const off = Math.round((med - 1) * 100);
    market.push({
      strong: off === 0 ? 'Hammers landed on the engine’s calls this week' : `Hammers ran ${Math.abs(off)}% ${off < 0 ? 'under' : 'over'} the engine’s calls this week`,
      text: `median of ${n2(settled.length)} calls graded against the hammer, realized vs the call, both all-in`, href: '/receipts',
    });
  }
  const bt = input.backtest;
  if (bt?.flagged && bt.unflagged && bt.flagged.n > 0) {
    market.push({ strong: `Below-market flags hammered ${pct(bt.flagged.medianPerfPct)} vs estimate`, text: `all-in, median of ${n2(bt.flagged.n)} settled flags, against ${pct(bt.unflagged.medianPerfPct)} unflagged`, href: '/analytics' });
  }
  const mine = (r: ReceiptRowIn) => !myMarkets.size || !r.m || myMarkets.has(r.m);
  const big = rows.filter(r => r.sd === yesterday && (r.r ?? 0) > 0 && mine(r)).sort((a, b) => (b.r as number) - (a.r as number))[0];
  if (big) {
    const inMine = myMarkets.size && big.m && myMarkets.has(big.m);
    market.push({ strong: `${fmtFace(big.r as number)} — the biggest hammer yesterday${inMine ? ' in your markets' : ''}`, text: `${cut(craftTitle(big.t || 'Lot', big.h || undefined), 56)}${big.h ? ` at ${big.h}` : ''}, among the engine's graded calls`, href: `/lot?id=${encodeURIComponent(big.id)}` });
  }
  const tonightEnd = (dayEndMs(today, tz) ?? now) + 4 * 3_600_000;
  const most = onBlock
    .map(l => ({ l, ms: closeMsOf(l) }))
    .filter(x => (x.l.bidCount ?? 0) > 0 && x.ms != null && x.ms >= now && x.ms <= tonightEnd)
    .sort((a, b) => (b.l.bidCount! - a.l.bidCount!))[0];
  if (most) {
    const bid = bidUsdOf(most.l);
    market.push({ strong: `${plural(most.l.bidCount!, 'bid')} on the most-bid lot closing tonight`, text: `${cut(craftTitle(most.l.title, most.l.auctionHouse), 56)} at ${most.l.auctionHouse}${bid > 0 ? `, ${fmtFace(bid)} bid` : ''}`, href: `/lot?id=${encodeURIComponent(most.l.id)}` });
  }
  // YESTERDAY ON LECTR — your names' sales settled yesterday (the detail buckets' recent rows)
  const yday: { n: MarketName; r: LastSale }[] = [];
  for (const n of roster) {
    if (!n.id) continue;
    for (const r of input.nameRecent?.get(n.id) || []) if (r.d === yesterday && r.p > 0) yday.push({ n, r });
  }
  yday.sort((a, b) => b.r.p - a.r.p);
  if (yday.length) {
    const top = yday[0];
    const who = Array.from(new Set(yday.map(x => x.n.label)));
    market.push({
      strong: `Yesterday on lectr: ${plural(yday.length, 'sale')} by your names settled`,
      text: `${fmtFace(top.r.p)} for ${cut(craftTitle(top.r.t, top.r.h), 48)} (${top.n.label}) at ${top.r.h}${yday.length > 1 ? `, ${yday.length - 1} more${who.length > 1 ? ` across ${who.slice(0, 3).join(', ')}` : ''}` : ''}`,
      href: `/lot?id=${encodeURIComponent(top.r.id)}`,
    });
  }
  const flagged = onBlock.filter(isFlagged).length;
  if (flagged) market.push({ strong: `${plural(flagged, 'lot')} on the block the engine reads below market`, text: `of ${n2(onBlock.length)} live`, href: '/value' });
  const seenToday = onBlock.filter(l => (l.firstSeen || '').slice(0, 10) >= yesterday).length;
  if (seenToday) market.push({ strong: `${plural(seenToday, 'lot')} first seen since yesterday`, text: 'new on the block across every house lectr reads', href: '/?tab=new' });
  market.splice(6);

  // THE SEND RULE — a newspaper publishes daily; only an empty desk is skipped
  if (!watches.length && !follows.length && !results.length && !pickItems.length) return null;

  // THE GLANCE — the cockpit's figures
  let estUsd = 0;
  for (const l of liveWatched) {
    const lo = l.estimateLow ?? 0, hi = l.estimateHigh ?? 0;
    if (!(lo > 0) || !(hi > 0)) continue;
    const mid = (lo + hi) / 2;
    estUsd += !l.currency || l.currency === 'USD' ? mid : mid * (l.fxRate || 0);
  }
  const soonest = deskAll.find(x => x.ms != null) ?? null;
  const weekAll = deskAll.filter(x => x.ms != null && x.ms - now <= WEEK_MS).length;
  const glance: Glance = {
    watching: liveWatched.length,
    est: estUsd > 0 ? fmtFace(estUsd) : null,
    next: soonest ? (() => {
      const w = whenText(soonest.ms, now, tz, closeIsTimed(soonest.l)) || 'scheduled';
      const m = /^(today|tomorrow)\s+(.+)$/.exec(w);
      return { id: soonest.l.id, title: cut(craftTitle(soonest.l.title, soonest.l.auctionHouse), 40), when: m ? m[1] : w, time: m && m[2] !== '(time TBC)' ? m[2] : null, above: used.has(baseId(soonest.l.id)) };
    })() : null,
    week: weekAll,
    picks: pickItems.length,
  };

  // THE LEAD — the richest fact: needs you, then closing, results, new, the week, the names, the market
  const closesToday = closing.filter(i => i.when?.startsWith('today')).length;
  const namesLive = names.filter(n => n.live > 0).length;
  const lead = overMax.length ? `${overMax.length} ${overMax.length === 1 ? 'bid has' : 'bids have'} passed your max`
    : closesToday ? `${closesToday} of yours ${closesToday === 1 ? 'closes' : 'close'} today`
      : closing.length ? `${closing.length} of yours ${closing.length === 1 ? 'closes' : 'close'} in the next 36 hours`
        : results.length ? `${results.length} of your watches sold`
          : fresh?.items.length ? `${plural(fresh.items.length + fresh.more, 'new lot')} for the names you follow`
            : weekAll ? `${weekAll} of yours ${weekAll === 1 ? 'closes' : 'close'} this week`
              : namesLive ? `${namesLive} of your names ${namesLive === 1 ? 'is' : 'are'} on the block`
                : pickItems.length ? `${plural(pickItems.length, 'pick')} for you`
                  : flagged ? `${plural(flagged, 'below-market flag')} on the block`
                    : 'a quiet day on your desk';
  const facts = [
    glance.watching ? `${glance.watching} watching${glance.est ? ` · ${glance.est} to the hammer` : ''}` : null,
    closing.length && !lead.includes('close') ? `${closing.length} closing` : null,
    weekAll && !lead.includes('this week') ? `${weekAll} close this week` : null,
    results.length && !lead.includes('sold') ? `${results.length} sold` : null,
    fresh?.items.length && !lead.includes('new') ? `${fresh.items.length + fresh.more} new for you` : null,
    pickItems.length && !lead.includes('pick') ? `${plural(pickItems.length, 'pick')}` : null,
    namesLive && !lead.includes('names') ? `${namesLive} of your names live` : null,
  ].filter(Boolean).join(' · ');
  return {
    subject: `Your desk: ${lead}`,
    preheader: facts || 'Your watches, your names, what’s new and the market — every morning.',
    headline: `${lead[0].toUpperCase()}${lead.slice(1)}.`,
    glance, overMax, closing, results,
    watched: watches.length, desk, deskMore, deskAbove, week, fresh, picks: pickItems, names, market,
  };
}

/** the pick's lane from the recommender's seed — the runner's one read of a Rec */
export function laneOf(r: { seed: { kind: string; label: string; follow?: unknown; broad?: boolean; market?: string }; tier?: number }): PickLane {
  const s = r.seed;
  if (s.market || (r.tier ?? 1) > 1) return { kind: 'new', label: 'New to you' };
  if (s.kind === 'follow' && s.follow) return { kind: 'follow', label: `Because you follow ${cut(s.label, 48)}` };
  if (s.kind === 'saved' || s.kind === 'owned') return { kind: 'saved', label: `Because you ${s.kind === 'owned' ? 'own' : 'saved'} ${cut(s.label, 48)}` };
  return { kind: 'new', label: 'New to you' };
}

/** a name's settled rows from its detail bucket (recent ∪ top, once each) */
export function recentOf(d: { recent?: readonly LastSale[]; top?: readonly LastSale[] } | null | undefined): LastSale[] {
  const seen = new Set<string>();
  const out: LastSale[] = [];
  for (const r of [...(d?.recent || []), ...(d?.top || [])]) {
    if (!r.p || !r.d || seen.has(r.id)) continue;
    seen.add(r.id); out.push({ id: r.id, p: r.p, d: r.d, h: r.h, t: r.t });
  }
  return out;
}
/** a name's last settled sale from its detail bucket (recent ∪ top, newest day) */
export function lastSaleOf(d: { recent?: readonly LastSale[]; top?: readonly LastSale[] } | null | undefined): LastSale | null {
  let best: LastSale | null = null;
  for (const r of [...(d?.recent || []), ...(d?.top || [])]) if (r.p > 0 && r.d && (!best || r.d > best.d)) best = r;
  return best ? { id: best.id, p: best.p, d: best.d, h: best.h, t: best.t } : null;
}
