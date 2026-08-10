/**
 * validate.ts — the write-time DATA-HONESTY gate (spec §4, W10).
 *
 * assertInvariants(lots) runs over the merged lot set right before the crawler
 * writes JSON and RETURNS the violations it finds — it throws nothing itself.
 * The crawler decides what to do: if `fatal` is non-empty it aborts the write
 * (a bad publish is worse than a stale one — data honesty > a fresh feed);
 * `warn` is logged and the crawl proceeds. Keeping the policy (throw) at the
 * call site and the detection (pure) here means the same function can be run in
 * a test, a dry-run migration diff, or CI without side effects.
 *
 * The invariants encode the v2 doctrine: a SOLD lot is a fact (realizedUsd>0 +
 * a priceBasis + a real, non-future saleDate); a NON-SOLD lot has NULL price
 * fields (no priced bought-ins or upcoming); every *Usd view equals native ×
 * the row's dated fxRate; estimate and price are compared only when they share
 * a unit; the id namespace matches the selling house; saleDate is one canonical
 * shape. Each is checked additively/alias-safely so a pre-migration row (old
 * fields only) and a migrated row (canonical fields) both validate correctly.
 */
import { AuctionLot, AuctionHouse } from '../types';

export interface InvariantReport {
  fatal: string[];
  warn: string[];
}

/** Canonical id-prefix slugs per selling house (invariant 6). Rago crawls via
    Wright's stack but its ids renamespace to `rago-*`; every other house uses a
    lowercased slug of its name. A lot's id must begin with one of its house's
    slugs. `platform` (e.g. wright for a Rago lot) is provenance, not identity. */
const HOUSE_ID_SLUGS: Record<AuctionHouse, string[]> = {
  Phillips: ['phillips'],
  "Sotheby's": ['sothebys', 'sotheby'],
  "Christie's": ['christies', 'christie'],
  Wright: ['wright'],
  // Rago lots are crawled by the Wright adapter (one operator, one platform —
  // corpus-io maps both houses to the `wright` segment), so they are minted with
  // `wright-` ids. restamp-rago fixed the house field but deliberately did NOT
  // rename the id: `/lot/<id>` is a permalink, and useSavedLots and the
  // never-deleting Supabase mirror are both keyed on it. The prefix is therefore
  // a legitimate provenance artifact here, not the crosstalk this invariant
  // exists to catch.
  Rago: ['rago', 'wright'],
  // LAMA (Los Angeles Modern Auctions) joined the Rago/Wright group in 2021 and
  // sells on the same Laravel/Inertia stack, but it is NOT Rago: it mints its
  // own clean `lama-` ids (no permalink history to preserve), crawled by
  // crawlLama and filed in the shared `wright` segment (one operator, one
  // crawl job — see corpus-io HOUSE_TO_SEGMENT).
  LAMA: ['lama'],
  Heritage: ['heritage', 'ha'],
  Bonhams: ['bonhams'],
  Hindman: ['hindman'],
  Goldin: ['goldin'],
  'RR Auction': ['rrauction', 'rr'],
};

const SALE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The set of money fields that MUST be null on a non-sold lot (invariant 2).
    Read alias-safely: a pre-migration bought-in with a stray priceUsd is caught
    exactly as a post-migration one with a stray realizedUsd. */
function priceFieldsPresent(l: AuctionLot): string[] {
  const present: string[] = [];
  const check: [string, number | null | undefined][] = [
    ['realizedUsd', l.realizedUsd],
    ['realizedNative', l.realizedNative],
    ['hammerUsd', l.hammerUsd],
    ['hammerNative', l.hammerNative],
    ['premiumUsd', l.premiumUsd],
    ['premiumNative', l.premiumNative],
    ['hammerPrice', l.hammerPrice],
    ['premiumPrice', l.premiumPrice],
    ['priceUsd', l.priceUsd],
  ];
  for (const [name, v] of check) {
    if (v !== null && v !== undefined) present.push(name);
  }
  return present;
}

/** The realized USD the value math actually reads, alias-safe: realizedUsd
    (canonical) falls back to priceUsd (its migration alias). */
function realizedUsdOf(l: AuctionLot): number | null | undefined {
  return l.realizedUsd ?? l.priceUsd;
}

/** True when a date string is a real, parseable, non-future calendar date.
    "Future" is DAY-granular, string-compared like FATAL-3: saleDate parses to
    UTC midnight, so the old instant compare against `now` read a same-day
    Asia-Pacific sale (locally today, dated tomorrow in UTC terms) as future
    and aborted the whole publish until 00:00 UTC. A sold sale dated within
    one day ahead of UTC-today is a legitimate timezone artifact, not a lie. */
function isRealNonFutureDate(saleDate: string | null | undefined, now: number): boolean {
  if (!saleDate) return false;
  if (isNaN(new Date(saleDate).getTime())) return false;
  const saleStr = saleDate.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(saleStr)) return false;
  const tomorrowStr = new Date(now + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return saleStr <= tomorrowStr;
}

/** Within-±1-unit equality for a derived *Usd view against native × fxRate.
    Returns null (skip) when a factor is absent — invariant 4 only fires when
    both the native amount and the rate exist to check against. */
function usdMatchesNative(
  usd: number | null | undefined,
  native: number | null | undefined,
  fxRate: number | undefined,
): boolean | null {
  if (usd == null || native == null || fxRate == null) return null;
  return Math.abs(usd - native * fxRate) <= 1;
}

/**
 * Collect every invariant violation across the lot set. Pure: no throws, no I/O.
 * `now` is injectable for deterministic tests (defaults to Date.now()).
 */
export function assertInvariants(lots: AuctionLot[], now: number = Date.now()): InvariantReport {
  const fatal: string[] = [];
  const warn: string[] = [];

  // WARN-rate accumulators (spec §4: log, don't abort — coverage regressions)
  let formKeyNull = 0;
  let soldNoEstUsd = 0;
  let fingerprintNull = 0;
  let sold = 0;

  for (const l of lots) {
    const id = l.id || '<no-id>';
    const isSold = l.status === 'sold';

    // ── FATAL 1 · a sold lot is a FACT ──────────────────────────────────────
    if (isSold) {
      sold++;
      const rUsd = realizedUsdOf(l);
      if (!(typeof rUsd === 'number' && rUsd > 0)) {
        fatal.push(`[1] ${id}: sold lot has no realizedUsd>0 (got ${rUsd ?? 'null'})`);
      }
      if (l.priceBasis == null) {
        fatal.push(`[1] ${id}: sold lot missing priceBasis`);
      }
      if (!isRealNonFutureDate(l.saleDate, now)) {
        fatal.push(`[1] ${id}: sold lot has no real non-future saleDate (got ${l.saleDate ?? 'null'})`);
      }
    }

    // ── FATAL 2 · a non-sold lot has NULL price fields ──────────────────────
    if (!isSold) {
      const present = priceFieldsPresent(l);
      if (present.length) {
        fatal.push(`[2] ${id}: status '${l.status}' but price fields present: ${present.join(', ')}`);
      }
    }

    // ── FATAL 3 · an upcoming lot's saleDate is absent or in the future ──────
    // "future" is measured against the START of today, not the current instant:
    // a lot hammering TODAY is legitimately still upcoming, and saleDate has day
    // granularity. Comparing to `now` fails every same-day auction.
    // resultsPending lots are DELIBERATELY upcoming with a past saleDate — a
    // just-closed sale held visible until the house posts hammers — so they are
    // exempt from this invariant (see RESULT_PENDING_MS in ray-crawl.ts).
    if (l.status === 'upcoming' && l.saleDate && !(l as { resultsPending?: boolean }).resultsPending) {
      // compare as YYYY-MM-DD strings — timezone-proof for day-granularity
      // dates (new Date('2026-07-14') is UTC midnight and would read as
      // "yesterday" in a US-local comparison). A same-day sale is allowed.
      const todayStr = new Date(now).toISOString().slice(0, 10);
      const saleStr = l.saleDate.slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(saleStr) && saleStr < todayStr) {
        fatal.push(`[3] ${id}: upcoming lot has a past saleDate (${l.saleDate})`);
      }
    }

    // ── FATAL 4 · every *Usd equals native × fxRate (±1); fxRate>0; native
    //             currency never blanket-forced ─────────────────────────────
    if (l.fxRate !== undefined && !(l.fxRate > 0)) {
      fatal.push(`[4] ${id}: fxRate must be > 0 (got ${l.fxRate})`);
    }
    for (const [usdName, usd, native] of [
      ['realizedUsd', l.realizedUsd, l.realizedNative],
      ['hammerUsd', l.hammerUsd, l.hammerNative],
      ['premiumUsd', l.premiumUsd, l.premiumNative],
      ['estLowUsd', l.estLowUsd, l.estLowNative],
      ['estHighUsd', l.estHighUsd, l.estHighNative],
    ] as [string, number | null | undefined, number | null | undefined][]) {
      const ok = usdMatchesNative(usd, native, l.fxRate);
      if (ok === false) {
        fatal.push(`[4] ${id}: ${usdName}=${usd} != ${native}×${l.fxRate} (±1)`);
      }
    }
    // native-currency dishonesty: a USD row whose native currency was clearly
    // recovered/forced is only legitimate when fxRecovered flags it (§1b).
    if (l.nativeCurrency === 'USD' && l.fxRate !== undefined && l.fxRate !== 1 && !l.fxRecovered) {
      fatal.push(`[4] ${id}: nativeCurrency 'USD' but fxRate ${l.fxRate} ≠ 1 (currency blanket-forced?)`);
    }

    // ── FATAL 5 · estimate & price share a unit ─────────────────────────────
    // When both a USD estimate band and a USD price exist they are comparable;
    // the failure to guard against is a native estimate paired with a USD price
    // (the original bug). Post-migration estLowUsd is the USD estimate; a lot
    // that has a realizedUsd AND a native-only estimate (estimateLow present but
    // estLowUsd absent while a fxRate ≠ 1 proves native ≠ USD) is unit-mixed.
    if (isSold) {
      const rUsd = realizedUsdOf(l);
      const hasNativeOnlyEst =
        l.estLowUsd == null && l.estimateLow != null &&
        l.fxRate !== undefined && l.fxRate !== 1;
      if (typeof rUsd === 'number' && rUsd > 0 && hasNativeOnlyEst) {
        fatal.push(`[5] ${id}: USD price vs native-only estimate — unit mismatch (fxRate ${l.fxRate})`);
      }
    }

    // ── FATAL 6 · id prefix matches a canonical slug of auctionHouse ─────────
    const slugs = HOUSE_ID_SLUGS[l.auctionHouse];
    if (slugs && l.id) {
      const lower = l.id.toLowerCase();
      if (!slugs.some(s => lower.startsWith(`${s}-`) || lower.startsWith(`${s}_`) || lower === s)) {
        fatal.push(`[6] ${id}: id prefix does not match house '${l.auctionHouse}' (expected one of ${slugs.join('/')})`);
      }
    }

    // ── FATAL 7 · saleDate matches ^\d{4}-\d{2}-\d{2}$ ───────────────────────
    // Only fired when a saleDate is present: absence is allowed for upcoming/
    // unknown rows (invariant 1 already fails a sold lot with no date). A row
    // that carries a date must carry it in the ONE canonical shape.
    if (l.saleDate && !SALE_DATE_RE.test(l.saleDate)) {
      fatal.push(`[7] ${id}: saleDate '${l.saleDate}' is not YYYY-MM-DD`);
    }

    // ── WARN accumulators (§4: coverage regressions, never abort) ────────────
    if (l.formKey == null) formKeyNull++;
    if (isSold && l.estLowUsd == null && l.estimateLow == null) soldNoEstUsd++;
    if (l.objectFingerprint == null) fingerprintNull++;
  }

  const n = lots.length || 1;
  const pct = (x: number) => Math.round((x / n) * 100);
  if (formKeyNull > 0) warn.push(`formKey null on ${formKeyNull}/${n} lots (${pct(formKeyNull)}%)`);
  if (fingerprintNull > 0) warn.push(`objectFingerprint null on ${fingerprintNull}/${n} lots (${pct(fingerprintNull)}%)`);
  if (soldNoEstUsd > 0) warn.push(`${soldNoEstUsd} sold lots have no estimate at all (no estLowUsd/estimateLow)`);

  return { fatal, warn };
}
