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
 *             excluded) grouped by the follow that reaches them ("By Andy
 *             Warhol · 3", "Charizard · 12"), FRESH_PER_GROUP rows each
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
import { marketNamesOf, makerEntityId, entityIdOfFollow, type MarketName } from '../../app/lib/your-market';
import { lotFollowOf } from '../../app/lib/lot-follow';
import { subEntityLabel } from '../../app/lib/entity/key';
import { ARTIST_LABEL } from '../../app/constants';
import { CAT_LABEL } from '../../app/lib/taxonomy';
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
/** results to confirm printed before "and N more" */
export const RESULT_ROWS = 5;
/** owned pieces printed before "and N more" */
export const COLLECTION_ROWS = 8;
/** live watches printed in full before "and N more" */
export const DESK_ROWS = 12;
/** new-for-you rows per follow group, and groups per paper */
export const FRESH_PER_GROUP = 3;
export const FRESH_GROUPS = 5;
export const PICKS_N = 8;
export const NAME_ROWS = 8;
export const WEEK_DAYS_N = 7;
/** the subject line's cap (Gmail shows ~70 on a desktop list, ~40 on a phone) */
export const SUBJECT_MAX = 60;
/** the hour the paper lands, on the reader's clock (America/New_York): the workflow fires at 11:00 and 12:00 UTC
 *  so one of them is 7 AM through DST; the runner takes the one that is */
export const SEND_HOUR = 7;
export function isSendHour(nowMs: number, tz: string): boolean {
  return Number(new Date(nowMs).toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hour12: false })) % 24 === SEND_HOUR;
}
/** the engine's weekly record prints only on this many graded calls */
export const RECORD_MIN_N = 5;
const DAY_MS = 86_400_000;

export interface WatchRow {
  lot_id: string; saved_title?: string | null; max_usd?: number | null; owned?: boolean | null; est_mid?: number | null;
  /** the bid count the save took (saved_lots.bid_count) — movement reads against it */
  bid_count?: number | null;
  /** an owned piece: what the collector paid (cost basis), the maker slug snapshot */
  paid_usd?: number | null; saved_artist?: string | null;
}
export interface SoldRow { id: string; title?: string | null; house?: string | null; price_usd?: number | null; sale_date?: string | null; image_url?: string | null; /** the maker / collection slug (the collection's maker read when the save kept none) */ artist?: string | null }
export interface PickLane { kind: 'follow' | 'saved' | 'new'; label: string; /** the saved seed's maker (lanes of one maker merge) */ who?: string | null }
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
export interface ResultItem { id: string; title: string; house: string; img: string | null; hammer: string; vsMax: string | null; inReach: boolean | null; vsEst: string | null; /** the sale day ("Oct 21") — results spanning days group by it */ day: string }
/** an owned piece with its maker's latest settled hammer (never an appraisal) */
export interface CollectionItem { id: string; title: string; maker: string | null; house: string | null; img: string | null; paid: string | null; latest: { id: string; hammer: string; day: string; house: string } | null }
export interface PickItem extends DeskItem { note: string; lane: PickLane | null }
export interface WeekCell { day: string; dow: string; date: string; today: boolean; watches: number; picks: number; names: number }
export interface WeekCalendar { days: WeekCell[]; watches: number; picks: number; names: number }
export interface FreshGroup { label: string; href: string; items: DeskItem[]; more: number; total: number }
export interface FreshSection { since: string; /** "since your last Desk (Wed, Oct 28)" / "since yesterday" */ window: string; groups: FreshGroup[]; /** groups past FRESH_GROUPS */ moreGroups: number; total: number }
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
  /** what Closing this week counts: your watches + picks on the calendar */
  week: number;
  weekWatches: number; weekPicks: number;
  picks: number;
}
export interface DeskEmail {
  subject: string; preheader: string; headline: string;
  /** the reader's first edition (no last_sent_on): a two-line welcome under the masthead, never again after */
  welcome: boolean;
  glance: Glance;
  overMax: DeskItem[]; closing: DeskItem[]; results: ResultItem[]; resultsMore: number;
  /** "In this edition" — the sections present, with their counts */
  edition: string[];
  collection: CollectionItem[]; collectionMore: number;
  /** the reader has watches at all (settled ones included) — the empty states read it */
  watched: number;
  desk: DeskRow[]; deskMore: number;
  /** live watches printed under needs-you instead (never twice) */
  deskAbove: number;
  /** watches no longer on the block (settled / rolled off) — the Record holds them */
  deskSettled: number;
  /** settled watches still waiting on "Did you win it?" (not owned, not dismissed), any date */
  pendingResults: number;
  week: WeekCalendar;
  fresh: FreshSection | null;
  picks: PickItem[];
  names: NameLine[];
  /** followed names with nothing live, collapsed into one line */
  quietNames: string[];
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
  let out = sp > n * 0.5 ? h.slice(0, sp) : h;
  // a parenthesis the cut opened and never closed ("… catalans (Two") goes with its tail
  const paren = out.lastIndexOf('(');
  if (paren > n * 0.5 && !out.includes(')', paren)) out = out.slice(0, paren);
  return `${out.replace(/[\s,;:.—–-]+$/, '')}…`;
}
const plural = (n: number, one: string, many = one.endsWith('h') ? `${one}es` : `${one}s`) => `${n2(n)} ${n === 1 ? one : many}`;

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
    moved = d > 0 && d === cur ? `all ${plural(d, 'bid')} since you saved it` : d > 0 ? `+${plural(d, 'bid')} since you saved it` : 'no new bids since you saved it';
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

function nameHref(n: MarketName, tab = 'all'): string {
  if (n.id) return pageHrefOf(n.id) || '/makers';
  if (n.follow.kind === 'cat') {
    const [cat, sub] = n.follow.key.split(':');
    return `/?${new URLSearchParams({ cat, ...(sub ? { sub } : {}), tab }).toString()}`;
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
  /** settled watches still waiting on "Did you win it?" (the runner counts them: sold, not owned, not dismissed) */
  pendingResults?: number;
}

export function planDesk(input: PlanInput): DeskEmail | null {
  const { now, watches, live, sold, picks } = input;
  const tz = input.tz || 'America/New_York';
  // a category follow's label from the taxonomy (a stored "Space & Science · science-tech" reads "Science & Tech")
  const follows = (input.follows || []).map(f => (f.kind === 'cat' ? { ...f, label: catLabelOf(f.key) } : f));
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
  const resultsAll = sold
    .filter(s => (s.price_usd ?? 0) > 0 && (s.sale_date || '') >= since)
    .sort((a, b) => (b.sale_date || '').localeCompare(a.sale_date || '') || (b.price_usd as number) - (a.price_usd as number));
  const results: ResultItem[] = resultsAll
    .slice(0, RESULT_ROWS)
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
        day: s.sale_date ? dayLabel(s.sale_date.slice(0, 10), { weekday: 'short', month: 'short', day: 'numeric' }) : 'date to come',
      };
    });
  const resultsMore = resultsAll.length - results.length;

  // YOUR COLLECTION — the owned pieces with their maker's latest settled hammer (the entity bucket's newest row; never an appraisal)
  // a settled piece's title, house, photo and maker come from its sold row when the save kept none
  const soldById = new Map(sold.map(r => [baseId(r.id), r]));
  const ownedRows = watches.filter(w => w.owned);
  const collection: CollectionItem[] = ownedRows.slice(0, COLLECTION_ROWS).map(w => {
    const l = live.get(baseId(w.lot_id)) ?? null;
    const sr = soldById.get(baseId(w.lot_id)) ?? null;
    const m = ownedMakerOf(w, l, sr?.artist);
    const latest = m.id ? input.nameSold?.get(m.id) ?? null : null;
    const house = l?.auctionHouse || sr?.house || null;
    return {
      id: w.lot_id, title: cut(craftTitle(l?.title || w.saved_title || sr?.title || 'Untitled piece', house || undefined), TITLE_CAP), maker: m.label, house,
      img: l ? sizedImg(httpsImg(imageOf(l)), 240) ?? null : sizedImg(httpsImg(sr?.image_url || rrPreviewImage(w.lot_id)), 240) ?? null,
      paid: w.paid_usd && w.paid_usd > 0 ? fmtFace(w.paid_usd) : null,
      latest: latest ? { id: latest.id, hammer: fmtFace(latest.p), day: dayLabel(latest.d, { month: 'short', day: 'numeric' }), house: latest.h } : null,
    };
  });
  const collectionMore = ownedRows.length - collection.length;

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
  // two saved-lot lanes of one maker read as one ("Because you saved 2 Thomas Edison lots")
  const byWho = new Map<string, Set<string>>();
  for (const p of pickItems) if (p.lane?.kind === 'saved' && p.lane.who) byWho.set(p.lane.who, (byWho.get(p.lane.who) || new Set()).add(p.lane.label));
  for (const p of pickItems) {
    const w = p.lane?.kind === 'saved' ? p.lane.who : null;
    if (w && (byWho.get(w)?.size ?? 0) > 1) p.lane = { ...p.lane!, label: `Because you saved ${byWho.get(w)!.size} ${w} lots` };
  }
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
    // the follow that reaches each lot: a name first (maker / player / subject), then a category — one group per follow
    const reach = [...roster.filter(n => n.id), ...roster.filter(n => !n.id && n.follow.kind === 'cat')];
    const byGroup = new Map<string, { n: MarketName; lots: AuctionLot[] }>();
    for (const l of onBlock) {
      if (watchedIds.has(baseId(l.id)) || !isNewLot(l, { today, prevVisitDay: prev, baselines })) continue;
      const n = reach.find(x => nameMatches(x, l));
      if (!n) continue;
      const g = byGroup.get(n.key);
      if (g) g.lots.push(l); else byGroup.set(n.key, { n, lots: [l] });
    }
    const groupsAll = Array.from(byGroup.values()).sort((a, b) => b.lots.length - a.lots.length || a.n.label.localeCompare(b.n.label));
    const groups: FreshGroup[] = groupsAll.slice(0, FRESH_GROUPS).map(g => {
      const lots = g.lots.sort((a, b) => (closeMsOf(a) ?? Infinity) - (closeMsOf(b) ?? Infinity));
      return {
        label: g.n.follow.kind === 'maker' ? `By ${g.n.label}` : g.n.label, href: nameHref(g.n, 'new'),
        items: lots.slice(0, FRESH_PER_GROUP).map(l => itemOf(l, undefined, now, tz)), more: Math.max(0, lots.length - FRESH_PER_GROUP), total: lots.length,
      };
    });
    const window = `since ${lastDesk ? `your last Desk (${dayLabel(lastDesk, { weekday: 'short', month: 'short', day: 'numeric' })})` : 'yesterday'}`;
    fresh = {
      since: `first seen on lectr ${window}, on the block and by a name or category you follow — house onboarding floods left out`, window,
      groups, moreGroups: groupsAll.length - groups.length, total: groupsAll.reduce((s, g) => s + g.lots.length, 0),
    };
  }

  // YOUR NAMES — one ledger line per name with lots live; the quiet ones collapse into one line
  const namesAll: NameLine[] = roster
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
    .sort((a, b) => (b.live - a.live) || a.label.localeCompare(b.label));
  const names = namesAll.filter(n => n.live > 0).slice(0, NAME_ROWS);
  const quietNames = namesAll.filter(n => n.live === 0).map(n => n.label);

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
  // what Closing this week counts: your watches + picks on the calendar (the picks closing today used to be missing here)
  const weekAll = week.watches + week.picks;
  // the week in words: picks are not "yours" — "3 picks for you close this week", "2 of your watches and 3 picks close this week"
  const weekLead = !weekAll ? null
    : week.watches && week.picks ? `${week.watches} of your watches and ${plural(week.picks, 'pick')} close this week`
      : week.watches ? `${week.watches} of yours ${week.watches === 1 ? 'closes' : 'close'} this week`
        : `${plural(week.picks, 'pick')} for you ${week.picks === 1 ? 'closes' : 'close'} this week`;
  const glance: Glance = {
    watching: liveWatched.length,
    est: estUsd > 0 ? fmtFace(estUsd) : null,
    next: soonest ? (() => {
      const w = whenText(soonest.ms, now, tz, closeIsTimed(soonest.l)) || 'scheduled';
      const m = /^(today|tomorrow)\s+(.+)$/.exec(w);
      return { id: soonest.l.id, title: cut(craftTitle(soonest.l.title, soonest.l.auctionHouse), 40), when: m ? m[1] : w, time: m && m[2] !== '(time TBC)' ? m[2] : null, above: used.has(baseId(soonest.l.id)) };
    })() : null,
    week: weekAll, weekWatches: week.watches, weekPicks: week.picks,
    picks: pickItems.length,
  };

  // THE LEAD — needs you first (past max, closing, results); then the richest of new for you / the picks / your names;
  // then the week, the market, a quiet day. The sub-line says what else the paper holds.
  const closesToday = closing.filter(i => i.when?.startsWith('today')).length;
  const namesLive = names.length;
  const richest = [
    { n: fresh?.total ?? 0, say: `${plural(fresh?.total ?? 0, 'new lot')} for the names you follow` },
    { n: pickItems.length, say: `${plural(pickItems.length, 'pick')} for you today` },
    { n: namesLive, say: `${namesLive} of your names ${namesLive === 1 ? 'is' : 'are'} on the block` },
  ].sort((a, b) => b.n - a.n)[0];
  const lead = overMax.length ? `${overMax.length} ${overMax.length === 1 ? 'bid has' : 'bids have'} passed your max`
    : closesToday ? `${closesToday} of yours ${closesToday === 1 ? 'closes' : 'close'} today`
      : closing.length ? `${closing.length} of yours ${closing.length === 1 ? 'closes' : 'close'} in the next 36 hours`
        : results.length ? `${plural(results.length + resultsMore, 'watch', 'watches')} of yours sold`
          : richest.n ? richest.say
            : weekLead ? weekLead
              : flagged ? `${plural(flagged, 'below-market flag')} on the block`
                : 'a quiet day on your desk';
  const facts = [
    fresh?.total && !lead.includes('new lot') ? `${fresh.total} new for you` : null,
    pickItems.length && !lead.includes('pick') ? plural(pickItems.length, 'pick') : null,
    namesLive && !lead.includes('your names') ? `${namesLive} ${namesLive === 1 ? 'name' : 'names'} on the block` : null,
    weekLead && lead !== weekLead && !lead.includes('this week') ? weekLead : null,
    closing.length && !lead.includes('close') ? `${closing.length} closing` : null,
    results.length && !lead.includes('sold') ? `${results.length + resultsMore} sold` : null,
    collection.length ? `${plural(collection.length + collectionMore, 'piece')} you own` : null,
    glance.watching ? `${glance.watching} watching${glance.est ? ` · ${glance.est} to the hammer` : ''}` : null,
    input.pendingResults ? `${n2(input.pendingResults)} ${input.pendingResults === 1 ? 'result' : 'results'} waiting` : null,
  ].filter(Boolean).slice(0, 5).join(' · ');
  // IN THIS EDITION — the sections present, with their counts
  const needsN = overMax.length + closing.length + results.length;
  const edition = [
    needsN ? `Needs you (${needsN})` : null,
    desk.length ? `Your desk today (${desk.length + deskAbove})` : null,
    collection.length ? `Your collection (${collection.length + collectionMore})` : null,
    weekAll ? `Closing this week (${weekAll})` : null,
    fresh?.total ? `New for you (${fresh.total})` : null,
    pickItems.length ? `The picks (${pickItems.length})` : null,
    names.length ? `Your names (${names.length} live)` : null,
    market.length ? `The market (${market.length})` : null,
  ].filter((x): x is string => !!x);
  // THE SUBJECT — the count + noun form when needs-you leads ("2 bids past your max"), never a period, ~60 chars
  const subjectLead = overMax.length ? `${overMax.length} ${overMax.length === 1 ? 'bid' : 'bids'} past your max` : lead;
  return {
    subject: cut(`Your desk: ${subjectLead}`, SUBJECT_MAX).replace(/[.\s]+$/, ''),
    welcome: input.lastSentOn == null,
    preheader: facts || 'Your watches, your names, what’s new and the market — every morning.',
    headline: `${lead[0].toUpperCase()}${lead.slice(1)}.`,
    glance, overMax, closing, results, resultsMore, edition, collection, collectionMore,
    // owned pieces are the collection, not watches: neither "watched" nor "settled" counts them
    watched: watches.filter(w => !w.owned).length, desk, deskMore, deskAbove, deskSettled: watches.filter(w => !w.owned && !live.has(baseId(w.lot_id))).length,
    pendingResults: Math.max(0, input.pendingResults ?? 0), week, fresh, picks: pickItems, names, quietNames, market,
  };
}

/** the pick's lane from the recommender's seed — the runner's one read of a Rec */
export function laneOf(r: { seed: { kind: string; label: string; follow?: unknown; broad?: boolean; market?: string; who?: string }; tier?: number; lane?: string }, who?: string | null): PickLane {
  const s = r.seed;
  // the recommender's discover lane ("New to you · modern football cards near Jalen Hurts's prices") is new to you,
  // whatever seed priced it — it used to sit under "Because you follow Jalen Hurts"
  if (s.market || (r.tier ?? 1) > 1 || r.lane === 'discover') return { kind: 'new', label: 'New to you' };
  if (s.kind === 'follow' && s.follow) return { kind: 'follow', label: `Because you follow ${cut(s.label, 48)}` };
  // a saved lot's handle: its maker line + the short title ("Pablo Picasso · Deux buveurs catalans"), capped at a whole
  // word. A settled watch has no lot behind its seed (the snapshot only), so the runner hands in the name it read
  // (the lot's entity, else the title's leading name: "Thomas Edison · Autograph Letter Signed…").
  if (s.kind === 'saved' || s.kind === 'owned') {
    const w = s.who || who || leadingNameOf(s.label);
    // a title that opens on the name splits there — only at a word break ("Tom Brady/Patrick Mahomes" stays whole)
    const rest = w && s.label.toLowerCase().startsWith(w.toLowerCase()) ? s.label.slice(w.length) : null;
    const label = !w ? s.label
      : rest == null ? `${w} · ${s.label}`
        : /^[\s:,–—-]/.test(rest) && rest.replace(/^[\s:,–—-]+/, '') ? `${w} · ${rest.replace(/^[\s:,–—-]+/, '')}` : s.label;
    return { kind: 'saved', label: `Because you ${s.kind === 'owned' ? 'own' : 'saved'} ${cut(label, 48)}`, who: s.kind === 'saved' ? w : null };
  }
  return { kind: 'new', label: 'New to you' };
}

/** a category follow's printed label from the taxonomy ("Fine Art · Prints & Multiples", "Science & Tech") */
export function catLabelOf(key: string): string {
  const [cat, sub] = key.split(':');
  return sub ? subEntityLabel(cat as CatKey, sub) : CAT_LABEL[cat as CatKey] || cat;
}

/** an owned piece's maker: the live lot's entity (lot-follow), else the saved_artist snapshot — the id the
 *  entity bucket is read by, and the printed name. The runner reads buckets for these ids too. */
export function ownedMakerOf(w: Pick<WatchRow, 'saved_artist'>, lot: AuctionLot | null, soldArtist?: string | null): { id: string | null; label: string | null } {
  if (lot) {
    const f = lotFollowOf(lot);
    if (f) return { id: entityIdOfFollow(f), label: f.label };
    const name = makerLineOf(lot).name;
    return { id: null, label: name || null };
  }
  const slug = w.saved_artist || soldArtist || '';
  if (!slug) return { id: null, label: null };
  const id = makerEntityId(slug);
  // a collection slug (science-tech, meteorites, game-used) is a category, not a maker: no name, no hammer line
  if (!id || id.startsWith('cs:')) return { id: null, label: null };
  return { id, label: ARTIST_LABEL[slug] || slug.split('-').map(x => x[0]?.toUpperCase() + x.slice(1)).join(' ') };
}

/** words a catalogue title puts right after the name — the name stops there */
const NAME_STOP = /^(?:Signed|Autograph|Autographed|Typed|Handwritten|Rare|Original|Vintage|Letter|Document|Photograph|Check|Flown|Archive|Collection|Set|Lot|Pair|Group|Game|Rookie|Card|Print|Poster|Limited|Framed|Inscribed|Personal|Early|Important|Large|Small|Fine|Custom)$/i;
/** the leading name of a title that opens on one ("Thomas Edison Autograph Letter Signed…" → "Thomas Edison";
 *  "Charles Lindbergh: Donald…" → "Charles Lindbergh"); null when the title opens on a year, a number or a lone word */
export function leadingNameOf(title: string | null | undefined): string | null {
  const t = String(title || '').trim();
  const head = t.split(/[:(–—]| - /)[0].trim();
  const words = head.split(/\s+/);
  const out: string[] = [];
  for (const w of words) {
    if (out.length >= 3 || NAME_STOP.test(w) || !/^(?:[A-Z][\w'’.-]*|[A-Z]\.?)$/.test(w) || /^\d/.test(w)) break;
    out.push(w);
  }
  if (out.length < 2) return null;
  return out.join(' ').replace(/[,.]+$/, '');
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
