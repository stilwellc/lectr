/**
 * YOUR WEEK (THE DESK v3, Oct 11 2026) — the hammer timeline's reads, with
 * no React in them: which of the reader's lots close on which day over the
 * next 14 days, what each day adds up to, where two of their closes
 * collide, and which of them are inside 24 hours (the Closing-now strip).
 *
 * One clock: every read takes `now` (the page's desk.now) — never Date.now().
 *
 * THE DAY A LOT LANDS ON
 *   timed close     the reader's local calendar day of the close instant
 *                   (house-tz closeMs — a Goldin 10 PM ET close is Oct 25 to
 *                   a New York reader and Oct 26 to a London one; each sees
 *                   their own evening)
 *   date-only sale  the sale DAY where it is held (house-tz houseCloseDayOf):
 *                   the house published a day, not an hour, so the row says
 *                   the day and never an invented time
 * A lot is on the week only while it is on the block (utils.isOnBlock) and
 * its close is still ahead of `now`.
 *
 * WHOSE LOTS
 *   watch   a saved lot (desk.saved) — "yours"
 *   pick    a current pick (desk.recs) not already watched — "yours"
 *   name    a live lot by a name the reader follows or owns a piece by
 *           (your-market.marketNamesOf: maker / player / subject follows
 *           and the owned pieces' names — never a category or a house
 *           follow, which would pour a whole market onto the week)
 * A lot prints once, under its strongest claim (watch > pick > name).
 *
 * THE VIEW (Oct 11 review, R1#15: picks outnumbered watches 2:1 in "my"
 * week) — the plan always holds everything; what the columns SHOW is a
 * view of it: watches + names by default, picks behind "Show picks (N)"
 * (remembered on the device). A desk with no watch on the week shows its
 * picks by default — hiding them would hide the only rows there are.
 * viewOf() cuts the view; the rail's count, the head's sub-line and the
 * toggle's number read the full plan.
 *
 * CONFLICTS  two WATCHED lots with real close times inside 30 minutes of
 *            each other, from different sales (priority.saleKeyOf — forty
 *            lots of one Goldin night all close at 10 PM by design; that is
 *            one session, not a collision).
 *
 * TOTALS     "at estimate midpoint" sums (low + high) / 2 over YOUR rows
 *            (watches and picks — never the names' sales, which would print
 *            a Warhol evening as your money) that carry BOTH bounds; a
 *            one-sided estimate (RR's "from $2,000") is counted as unpriced,
 *            so the head says "$212K · 3 of 4 priced".
 *            TODO(X1): the shell is exporting ONE "priced" helper (both
 *            bounds = priced; one-sided = "from $X", never summed) from
 *            app/profile/desk — import it here in place of estMidOf as soon
 *            as it is on main; the rule below is that rule, kept local only
 *            until then.
 */
import type { AuctionLot } from '../../types';
import type { Follow } from '../../lib/follows';
import { affinityOf } from '../../lib/follows';
import { marketNamesOf } from '../../lib/your-market';
import { entityIdOf } from '../../lib/entity/live';
import { closeMsOf, priorityOf, saleKeyOf } from '../../lib/priority';
import { closeIsTimed, houseCloseDayOf, houseTzOf, localDayIn } from '../../lib/house-tz';
import { isOnBlock } from '../../utils';

export const WEEK_DAYS = 14;
export const CONFLICT_MS = 30 * 60_000;
export const DAY_MS = 86_400_000;
/** the Closing-now strip's window */
export const CLOSING_NOW_MS = 24 * 3_600_000;
/** rows a day opens on before "+N more": this many watches, then picks and name rows —
 *  "+N more" opens the rest; the desk stays scannable at seven columns */
export const WATCH_ROWS_OPEN = 3;
export const PICK_ROWS_OPEN = 3;
export const NAME_ROWS_OPEN = 2;

export type WeekKind = 'watch' | 'pick' | 'name';

export interface WeekRow {
  lot: AuctionLot;
  kind: WeekKind;
  /** the followed / owned name a 'name' row rode in on */
  name: string | null;
  /** the name is one the reader owns a piece by (not only follows) */
  owned: boolean;
  /** how many pieces in the collection file under that name (0 for a follow) */
  ownedN: number;
  /** the close instant (house-tz closeMs) */
  closeMs: number;
  /** the lot carries a real close time (false: a date-only sale) */
  timed: boolean;
  /** the day the row lands on (YYYY-MM-DD; see the file head) */
  day: string;
  /** (low + high) / 2 when both bounds are published, else null */
  estMid: number | null;
  /** watched lots whose timed close is within CONFLICT_MS of this one, from another sale */
  conflictWith: string[];
}

export interface WeekDay {
  day: string;
  /** 0 = today, 1 = tomorrow … */
  offset: number;
  rows: WeekRow[];
  yours: number;
  names: number;
  /** Σ estMid over your priced rows (watches + picks with both bounds) */
  estTotal: number;
  priced: number;
  /** conflict pairs on the day */
  conflicts: number;
  /** rows the VIEW cut from this day (picks behind the toggle) — the day
   *  card says "3 picks · hidden" instead of "Nothing of yours" (Oct 29: a
   *  day with only hidden picks read as empty while the strip drew its bar) */
  hidden: number;
}

export interface WeekPlan {
  /** WEEK_DAYS days from the reader's today, empty days included (gaps are gaps) */
  days: WeekDay[];
  rows: WeekRow[];
  yours: number;
  /** watches / picks on the week */
  watches: number;
  picks: number;
  /** name rows and the names they came in under (those with ≥ 1 row) */
  nameRows: number;
  names: string[];
  estTotal: number;
  priced: number;
  conflicts: number;
  /** your lots (watch / pick) that close AFTER the window — and the first of them */
  beyond: number;
  nextBeyond: WeekRow | null;
  /** the first of your rows on the week (null: none) */
  first: WeekRow | null;
  /** the window's local-day keys, D0 … D13 */
  dayKeys: string[];
}

export interface WeekInput {
  now: number;
  saved: readonly AuctionLot[];
  savedIds: ReadonlySet<string>;
  recs: readonly { lot: AuctionLot }[];
  book: readonly AuctionLot[];
  follows: readonly Follow[];
  collection: readonly AuctionLot[];
}

const pad = (n: number) => String(n).padStart(2, '0');

/** the reader's local calendar day of an instant */
export function localDayOf(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** YYYY-MM-DD `n` days after `day` (calendar arithmetic at UTC noon — DST-safe) */
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** the window's day keys from the reader's today */
export function dayKeysOf(now: number, n = WEEK_DAYS): string[] {
  const d0 = localDayOf(now);
  return Array.from({ length: n }, (_, i) => addDays(d0, i));
}

/** the day the row lands on — the reader's day for a timed close, the house's sale day for a date-only one */
export function weekDayOf(lot: AuctionLot, closeMs: number, timed: boolean): string {
  return timed ? localDayOf(closeMs) : houseCloseDayOf(lot);
}

/** (low + high) / 2 when BOTH bounds are published, else null — the one
 *  "priced" rule (see the file head's TODO: X1's shared export replaces this) */
export function estMidOf(lot: AuctionLot): number | null {
  const lo = lot.estLowUsd ?? lot.estimateLow ?? null;
  const hi = lot.estHighUsd ?? lot.estimateHigh ?? null;
  return lo && hi && lo > 0 && hi > 0 ? (lo + hi) / 2 : null;
}

/** one row, or null when the lot is not a live close ahead of `now` */
export function rowOf(lot: AuctionLot, kind: WeekKind, now: number, today: string, name: string | null = null, ownedN = 0): WeekRow | null {
  if (lot.status !== 'upcoming') return null;
  const closeMs = closeMsOf(lot);
  if (closeMs == null || closeMs <= now) return null;
  if (!isOnBlock(lot, today, now)) return null;
  const timed = closeIsTimed(lot);
  return { lot, kind, name, owned: ownedN > 0, ownedN, closeMs, timed, day: weekDayOf(lot, closeMs, timed), estMid: estMidOf(lot), conflictWith: [] };
}

/** the reader's watched lots as rows, soonest first (every live watch — no window) */
export function watchRows(saved: readonly AuctionLot[], now: number): WeekRow[] {
  const today = localDayOf(now);
  const out: WeekRow[] = [];
  const seen = new Set<string>();
  for (const l of saved) {
    if (seen.has(l.id)) continue;
    seen.add(l.id);
    const r = rowOf(l, 'watch', now, today);
    if (r) out.push(r);
  }
  out.sort(byClose);
  markConflicts(out);
  return out;
}

/** timed rows in close order, then the date-only rows (the day's "day only"
 *  tail) in close order; a tie keeps watch before pick before name */
const KIND_RANK: Record<WeekKind, number> = { watch: 0, pick: 1, name: 2 };
export function byClose(a: WeekRow, b: WeekRow): number {
  if (a.timed !== b.timed) return a.timed ? -1 : 1;
  return (a.closeMs - b.closeMs) || (KIND_RANK[a.kind] - KIND_RANK[b.kind]) || a.lot.id.localeCompare(b.lot.id);
}

/** mark the watched, timed rows that close within CONFLICT_MS of another
 *  watched, timed row from a different sale (both sides are marked) */
export function markConflicts(rows: WeekRow[]): number {
  const w = rows.filter(r => r.kind === 'watch' && r.timed).sort((a, b) => a.closeMs - b.closeMs);
  let n = 0;
  for (let i = 0; i < w.length; i++) {
    for (let j = i + 1; j < w.length && w[j].closeMs - w[i].closeMs <= CONFLICT_MS; j++) {
      if (saleKeyOf(w[i].lot) === saleKeyOf(w[j].lot)) continue;
      w[i].conflictWith.push(w[j].lot.id);
      w[j].conflictWith.push(w[i].lot.id);
      n++;
    }
  }
  return n;
}

/** the reader's names (your-market's roster minus category follows), with
 *  a matcher per name; `owned` = a piece in the collection files under it */
export function weekNamesOf(follows: readonly Follow[], collection: readonly AuctionLot[]): { label: string; owned: boolean; ownedN: number; match: (l: AuctionLot, ek: string | null) => boolean }[] {
  return marketNamesOf(follows, collection as Parameters<typeof marketNamesOf>[1])
    .filter(n => n.follow.kind !== 'cat' && n.follow.kind !== 'house')
    .map(n => ({
      label: n.label,
      owned: n.owned > 0,
      ownedN: n.owned,
      match: n.id
        ? (_l: AuctionLot, ek: string | null) => ek === n.id
        : (l: AuctionLot) => affinityOf(l, [n.follow]) > 0,
    }));
}

/** the week: WEEK_DAYS days from the reader's today, every lot of theirs that
 *  closes in them, day by day */
export function planWeek(input: WeekInput): WeekPlan {
  const { now } = input;
  const keys = dayKeysOf(now);
  const today = keys[0];
  const keySet = new Set(keys);
  // the window's end on the reader's clock: the start of day 15 — a date-only
  // lot is judged by its day key instead (its house day may end hours later)
  const [y, m, d] = addDays(today, WEEK_DAYS).split('-').map(Number);
  const windowEnd = new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
  const inWindow = (r: WeekRow) => (r.timed ? r.closeMs < windowEnd : keySet.has(r.day));

  const taken = new Set<string>();
  const rows: WeekRow[] = [];
  const beyondRows: WeekRow[] = [];
  const take = (r: WeekRow | null) => {
    if (!r || taken.has(r.lot.id)) return;
    taken.add(r.lot.id);
    if (inWindow(r)) rows.push(r);
    else if (r.kind !== 'name') beyondRows.push(r);
  };
  for (const l of input.saved) take(rowOf(l, 'watch', now, today));
  for (const r of input.recs) if (!input.savedIds.has(r.lot.id)) take(rowOf(r.lot, 'pick', now, today));

  const names = weekNamesOf(input.follows, input.collection);
  if (names.length) {
    const horizon = windowEnd + DAY_MS; // a date-only lot's house day can end after the local window
    for (const l of input.book) {
      if (l.status !== 'upcoming' || taken.has(l.id)) continue;
      const c = closeMsOf(l);
      if (c == null || c <= now || c > horizon) continue;
      // the entity key once per lot (the build's `ek`, else computed) — only
      // for a lot already inside the window
      let ek: string | null | undefined;
      for (const n of names) {
        if (ek === undefined) ek = entityIdOf(l);
        if (!n.match(l, ek)) continue;
        take(rowOf(l, 'name', now, today, n.label, n.ownedN));
        break;
      }
    }
  }

  const conflicts = markConflicts(rows);
  rows.sort(byClose);

  const days: WeekDay[] = keys.map((day, offset) => ({ day, offset, rows: [], yours: 0, names: 0, estTotal: 0, priced: 0, conflicts: 0, hidden: 0 }));
  const byDay = new Map(days.map(d => [d.day, d]));
  for (const r of rows) {
    const d = byDay.get(r.day);
    if (!d) continue;
    d.rows.push(r);
    if (r.kind === 'name') d.names++;
    else {
      d.yours++;
      if (r.estMid != null) { d.estTotal += r.estMid; d.priced++; }
    }
  }
  // conflict pairs per day: each pair is counted from both of its rows
  for (const d of days) {
    let ends = 0;
    for (const r of d.rows) ends += r.conflictWith.length;
    d.conflicts = Math.ceil(ends / 2);
  }
  // a day's name rows rank by the ranker's score (the strongest open the
  // fold); your rows keep the close order ahead of them
  for (const d of days) {
    d.rows.sort((a, b) => {
      if ((a.kind === 'name') !== (b.kind === 'name')) return a.kind === 'name' ? 1 : -1;
      if (a.kind === 'name') {
        const s = (priorityOf(b.lot as Parameters<typeof priorityOf>[0], now)?.score ?? 0) - (priorityOf(a.lot as Parameters<typeof priorityOf>[0], now)?.score ?? 0);
        if (s) return s;
      }
      return byClose(a, b);
    });
  }

  beyondRows.sort(byClose);
  const yoursRows = rows.filter(r => r.kind !== 'name');
  const labels = new Set<string>();
  for (const r of rows) if (r.name) labels.add(r.name);
  return {
    days, rows,
    yours: yoursRows.length,
    watches: rows.filter(r => r.kind === 'watch').length,
    picks: rows.filter(r => r.kind === 'pick').length,
    nameRows: rows.length - yoursRows.length,
    names: Array.from(labels),
    estTotal: days.reduce((s, d) => s + d.estTotal, 0),
    priced: days.reduce((s, d) => s + d.priced, 0),
    conflicts,
    beyond: beyondRows.length,
    nextBeyond: beyondRows[0] ?? null,
    first: yoursRows.slice().sort((a, b) => a.closeMs - b.closeMs)[0] ?? null,
    dayKeys: keys,
  };
}

/* ── the view: what the columns show ── */

export interface WeekView {
  /** picks are shown (false: watches + names only) */
  picks: boolean;
}

/** the device's remembered choice, or — with no watch on the week — the
 *  picks (the only rows of yours there are) */
export function pickDefault(plan: Pick<WeekPlan, 'watches'>, remembered: boolean | null): boolean {
  if (remembered != null) return remembered;
  return plan.watches === 0;
}

/** THE TAB'S LEAD — the count of yours the room LISTS: watches + picks while
 *  the picks show; watches alone while the device hides them (the room then
 *  says "N picks · hidden" and the tab must not count rows it does not list) */
export function weekLeadOf(plan: Pick<WeekPlan, 'yours' | 'watches'>, showPicks: boolean): number {
  return showPicks ? plan.yours : plan.watches;
}

/** the plan as the columns show it: with `picks` off, the pick rows are cut
 *  and every day's count / total is re-read over what is left (a day head
 *  never counts a row it does not show); the plan's own totals (watches,
 *  picks, estTotal, beyond …) are the week's facts and stay on the plan */
export function viewOf(plan: WeekPlan, view: WeekView): WeekPlan {
  if (view.picks) return plan;
  const keep = (r: WeekRow) => r.kind !== 'pick';
  const rows = plan.rows.filter(keep);
  const days = plan.days.map(d => {
    const kept = d.rows.filter(keep);
    let estTotal = 0, priced = 0, yours = 0;
    for (const r of kept) if (r.kind !== 'name') { yours++; if (r.estMid != null) { estTotal += r.estMid; priced++; } }
    return { ...d, rows: kept, yours, estTotal, priced, hidden: d.rows.length - kept.length };
  });
  const yoursRows = rows.filter(r => r.kind !== 'name');
  return {
    ...plan, days, rows,
    yours: yoursRows.length, picks: 0,
    estTotal: days.reduce((s, d) => s + d.estTotal, 0),
    priced: days.reduce((s, d) => s + d.priced, 0),
    first: yoursRows.slice().sort((a, b) => a.closeMs - b.closeMs)[0] ?? null,
  };
}

/** the words beside a name row's name: "you own 1" / "you own 3" (null for a follow) */
export function ownedWords(r: Pick<WeekRow, 'kind' | 'ownedN'>): string | null {
  if (r.kind !== 'name' || r.ownedN <= 0) return null;
  return `you own ${r.ownedN}`;
}

/* ── the Closing-now strip ── */

export interface ClosingNowRead {
  /** watched lots closing inside CLOSING_NOW_MS, soonest first */
  rows: WeekRow[];
  /** the next watched close after the window (null: none live) */
  next: WeekRow | null;
  /** live watches in all */
  live: number;
}

export function closingNowOf(saved: readonly AuctionLot[], now: number): ClosingNowRead {
  const all = watchRows(saved, now);
  const until = now + CLOSING_NOW_MS;
  const rows = all.filter(r => r.closeMs <= until).sort((a, b) => a.closeMs - b.closeMs);
  const next = all.filter(r => r.closeMs > until).sort((a, b) => a.closeMs - b.closeMs)[0] ?? null;
  return { rows, next, live: all.length };
}

/* ── words ── */

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Sun" / "Oct 11" for a day key (calendar words — no zone involved) */
export function dayWords(day: string): { wd: string; md: string; dayNum: number } {
  const [y, m, d] = day.split('-').map(Number);
  const wd = WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return { wd, md: `${MO[m - 1]} ${d}`, dayNum: d };
}

/** calendar days from the reader's today to a day key (0 today, 1 tomorrow) */
export function dayOffsetOf(day: string, now: number): number {
  return Math.round((Date.parse(`${day}T12:00:00Z`) - Date.parse(`${localDayOf(now)}T12:00:00Z`)) / DAY_MS);
}

/** "today" / "tomorrow" / null for a day offset */
export function offsetWord(offset: number): string | null {
  return offset === 0 ? 'today' : offset === 1 ? 'tomorrow' : null;
}

/** the reader-local clock time of an instant: "7:00 PM" */
export function localClock(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** the house's own clock for the same instant, with its city: "7:00 PM New York"
 *  (null when the house zone prints the same wall time as the reader's) */
export function houseClock(lot: AuctionLot, ms: number): string | null {
  const tz = houseTzOf(lot);
  const house = new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz });
  if (house === localClock(ms) && localDayIn(ms, tz) === localDayOf(ms)) return null;
  return `${house} ${cityOf(tz)}`;
}

/** "America/New_York" → "New York" */
export function cityOf(tz: string): string {
  return (tz.split('/').pop() || tz).replace(/_/g, ' ');
}

/** "in 3h 10m" / "in 12m" / "closing now" — minutes, never seconds */
export function countdownText(closeMs: number, now: number): string {
  const ms = closeMs - now;
  if (ms <= 0) return 'closing now';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h >= 48) return `in ${Math.round(ms / DAY_MS)} days`;
  return h > 0 ? `in ${h}h ${m}m` : `in ${m}m`;
}

/** "+3 bids · 24h" when the engine measured a velocity (Goldin live lots), else null */
export function velocityText(lot: AuctionLot): string | null {
  const v = lot.bidVelocity;
  if (!v || !(v.delta > 0)) return null;
  return `+${v.delta} ${v.delta === 1 ? 'bid' : 'bids'} · ${Math.round(v.hours)}h`;
}

/** "15 bids" / "1 bid" / null */
export function bidsText(lot: AuctionLot): string | null {
  const n = lot.bidCount;
  if (typeof n !== 'number' || n <= 0) return null;
  return `${n} ${n === 1 ? 'bid' : 'bids'}`;
}
