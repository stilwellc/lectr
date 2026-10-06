/**
 * sale-day.ts — the calendar day a sale happened, read in the SALE'S time zone.
 *
 * Every house feed hands us a UTC instant (or a naive stamp that is UTC). The
 * old parsers took `iso.split('T')[0]` — the UTC calendar day — which is the
 * wrong day for any sale whose local evening/midnight straddles UTC midnight:
 *
 *   · Goldin closes at 10 PM ET (weekly: Thursday; TCG: Sunday — auctionreport.com
 *     "Goldin Weekly Auctions End Every Thursday Night at 10 PM ET"). 22:00 EDT
 *     is 02:00Z the NEXT day, so 369,558 Goldin lots sat one day late (a
 *     Thursday sale dated Friday). Extended bidding runs past midnight ET
 *     (04:00–09:00Z) — those lots still belong to that night's sale, so any
 *     close before 06:00 ET counts to the previous evening.
 *   · Christie's www.christies.com stamps a sale as LOCAL MIDNIGHT of the sale
 *     location, written in UTC to the minute: London BST 23:00Z, Geneva/Paris
 *     22:00Z, Hong Kong 16:00Z, Dubai 20:00Z (Important Watches, Dubai, 22 Mar
 *     2019 arrives as 2019-03-21T20:00Z), New York 04:00Z/05:00Z, or a bare
 *     date at 00:00Z. The UTC day of an east-of-UTC midnight is the day BEFORE
 *     (20,831 lots, $1.98B, a day early). onlineonly gives genuine close times
 *     (seconds + millis) — those are read in the sale-location zone.
 *   · Sotheby's gives genuine opening/close instants: the Now & Contemporary
 *     Evening Auction, New York, 18 Nov 2025 7 PM EST is 2025-11-19T00:00Z;
 *     NBA weekly finals close 9:30 PM ET = 01:30Z next day (5,147 lots).
 *
 * Pure, dependency-free (Intl only). Returns null when the house is not one
 * whose dates this module owns or the stamp is unreadable — callers keep the
 * date they had.
 */

const CURRENCY_TZ: Record<string, string> = {
  USD: 'America/New_York', GBP: 'Europe/London', EUR: 'Europe/Paris', CHF: 'Europe/Zurich',
  HKD: 'Asia/Hong_Kong', CNY: 'Asia/Shanghai', RMB: 'Asia/Shanghai', JPY: 'Asia/Tokyo',
  SGD: 'Asia/Singapore', AUD: 'Australia/Sydney', AED: 'Asia/Dubai', INR: 'Asia/Kolkata',
};

// sale location (Christie's saleName "<Location> Sale <n>") → zone
const LOCATION_TZ: [RegExp, string][] = [
  [/\bnew york\b/i, 'America/New_York'],
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
];

export const SALE_DAY_HOUSES: ReadonlySet<string> = new Set(['Goldin', "Christie's", "Sotheby's"]);

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    fmtCache.set(tz, f);
  }
  return f;
}

/** local wall-clock parts of instant `ms` in `tz` */
function localParts(ms: number, tz: string): { day: string; hms: string; hour: number } {
  const p: Record<string, string> = {};
  for (const x of fmt(tz).formatToParts(new Date(ms))) p[x.type] = x.value;
  return { day: `${p.year}-${p.month}-${p.day}`, hms: `${p.hour}:${p.minute}:${p.second}`, hour: Number(p.hour) };
}

const HAS_ZONE = /(?:Z|[+-]\d\d:?\d\d)$/i;
/** Parse a feed stamp to epoch ms. A naive stamp (no zone) is UTC — measured:
 *  Goldin's naive microsecond stamps share the Z stamps' hour profile. */
export function parseStamp(s: string): number {
  const t = s.trim();
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(t)) return NaN;
  return Date.parse(HAS_ZONE.test(t) ? t : `${t}Z`);
}

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The sale-location zone for a lot, or null when unknown. */
export function saleTimeZone(house: string, ctx: { saleName?: string | null; currency?: string | null } = {}): string | null {
  if (house === 'Goldin') return 'America/New_York';
  if (house === "Christie's" && ctx.saleName) {
    // "<Location> Sale <number>" (the www search feed) names the room
    const m = /^(.+?)\s+Sale\s+\d+/i.exec(ctx.saleName);
    if (m) for (const [re, tz] of LOCATION_TZ) if (re.test(m[1])) return tz;
  }
  return (ctx.currency && CURRENCY_TZ[ctx.currency.toUpperCase()]) || null;
}

/**
 * The calendar day of the sale for a house stamp, or null (not ours / no stamp).
 * Goldin   — ET; a close before 06:00 ET is the previous night's sale.
 * Christie's — a minute-precision www stamp on the hour is a local-midnight
 *   (or bare-date at 00:00Z) marker: UTC hour ≥ 12 → the next UTC day (a zone
 *   east of UTC), else the UTC day. Any other stamp is a genuine instant, read
 *   in the sale-location zone.
 * Sotheby's — a genuine instant, read in the sale-currency zone.
 * No known zone → the UTC day (unchanged legacy behaviour).
 */
export function saleDayOf(house: string, stamp: string | null | undefined, ctx: { saleName?: string | null; currency?: string | null } = {}): string | null {
  if (!stamp || !SALE_DAY_HOUSES.has(house)) return null;
  const ms = parseStamp(stamp);
  if (!Number.isFinite(ms)) return null;
  if (house === 'Goldin') {
    const lp = localParts(ms, 'America/New_York');
    return lp.hour < 6 ? localParts(ms - 6 * 3600e3, 'America/New_York').day : lp.day;
  }
  if (house === "Christie's") {
    const m = /^\d{4}-\d\d-\d\dT(\d\d):(\d\d)Z$/.exec(stamp.trim());
    if (m && m[2] === '00') {
      const h = Number(m[1]);
      return h >= 12 ? utcDay(ms + 24 * 3600e3) : utcDay(ms);
    }
  }
  const tz = saleTimeZone(house, ctx);
  return tz ? localParts(ms, tz).day : utcDay(ms);
}
