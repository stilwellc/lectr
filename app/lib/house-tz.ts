/**
 * house-tz.ts — when a sale is over, read in the HOUSE's time zone (Oct 9).
 *
 * 13% of the live book carries a sale DAY but no close time (RR, Christie's
 * artist-page lots, Phillips, Wright/Rago/LAMA, Bonhams, Bruun). Those lots
 * used to be "live" until the end of that day on the READER's calendar — so a
 * Hong Kong reader lost a New York sale on its own afternoon, and a lot
 * stamped with a fake end-of-day hour (`T23:59`) printed hours it never had.
 *
 *   houseTzOf(lot)      the zone the sale is held in (house, sale code,
 *                       sale-name location, then sale currency)
 *   dayEndMs(day, tz)   the instant `day` ends in `tz`
 *   isDayStamp(lot)     a saleDateTime that only marks a DAY (Christie's www
 *                       writes the sale-location local midnight, `T04:00Z`)
 *   closeIsTimed(lot)   the lot carries a real close time
 *   closeMs(lot)        the close instant: the real time when there is one,
 *                       else the end of the sale day where the sale is held
 *   liveUntilMs(lot)    when an un-resulted lot stops being "live": a timed
 *                       close + LIVE_SLACK_MS (extended bidding, a live
 *                       session running through its lots), else the end of
 *                       the sale day in the house zone
 *   scheduledClose(lot) a close time from the house's PUBLISHED schedule for
 *                       a date-only lot (RR Auction: lots begin closing at
 *                       7:00 PM ET on the close day — its 30 Minute Rule)
 *
 * Pure (Intl only), shared by the client and the build.
 */

type TzLot = {
  id?: string | null;
  auctionHouse?: string | null;
  saleName?: string | null;
  currency?: string | null;
  nativeCurrency?: string | null;
  saleDate?: string | null;
  saleDateTime?: string | null;
};

const NY = 'America/New_York';
const LA = 'America/Los_Angeles';

/** single-room houses */
const HOUSE_TZ: Record<string, string> = {
  'RR Auction': NY, Goldin: NY, REA: NY, "Hake's": NY, 'Huggins & Scott': NY, SCP: LA,
  Lelands: NY, 'Memory Lane': LA, 'Love of the Game': NY, 'NFL Auction': NY, 'MLB Auctions': NY,
  Heritage: 'America/Chicago', Hindman: 'America/Chicago', Wright: 'America/Chicago', Rago: NY,
  LAMA: LA, "Julien's": LA, Propstore: LA, 'Bruun Rasmussen': 'Europe/Copenhagen',
};
/** Phillips sale codes open with the room: NY080426, HK010726, UK011126, CH080326 */
const PHILLIPS_CODE_TZ: Record<string, string> = {
  NY: NY, HK: 'Asia/Hong_Kong', UK: 'Europe/London', CH: 'Europe/Zurich', FR: 'Europe/Paris',
};
/** sale-name location → zone (Christie's "<Location> Sale <n>", Sotheby's names) */
const LOCATION_TZ: [RegExp, string][] = [
  [/\bnew york\b/i, NY],
  [/\blondon\b/i, 'Europe/London'],
  [/\bparis\b/i, 'Europe/Paris'],
  [/\bhong kong\b/i, 'Asia/Hong_Kong'],
  [/\b(geneva|gen[eè]ve|zurich|z[uü]rich)\b/i, 'Europe/Zurich'],
  [/\bmilan\b/i, 'Europe/Rome'],
  [/\bamsterdam\b/i, 'Europe/Amsterdam'],
  [/\bshanghai\b/i, 'Asia/Shanghai'],
  [/\bdubai\b/i, 'Asia/Dubai'],
  [/\bmonaco\b/i, 'Europe/Monaco'],
  [/\b(cologne|k[oö]ln)\b/i, 'Europe/Berlin'],
  [/\bmumbai\b/i, 'Asia/Kolkata'],
  [/\bcopenhagen\b/i, 'Europe/Copenhagen'],
  [/\b(los angeles|beverly hills)\b/i, LA],
];
/** a multi-room house's sale currency → its room. USD → Los Angeles: a US
 *  room is New York or LA, and the later end never hides a lot early. */
const CURRENCY_TZ: Record<string, string> = {
  USD: LA, GBP: 'Europe/London', EUR: 'Europe/Paris', CHF: 'Europe/Zurich', HKD: 'Asia/Hong_Kong',
  CNY: 'Asia/Shanghai', JPY: 'Asia/Tokyo', AUD: 'Australia/Sydney', DKK: 'Europe/Copenhagen',
  SEK: 'Europe/Stockholm', NOK: 'Europe/Oslo',
};

/** The zone the sale is held in. Unknown → Los Angeles (the latest US day end). */
export function houseTzOf(l: TzLot): string {
  const house = l.auctionHouse || '';
  if (HOUSE_TZ[house]) return HOUSE_TZ[house];
  if (house === 'Phillips') {
    const m = /^phillips-([A-Z]{2})\d/.exec(l.id || '');
    if (m && PHILLIPS_CODE_TZ[m[1]]) return PHILLIPS_CODE_TZ[m[1]];
  }
  if (l.saleName) for (const [re, tz] of LOCATION_TZ) if (re.test(l.saleName)) return tz;
  const cur = (l.nativeCurrency || l.currency || '').toUpperCase();
  return CURRENCY_TZ[cur] || LA;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    fmtCache.set(tz, f);
  }
  return f;
}
/** tz offset (ms, local − UTC) at instant `ms` */
function offsetAt(ms: number, tz: string): number {
  const p: Record<string, string> = {};
  for (const x of fmt(tz).formatToParts(new Date(ms))) p[x.type] = x.value;
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}
/** the instant local wall-clock `y-m-d h:mi` happens in `tz` */
export function zonedMs(y: number, m: number, d: number, h: number, mi: number, tz: string): number {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let t = guess - offsetAt(guess, tz);
  t = guess - offsetAt(t, tz); // re-read across a DST edge
  return t;
}
/** the house-local calendar day of instant `ms` */
export function localDayIn(ms: number, tz: string): string {
  const p: Record<string, string> = {};
  for (const x of fmt(tz).formatToParts(new Date(ms))) p[x.type] = x.value;
  return `${p.year}-${p.month}-${p.day}`;
}

const endCache = new Map<string, number>();
/** The instant calendar day `day` (YYYY-MM-DD) ends in `tz`. */
export function dayEndMs(day: string, tz: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const key = `${day}|${tz}`;
  let v = endCache.get(key);
  if (v === undefined) {
    const [y, m, d] = day.split('-').map(Number);
    v = zonedMs(y, m, d + 1, 0, 0, tz) - 1;
    endCache.set(key, v);
  }
  return v;
}

/** houses whose feeds hand genuine close instants — a `T00:00Z` there is a
 *  real moment (Sotheby's 7 PM EST evening sale = 00:00Z; NFL/MLB closes) */
const REAL_STAMP_HOUSES: ReadonlySet<string> = new Set(["Sotheby's", 'Goldin', 'NFL Auction', 'MLB Auctions', 'REA', "Hake's"]);

/** Christie's www writes a sale as the room's LOCAL MIDNIGHT in UTC, to the
 *  minute (London BST → `T23:00Z`, New York → `T04:00Z`); a bare `T00:00Z`
 *  (any house) is a day too. Neither is a close time. */
export function isDayStamp(l: TzLot): boolean {
  const s = (l.saleDateTime || '').trim();
  if (!s) return false;
  if (/T00:00(:00(\.000)?)?Z$/.test(s) && !REAL_STAMP_HOUSES.has(l.auctionHouse || '')) return true;
  return l.auctionHouse === "Christie's" && /^\d{4}-\d\d-\d\dT\d\d:00Z$/.test(s);
}

/** the house-local sale day a day stamp marks (Christie's: hour ≥ 12 UTC is the next day) */
export function dayOfDayStamp(s: string): string {
  const ms = Date.parse(s);
  if (isNaN(ms)) return s.slice(0, 10);
  const h = new Date(ms).getUTCHours();
  return new Date(h >= 12 ? ms + 864e5 : ms).toISOString().slice(0, 10);
}

/** true when the stamped close is a real clock time (not a day marker) */
export function closeIsTimed(l: TzLot): boolean {
  const s = l.saleDateTime;
  return !!s && /T\d{2}:\d{2}/.test(s) && !isDayStamp(l) && !isNaN(Date.parse(s));
}

/** The sale day for a date-only lot (saleDate, or the day a day stamp marks). */
function dayOnly(l: TzLot): string {
  const s = l.saleDateTime || '';
  if (s && isDayStamp(l)) return dayOfDayStamp(s);
  return (s || l.saleDate || '').slice(0, 10);
}

/** The close instant in epoch ms, or null when the lot carries no usable date.
 *  A date-only sale closes when its day ends where the sale is held. */
export function closeMs(l: TzLot): number | null {
  if (closeIsTimed(l)) return Date.parse(l.saleDateTime as string);
  return dayEndMs(dayOnly(l), houseTzOf(l));
}

/** How long after a timed close an un-resulted lot still reads live.
 *   'online'  (crawler-stamped: Phillips online, Bonhams ONLINE) — the stamp
 *             is when lots BEGIN closing one by one: 3h covers the stagger.
 *   'session' (crawler-stamped: Phillips / Bonhams live rooms) — the stamp is
 *             the session START; the room works through its lots, so live
 *             through the end of that sale day where it is held (and at
 *             least 8h, an evening sale running past midnight).
 *   unmarked  (Goldin, REA, NFL/MLB, Sotheby's, RR's schedule) — 8h: Goldin's
 *             extended bidding runs to ~5 AM ET after a 10 PM close. */
export const ONLINE_SLACK_MS = 3 * 3_600_000;
export const LIVE_SLACK_MS = 8 * 3_600_000;

type KindLot = TzLot & { closeKind?: 'online' | 'session' | null };

/** When an un-resulted upcoming lot stops being live (epoch ms), or null. */
export function liveUntilMs(l: KindLot): number | null {
  if (closeIsTimed(l)) {
    const t = Date.parse(l.saleDateTime as string);
    if (l.closeKind === 'online') return t + ONLINE_SLACK_MS;
    if (l.closeKind === 'session') {
      const tz = houseTzOf(l);
      return Math.max(t + LIVE_SLACK_MS, dayEndMs(localDayIn(t, tz), tz) ?? 0);
    }
    return t + LIVE_SLACK_MS;
  }
  return dayEndMs(dayOnly(l), houseTzOf(l));
}

/** RR Auction's published close: on the close day, at 7:00 PM ET the 30 Minute
 *  Rule starts and lots close one by one (a lot with no bid closes at 7:00 PM
 *  sharp) — rrauction.com/buy/30-minute-rule. The gallery countdown prints only
 *  the MM/DD, so this is the one close time an RR lot can honestly carry. */
const RR_CLOSE_HOUR = 19;

/** A close time from the house's published schedule, for a date-only lot; null
 *  when the house publishes none (Christie's, Phillips live, Wright…). */
export function scheduledClose(l: TzLot): string | null {
  if (l.saleDateTime || !l.saleDate || !/^\d{4}-\d{2}-\d{2}/.test(l.saleDate)) return null;
  if (l.auctionHouse !== 'RR Auction') return null;
  const [y, m, d] = l.saleDate.slice(0, 10).split('-').map(Number);
  const ms = zonedMs(y, m, d, RR_CLOSE_HOUR, 0, NY);
  const off = Math.round((Date.UTC(y, m - 1, d, RR_CLOSE_HOUR) - ms) / 60000); // minutes, local − UTC
  const sign = off < 0 ? '-' : '+';
  const a = Math.abs(off);
  return `${l.saleDate.slice(0, 10)}T${RR_CLOSE_HOUR}:00:00${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}

/** Client-side normalization of the served close stamps (idempotent): a day
 *  stamp is dropped (the lot is date-only; saleDate already carries the
 *  sale-local day) and a published house schedule fills a missing time. */
export function normalizeCloseStamp<T extends TzLot>(l: T): T {
  if (l.saleDateTime && isDayStamp(l)) {
    const day = dayOfDayStamp(l.saleDateTime);
    l.saleDateTime = undefined;
    if (!l.saleDate) l.saleDate = day;
  }
  if (!l.saleDateTime) {
    const s = scheduledClose(l);
    if (s) l.saleDateTime = s;
  }
  return l;
}
