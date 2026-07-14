/**
 * migrate-v2.ts — the ONE-TIME backfill that lifts the checked-in JSON from the
 * legacy shape to the canonical AuctionLot v2 (spec §3a). Reads
 *   public/data/ray/lots.json      (32,489 mixed-house rows)
 *   public/data/ray/sold-archive.json (10,866 Goldin sold rows)
 * builds v2 rows IN MEMORY, and either:
 *   --dry-run (DEFAULT) → prints a diff REPORT and writes NOTHING
 *   --commit            → rewrites both files (minified) in place
 *
 * A human commits the rewritten JSON: this script NEVER touches git and NEVER
 * auto-commits. Run --dry-run first, eyeball the report, then --commit.
 *
 * Determinism: every derived field comes from app/lib/normalize.ts (+ comps.ts
 * re-exports) — the SAME pure functions the crawler stamps on fresh rows — so a
 * migrated row and a freshly-crawled row are byte-identical. No network I/O
 * (imageHash is left null; the incremental crawl pass handles it — decision #3).
 *
 * Idempotent: a row already at schemaVersion===2 is passed through untouched, so
 * re-running is a no-op and re-crawls that already emit v2 never double-migrate.
 *
 * ADDITIVE + ALIASED: the load-bearing comps/demand engine keeps running because
 * the old fields become ALIASES of the canonical ones — priceUsd→realizedUsd,
 * estimateLow/High→estLowUsd/estHighUsd (USD, not native), currency→nativeCurrency.
 */
import * as fs from 'fs';
import * as path from 'path';

import type { AuctionLot, Currency, PriceBasis } from '../app/types';
import {
  fxRateFor, normalizeDimensions, extractYear, canonMedium,
  extractEdition, extractSerial, extractCollectibleTags, classifyEntity,
  objectFingerprint, titleTokens,
  modelKey, watchKey, normalizeTitle, classifyForm, extractSportsTags,
} from '../app/lib/normalize';

/* ── paths + CLI ─────────────────────────────────────────────────────────── */

const DATA_DIR = path.join(process.cwd(), 'public', 'data', 'ray');
const LOTS_PATH = path.join(DATA_DIR, 'lots.json');
const ARCHIVE_PATH = path.join(DATA_DIR, 'sold-archive.json');

const ARGS = new Set(process.argv.slice(2));
const COMMIT = ARGS.has('--commit');
const DRY_RUN = !COMMIT; // --dry-run is the DEFAULT; --commit is the only write path

const VALIDATED_AT = new Date().toISOString();

/* ── house → canonical id slug (invariant 6) ─────────────────────────────── */
// The id prefix MUST match a canonical slug of the SELLING house. Rago sells via
// Wright's Inertia stack, so its rows carry wright-* ids — renamespace to rago-*
// and record platform:'wright'. Every other house's slug already matches.
const HOUSE_SLUG: Record<string, string> = {
  Phillips: 'phillips', "Sotheby's": 'sothebys', "Christie's": 'christies',
  Wright: 'wright', Rago: 'rago', Heritage: 'heritage', Bonhams: 'bonhams',
  Hindman: 'hindman', Goldin: 'goldin',
};

/* ── currency recovery for USD-path rows (spec §1b) ──────────────────────── */
// The watch/science/sports/photograph paths (Sotheby's + a slice of Christie's)
// already ran toUsd() on their estimates and stamped currency:'USD', DESTROYING
// the native currency. Those rows are recognisable because they carry NO
// hammerPrice/premiumPrice field at all (the native-estimate art paths always
// carry both keys, even when null). For a USD-path row the stored estimate is
// ALREADY USD; we back-derive estNative and recover the native currency from the
// sale's venue/name, flagging fxRecovered:true. In THIS corpus every USD-path
// sale is a US venue (Fine Watches, Space Exploration, Sports, Photographs, …),
// so the recovered native currency is USD and the back-derivation is identity —
// but the branch is explicit so a future non-US USD-path sale converts correctly.
function isUsdEstimatePath(raw: Record<string, unknown>): boolean {
  // native-estimate paths always emit both money keys (null-valued when absent);
  // the USD-path parsers never set them at all.
  return !('hammerPrice' in raw) && !('premiumPrice' in raw);
}

// Recover the true native currency of a USD-path sale from its saleName/venue.
// Conservative: only override USD when the venue clearly names a non-US market.
function recoverNativeCurrency(saleName: string, currency: Currency): Currency {
  const s = (saleName || '').toLowerCase();
  if (/\blondon\b/.test(s)) return 'GBP';
  if (/\bhong kong\b/.test(s)) return 'HKD';
  if (/\bparis\b|\bgeneva\b/.test(s)) return /\bgeneva\b/.test(s) ? 'CHF' : 'EUR';
  return currency; // default: keep what was stored (USD in this corpus)
}

/* ── basis (spec §3a step 2) ─────────────────────────────────────────────── */
// Goldin = final-bid-plus-bp. Realized houses (Bonhams/Wright/Rago/Christie's/
// Sotheby's) = realized. Phillips is per-lot: hammer-only when the recorded
// priceUsd equalled the hammer, else realized.
function basisFor(house: string, raw: Record<string, unknown>): PriceBasis {
  if (house === 'Goldin') return 'final-bid-plus-bp';
  if (house === 'Phillips') {
    const priceUsd = num(raw.priceUsd);
    const hammer = num(raw.hammerPrice);
    // priceUsd was USD; hammer was native — compare after converting hammer at
    // the row's own dated rate so "priceUsd === hammer" is a like-for-like test.
    if (priceUsd != null && hammer != null) {
      const cur = (raw.currency as Currency) || 'USD';
      const { rate } = fxRateFor(cur, isoDay(raw.saleDate as string | null));
      if (Math.abs(priceUsd - Math.round(hammer * rate)) <= 1) return 'hammer-only';
    }
    return 'realized';
  }
  return 'realized';
}

/* ── ranged-date title hardening (spec §3a step 4) ───────────────────────── */
// cleanGoldinTitle in comps.ts strips a leading single-day date ("Jan. 5, 2024
// - Title") but MISSES ranged dates ("Aug. 15-17, 1969 - …", "July 31-Aug. 2,
// 2015 - …", "Feb. 23- March 1, 1992 - …") — 63 titles leak in this corpus. We
// harden LOCALLY here (this script owns only migrate-v2.ts; comps.ts is another
// agent's file) so migrated titles are clean; the crawler-side fix lands with W?.
const MONTHS = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
const RANGED_DATE_RE = new RegExp(
  // "Month DD - Month DD, YYYY - " (cross-month) OR "Month DD-DD, YYYY - "
  `^\\s*${MONTHS}\\s+\\d{1,2}\\s*[-–]\\s*(?:${MONTHS}\\s+)?\\d{1,2},\\s*\\d{4}\\s*-\\s*`,
  'i'
);
function cleanTitleHardened(raw: string): string {
  let s = (raw || '').trim();
  // leading internal note: "DO NOT LIST … - <title>"
  if (/^do not list\b/i.test(s)) {
    const dash = s.indexOf('-');
    if (dash !== -1) s = s.slice(dash + 1).trim();
  }
  // ranged date FIRST (superset of the single-day case for a range)
  s = s.replace(RANGED_DATE_RE, '');
  // single-day date prefix: "January 5, 2024 - Title"
  s = s.replace(/^[A-Za-z]{3,9}\.?\s+\d{1,2},\s+\d{4}\s*-\s*/, '');
  // season prefix: "2023-24 - Title" / "2023 - Title"
  s = s.replace(/^\d{4}(?:-\d{2,4})?\s*-\s*/, '');
  return s.trim();
}

/* ── small helpers ───────────────────────────────────────────────────────── */

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
/** Canonicalise any saleDate to a bare YYYY-MM-DD, or null if unparseable. */
function isoDay(saleDate: string | null | undefined): string | null {
  if (!saleDate || typeof saleDate !== 'string') return null;
  const m = saleDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}
/** A full ISO timestamp when the source carried one (watch paths), else null. */
function saleDateTimeOf(saleDate: string | null | undefined): string | null {
  if (!saleDate || typeof saleDate !== 'string') return null;
  return /^\d{4}-\d{2}-\d{2}T/.test(saleDate) ? saleDate : null;
}

/* ── the per-row migration ───────────────────────────────────────────────── */

interface RowStats {
  fxConverted: number;      // non-USD rows whose USD view was derived from native
  fxRecovered: number;      // USD-path rows whose native was back-derived
  dimsParsed: number;       // rows that got heightCm/widthCm
  dimsEligible: number;     // rows that had a dimensions string
  yearsRecovered: number;   // rows that gained yearNum from the TITLE
  yearsField: number;       // rows whose year came from the field
  boughtInsCleared: number; // non-sold rows that carried a price and got nulled
  idRenamespaced: number;   // rago wright-* → rago-*
  datelessQuarantined: number; // sold rows with no parseable date
  titlesCleaned: number;    // ranged-date leaks stripped
  saleDatesCanon: number;   // saleDate normalised to YYYY-MM-DD (was datetime)
  fingerprintsSet: number;  // objectFingerprint non-null
  photoMatched: number;
  authCert: number;
}
function emptyRowStats(): RowStats {
  return {
    fxConverted: 0, fxRecovered: 0, dimsParsed: 0, dimsEligible: 0,
    yearsRecovered: 0, yearsField: 0, boughtInsCleared: 0, idRenamespaced: 0,
    datelessQuarantined: 0, titlesCleaned: 0, saleDatesCanon: 0,
    fingerprintsSet: 0, photoMatched: 0, authCert: 0,
  };
}

/**
 * Migrate one legacy row → a v2 AuctionLot. Pure w.r.t. the input object (works
 * on a shallow clone). `stats` is mutated for the report. Returns the new row.
 */
function migrateRow(src: Record<string, unknown>, stats: RowStats): AuctionLot {
  // idempotent: a row already at v2 is passed through untouched.
  if (src.schemaVersion === 2) return src as unknown as AuctionLot;

  const lot: Record<string, unknown> = { ...src };
  const house = String(lot.auctionHouse);
  const titleRaw = String(lot.title ?? '');

  /* ── 4a · id renamespace (Rago wright-* → rago-*) ── */
  if (house === 'Rago' && typeof lot.id === 'string' && lot.id.startsWith('wright-')) {
    lot.id = 'rago-' + lot.id.slice('wright-'.length);
    lot.platform = 'wright';
    stats.idRenamespaced++;
  } else if (house === 'Rago') {
    lot.platform = 'wright';
  } else {
    lot.platform = null;
  }

  /* ── 4b · title clean (ranged-date hardening, Goldin only) ── */
  lot.titleRaw = titleRaw;
  if (house === 'Goldin') {
    const cleaned = cleanTitleHardened(titleRaw);
    if (cleaned !== titleRaw) stats.titlesCleaned++;
    lot.title = cleaned;
  }
  const title = String(lot.title ?? '');

  /* ── 4c · saleDate canonicalisation + quarantine ── */
  const rawSaleDate = lot.saleDate as string | null | undefined;
  const day = isoDay(rawSaleDate);
  const wasDatetime = typeof rawSaleDate === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(rawSaleDate);
  lot.saleDateTime = saleDateTimeOf(rawSaleDate);
  let status = String(lot.status);
  if (day) {
    if (wasDatetime) stats.saleDatesCanon++;
    lot.saleDate = day;
  } else {
    // no parseable date. A SOLD lot with no date violates invariant 1 — it can't
    // date its own FX rate or sit on a market series. Quarantine it to
    // 'unknown-result' and null its price fields (handled by !isSold below).
    if (status === 'sold') {
      status = 'unknown-result';
      stats.datelessQuarantined++;
    }
    lot.saleDate = '';
  }
  lot.status = status;
  const saleDay: string | null = day;
  let isSold = status === 'sold';

  /* ── 1 · MONEY: native fact + USD derived via a dated rate ── */
  const legacyCurrency = (lot.currency as Currency) || 'USD';
  const usdPath = isUsdEstimatePath(src);

  let nativeCurrency: Currency;
  let estLowNative: number | null;
  let estHighNative: number | null;
  let fxRecovered = false;

  const estLowStored = num(lot.estimateLow);
  const estHighStored = num(lot.estimateHigh);

  if (usdPath) {
    // stored estimate is ALREADY USD; recover the native currency + back-derive.
    nativeCurrency = recoverNativeCurrency(String(lot.saleName ?? ''), legacyCurrency);
    const { rate } = fxRateFor(nativeCurrency, saleDay);
    // estUsd = stored; estNative = stored / rate  (identity when nativeCurrency===USD)
    estLowNative = estLowStored == null ? null : Math.round(estLowStored / rate);
    estHighNative = estHighStored == null ? null : Math.round(estHighStored / rate);
    fxRecovered = true;
    if (nativeCurrency !== 'USD') stats.fxRecovered++;
  } else {
    // native-estimate path: stored estimate IS native.
    nativeCurrency = legacyCurrency;
    estLowNative = estLowStored;
    estHighNative = estHighStored;
  }

  // native hammer / premium facts
  let hammerNative: number | null = num(lot.hammerPrice);
  let premiumNative: number | null = num(lot.premiumPrice);

  // USD-path realized recovery: the watch/science/photo/sports Sotheby's +
  // Christie's paths carry NO hammer/premium fields — the realized fact lives
  // ONLY in the (already-USD) priceUsd. Back-derive realizedNative just like the
  // estimate, so the fact survives (identity when nativeCurrency===USD). Recorded
  // as premiumNative (the realized number IS buyer-paid on these houses).
  if (usdPath && premiumNative == null && hammerNative == null) {
    const puUsd = num(lot.priceUsd);
    if (puUsd != null && puUsd > 0) {
      const { rate: rr } = fxRateFor(nativeCurrency, saleDay);
      premiumNative = Math.round(puUsd / rr);
    }
  }

  /* ── 3 · Goldin backfill: hammer=currentBid, premium=priceUsd, bp=buyerPremium ── */
  let buyerPremiumPct: number | null = null;
  if (house === 'Goldin') {
    const cb = num(lot.currentBid);
    const pu = num(lot.priceUsd);
    if (isSold) {
      hammerNative = cb != null && cb > 0 ? cb : null;
      premiumNative = pu != null && pu > 0 ? pu : null;
    }
    const bp = num(lot.buyerPremium);
    if (bp != null) buyerPremiumPct = bp;
  }

  /* ── 2 · basis ── */
  const priceBasis: PriceBasis = basisFor(house, src);

  // derive the dated rate ONCE (native → USD)
  const { rate, asOf } = fxRateFor(nativeCurrency, saleDay);
  const conv = (n: number | null) => (n == null ? null : Math.round(n * rate));

  // estimates: native + derived (present on sold AND non-sold alike)
  const estLowUsd = conv(estLowNative);
  const estHighUsd = conv(estHighNative);

  // DOCTRINE guard: a lot marked 'sold' with NO positive realized value (no
  // hammer, no premium, no recovered priceUsd) can't be a fact — invariant 1
  // requires realizedUsd>0 on sold. Quarantine it to 'unknown-result' (4 such
  // rows: 1 Wright + 3 Sotheby's carrying only an estimate). It then flows the
  // non-priced path, nulling every price field.
  if (isSold && !(num(premiumNative) != null && num(premiumNative)! > 0) &&
      !(num(hammerNative) != null && num(hammerNative)! > 0)) {
    status = 'unknown-result';
    lot.status = status;
    isSold = false;
  }

  if (!isSold) {
    // DOCTRINE: a non-sold lot has NULL price fields. Clearing a carried price
    // fixes the 72 priced bought-ins (and any quarantined dateless sold rows).
    const carriedPrice = num(lot.priceUsd) != null || hammerNative != null || premiumNative != null;
    if (carriedPrice) stats.boughtInsCleared++;

    lot.nativeCurrency = nativeCurrency;
    lot.hammerNative = null;
    lot.premiumNative = null;
    lot.realizedNative = null;
    lot.buyerPremiumPct = buyerPremiumPct;
    lot.fxRate = rate;
    lot.fxAsOf = asOf;
    lot.hammerUsd = null;
    lot.premiumUsd = null;
    lot.realizedUsd = null;
    lot.estLowNative = estLowNative;
    lot.estHighNative = estHighNative;
    lot.estLowUsd = estLowUsd;
    lot.estHighUsd = estHighUsd;
    lot.fxRecovered = fxRecovered;
    // aliases: currency→native, estimateLow/High→estUsd (USD, not native)
    lot.currency = nativeCurrency;
    lot.estimateLow = estLowUsd;
    lot.estimateHigh = estHighUsd;
    lot.hammerPrice = null;
    lot.premiumPrice = null;
    lot.priceUsd = null;
    delete lot.priceBasis; // basis only on sold
  } else {
    const realizedNative = premiumNative ?? hammerNative;
    const hammerUsd = conv(hammerNative);
    const premiumUsd = conv(premiumNative);
    const realizedUsd = conv(realizedNative);
    if (nativeCurrency !== 'USD') stats.fxConverted++;

    // derive BP% when both native numbers exist and it wasn't supplied
    let bp = buyerPremiumPct;
    if (bp == null && hammerNative != null && premiumNative != null && hammerNative > 0) {
      bp = Math.round((premiumNative / hammerNative - 1) * 1000) / 10;
    }

    lot.nativeCurrency = nativeCurrency;
    lot.hammerNative = hammerNative;
    lot.premiumNative = premiumNative;
    lot.realizedNative = realizedNative;
    lot.buyerPremiumPct = bp;
    lot.fxRate = rate;
    lot.fxAsOf = asOf;
    lot.hammerUsd = hammerUsd;
    lot.premiumUsd = premiumUsd;
    lot.realizedUsd = realizedUsd;
    lot.estLowNative = estLowNative;
    lot.estHighNative = estHighNative;
    lot.estLowUsd = estLowUsd;
    lot.estHighUsd = estHighUsd;
    lot.fxRecovered = fxRecovered;
    lot.priceBasis = priceBasis;
    // aliases: priceUsd→realizedUsd; estimate*→*Usd (USD); currency→native
    lot.currency = nativeCurrency;
    lot.estimateLow = estLowUsd;
    lot.estimateHigh = estHighUsd;
    lot.hammerPrice = hammerNative;
    lot.premiumPrice = premiumNative;
    lot.priceUsd = realizedUsd;
  }

  /* ── 5 · IDENTITY / ATTRIBUTES (via normalize.ts) ── */
  const classifyInput = {
    title, medium: (lot.medium as string | null) ?? null,
    category: lot.category as AuctionLot['category'],
  };
  lot.formKey = classifyForm(classifyInput);
  lot.modelKey = modelKey({ title });
  lot.reference = watchKey({ title });
  lot.normalizedTitle = normalizeTitle(title);
  lot.titleTokens = titleTokens(title);

  // dims
  const dims = normalizeDimensions((lot.dimensions as string | null) ?? null);
  if (dims) {
    lot.heightCm = dims.heightCm;
    lot.widthCm = dims.widthCm;
    lot.depthCm = dims.depthCm;
    lot.sizeClass = dims.sizeClass;
    lot.dimSource = dims.dimSource;
  } else {
    lot.heightCm = null; lot.widthCm = null; lot.depthCm = null;
    lot.sizeClass = null; lot.dimSource = null;
  }
  if (lot.dimensions) {
    stats.dimsEligible++;
    if (dims && (dims.heightCm != null || dims.widthCm != null)) stats.dimsParsed++;
  }

  // year (field wins; title fallback tagged yearSource:'title')
  const yr = extractYear((lot.year as string | null) ?? null, title,
    (lot.description as string | null) ?? undefined);
  lot.yearNum = yr.yearNum;
  lot.yearSource = yr.yearSource;
  lot.yearIsCirca = yr.yearIsCirca;
  if (yr.yearSource === 'title') stats.yearsRecovered++;
  else if (yr.yearSource === 'field') stats.yearsField++;

  // medium
  const med = canonMedium((lot.medium as string | null) ?? null);
  lot.mediumCanon = med.mediumCanon;
  lot.materialTokens = med.materialTokens;

  // entity / maker
  const ent = classifyEntity(String(lot.artist ?? ''));
  lot.makerSlug = ent.makerSlug;
  lot.entityClass = ent.entityClass;

  // edition / serial / collectible tags
  const ed = extractEdition(title, (lot.description as string | null) ?? undefined);
  lot.editionOf = ed.editionOf;
  lot.editionTotal = ed.editionTotal;
  lot.editionMarker = ed.editionMarker;
  lot.serialNo = extractSerial(title, (lot.description as string | null) ?? undefined);
  const tags = extractCollectibleTags(title);
  lot.photoMatched = tags.photoMatched;
  lot.authCert = tags.authCert;
  lot.gradeLabel = tags.gradeLabel;
  if (tags.photoMatched) stats.photoMatched++;
  if (tags.authCert.length) stats.authCert++;

  // sports/science tags — mirror the crawler: stamp on category 'object' Goldin
  // sports/science lots so a migrated Goldin row matches a fresh one. Uses the
  // hardened (cleaned) title. Only fills fields that aren't already present.
  if (lot.category === 'object' && SPORTS_SCIENCE_SLUGS.has(String(lot.artist))) {
    const st = extractSportsTags(title, String(lot.artist));
    if (st.entity !== undefined && lot.entity == null) lot.entity = st.entity;
    if (st.objectType !== undefined && lot.objectType == null) lot.objectType = st.objectType;
    if (st.eventKey !== undefined && lot.eventKey == null) lot.eventKey = st.eventKey;
    if (st.sportYear !== undefined && lot.sportYear == null) lot.sportYear = st.sportYear;
  }

  // objectFingerprint (Layer B) — null when discriminators thin; imageHash left
  // null for the incremental pass (decision #3), so no network here.
  lot.imageHash = (lot.imageHash as string | null) ?? null;
  const fp = objectFingerprint(lot as unknown as Parameters<typeof objectFingerprint>[0]);
  lot.objectFingerprint = fp;
  lot.repeatSaleGroupId = (lot.repeatSaleGroupId as string | null) ?? null;
  if (fp) stats.fingerprintsSet++;

  /* ── provenance / stamps ── */
  lot.firstSeenKnown = lot.firstSeen != null;
  lot.schemaVersion = 2;
  lot.validatedAt = VALIDATED_AT;

  return lot as unknown as AuctionLot;
}

// mirror the crawler's sports/science slug set (kept local so migrate doesn't
// import a non-exported const; identical membership to comps.SPORTS_SCIENCE_SLUGS).
const SPORTS_SCIENCE_SLUGS = new Set<string>([
  'game-used', 'trophies-awards', 'tickets-passes',
  'space-exploration', 'meteorites', 'fossils', 'scientific-instruments',
]);

/* ── diff-report measurement (before/after) ──────────────────────────────── */

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const a = xs.slice().sort((x, y) => x - y);
  const n = a.length;
  return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
}

/** The load-bearing signal ratio the comps/demand engine divides on:
 *  realized / estMid. We measure its median across non-USD sold lots BEFORE
 *  (legacy: priceUsd / estMid where estMid is NATIVE → equals the FX rate) and
 *  AFTER (realizedUsd / estUsdMid → should land on the USD control ~1.2). */
function signalRatio(realized: number | null, estLow: number | null, estHigh: number | null): number | null {
  if (realized == null || !(realized > 0)) return null;
  const lo = estLow, hi = estHigh;
  const mid = lo != null && hi != null ? (lo + hi) / 2 : lo ?? hi;
  if (mid == null || !(mid > 0)) return null;
  return realized / mid;
}

interface Report {
  file: string;
  total: number;
  alreadyV2: number;
  touched: number;
  row: RowStats;
  // signal-ratio medians
  ratioBeforeNonUsd: number | null;
  ratioAfterNonUsd: number | null;
  ratioUsdControl: number | null;      // USD sold rows AFTER (the target ~1.2)
  ratioBeforeByCur: Record<string, number>;
  ratioAfterByCur: Record<string, number>;
  // invariants (post)
  pricedNonSold: number;               // MUST be 0 after
  usdMismatch: number;                 // rows where *Usd !== native×fxRate (MUST be 0)
  soldNoRealized: number;              // sold rows with realizedUsd<=0 (should be ~0)
  badIdPrefix: number;                 // id prefix != house slug (MUST be 0)
  badSaleDate: number;                 // non-empty saleDate not YYYY-MM-DD (MUST be 0)
}

function measure(file: string, before: Record<string, unknown>[], after: AuctionLot[]): Report {
  const stats = emptyRowStats();
  // re-migrate to collect stats deterministically (after[] already migrated; we
  // recompute stats on a fresh pass so a partial idempotent file still reports).
  const migrated: AuctionLot[] = [];
  let alreadyV2 = 0;
  for (const src of before) {
    if (src.schemaVersion === 2) { alreadyV2++; migrated.push(src as unknown as AuctionLot); continue; }
    migrated.push(migrateRow(src, stats));
  }

  // BEFORE ratios by currency (legacy priceUsd / estMid-native)
  const beforeByCur: Record<string, number[]> = {};
  for (const src of before) {
    const cur = String(src.currency ?? 'USD');
    if (src.status !== 'sold') continue;
    const r = signalRatio(num(src.priceUsd), num(src.estimateLow), num(src.estimateHigh));
    if (r != null) (beforeByCur[cur] = beforeByCur[cur] || []).push(r);
  }
  // AFTER ratios by native currency (realizedUsd / estUsdMid)
  const afterByCur: Record<string, number[]> = {};
  for (const l of migrated) {
    if (l.status !== 'sold') continue;
    const cur = String(l.nativeCurrency ?? 'USD');
    const r = signalRatio(l.realizedUsd ?? null, l.estLowUsd ?? null, l.estHighUsd ?? null);
    if (r != null) (afterByCur[cur] = afterByCur[cur] || []).push(r);
  }

  const nonUsdBefore: number[] = [];
  const nonUsdAfter: number[] = [];
  for (const [cur, xs] of Object.entries(beforeByCur)) if (cur !== 'USD') nonUsdBefore.push(...xs);
  for (const [cur, xs] of Object.entries(afterByCur)) if (cur !== 'USD') nonUsdAfter.push(...xs);

  const medByCur = (m: Record<string, number[]>) => {
    const o: Record<string, number> = {};
    for (const [k, v] of Object.entries(m)) { const md = median(v); if (md != null) o[k] = round3(md); }
    return o;
  };

  // post-invariants
  let pricedNonSold = 0, usdMismatch = 0, soldNoRealized = 0, badIdPrefix = 0, badSaleDate = 0;
  for (const l of migrated) {
    const sold = l.status === 'sold';
    if (!sold) {
      if ((l.realizedUsd ?? null) != null || (l.hammerNative ?? null) != null ||
          (l.premiumNative ?? null) != null || (l.realizedNative ?? null) != null ||
          (l.priceUsd ?? null) != null) pricedNonSold++;
    } else {
      if (!(Number(l.realizedUsd) > 0)) soldNoRealized++;
    }
    // *Usd == native × fxRate within ±1
    const rate = l.fxRate ?? 1;
    for (const [nat, usd] of [
      [l.hammerNative, l.hammerUsd], [l.premiumNative, l.premiumUsd],
      [l.realizedNative, l.realizedUsd], [l.estLowNative, l.estLowUsd],
      [l.estHighNative, l.estHighUsd],
    ] as [number | null | undefined, number | null | undefined][]) {
      if (nat == null || usd == null) continue;
      if (Math.abs(Number(usd) - Math.round(Number(nat) * rate)) > 1) { usdMismatch++; break; }
    }
    // id prefix matches house slug
    const slug = HOUSE_SLUG[String(l.auctionHouse)];
    if (slug && !String(l.id).startsWith(slug + '-')) badIdPrefix++;
    // saleDate format
    if (l.saleDate && !/^\d{4}-\d{2}-\d{2}$/.test(l.saleDate)) badSaleDate++;
  }

  return {
    file,
    total: before.length,
    alreadyV2,
    touched: before.length - alreadyV2,
    row: stats,
    ratioBeforeNonUsd: median(nonUsdBefore) != null ? round3(median(nonUsdBefore)!) : null,
    ratioAfterNonUsd: median(nonUsdAfter) != null ? round3(median(nonUsdAfter)!) : null,
    ratioUsdControl: median(afterByCur['USD'] || []) != null ? round3(median(afterByCur['USD']!)!) : null,
    ratioBeforeByCur: medByCur(beforeByCur),
    ratioAfterByCur: medByCur(afterByCur),
    pricedNonSold, usdMismatch, soldNoRealized, badIdPrefix, badSaleDate,
  };
}

function round3(n: number): number { return Math.round(n * 1000) / 1000; }

/* ── report printing ─────────────────────────────────────────────────────── */

function printReport(r: Report): void {
  const s = r.row;
  console.log(`\n╔══ ${r.file} ══════════════════════════════════════════════`);
  console.log(`║ rows total ............... ${r.total}`);
  console.log(`║ already v2 (skipped) ..... ${r.alreadyV2}`);
  console.log(`║ rows touched ............. ${r.touched}`);
  console.log('║');
  console.log('║ ── MONEY ──');
  console.log(`║ FX-converted (non-USD sold) ...... ${s.fxConverted}`);
  console.log(`║ FX-recovered (USD-path native) ... ${s.fxRecovered}`);
  console.log(`║ priced bought-ins/upcoming CLEARED  ${s.boughtInsCleared}  (target: all)`);
  console.log('║');
  console.log('║ ── SIGNAL RATIO  realized / estMid  (the load-bearing divider) ──');
  console.log(`║ non-USD BEFORE (legacy USD/native) median = ${fmt(r.ratioBeforeNonUsd)}  (≈ the FX rate — WRONG)`);
  console.log(`║ non-USD AFTER  (USD/USD)          median = ${fmt(r.ratioAfterNonUsd)}  (target ≈ USD control)`);
  console.log(`║ USD control    AFTER             median = ${fmt(r.ratioUsdControl)}`);
  console.log('║   before by currency: ' + JSON.stringify(r.ratioBeforeByCur));
  console.log('║   after  by currency: ' + JSON.stringify(r.ratioAfterByCur));
  console.log('║');
  console.log('║ ── IDENTITY / ATTRIBUTES ──');
  const dimPct = s.dimsEligible ? ((s.dimsParsed / s.dimsEligible) * 100).toFixed(1) : 'n/a';
  console.log(`║ dims parsed .............. ${s.dimsParsed}/${s.dimsEligible} (${dimPct}%)`);
  console.log(`║ years from field ......... ${s.yearsField}`);
  console.log(`║ years RECOVERED (title) .. ${s.yearsRecovered}`);
  console.log(`║ objectFingerprints set ... ${s.fingerprintsSet}`);
  console.log(`║ photo-matched ............ ${s.photoMatched}`);
  console.log(`║ auth-cert stamped ........ ${s.authCert}`);
  console.log('║');
  console.log('║ ── QUALITY / RENAMESPACE ──');
  console.log(`║ Rago id  wright-*→rago-* .. ${s.idRenamespaced}`);
  console.log(`║ titles de-leaked (ranged) . ${s.titlesCleaned}`);
  console.log(`║ saleDate → YYYY-MM-DD ..... ${s.saleDatesCanon}`);
  console.log(`║ dateless sold quarantined . ${s.datelessQuarantined}`);
  console.log('║');
  console.log('║ ── POST-MIGRATION INVARIANTS (all MUST be 0) ──');
  console.log(`║ priced non-sold rows ..... ${r.pricedNonSold}   ${flag(r.pricedNonSold)}`);
  console.log(`║ *Usd != native×fxRate .... ${r.usdMismatch}   ${flag(r.usdMismatch)}`);
  console.log(`║ sold with realizedUsd<=0 . ${r.soldNoRealized}   ${flag(r.soldNoRealized)}`);
  console.log(`║ id prefix != house slug .. ${r.badIdPrefix}   ${flag(r.badIdPrefix)}`);
  console.log(`║ saleDate not YYYY-MM-DD ... ${r.badSaleDate}   ${flag(r.badSaleDate)}`);
  console.log('╚══════════════════════════════════════════════════════════════');
}
function fmt(n: number | null): string { return n == null ? ' n/a ' : n.toFixed(3); }
function flag(n: number): string { return n === 0 ? 'OK' : '<<< VIOLATION'; }

/* ── main ────────────────────────────────────────────────────────────────── */

function loadJson(p: string): Record<string, unknown>[] {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function migrateFile(p: string, label: string): { after: AuctionLot[]; report: Report } {
  const before = loadJson(p);
  const stats = emptyRowStats();
  const after = before.map(src =>
    src.schemaVersion === 2 ? (src as unknown as AuctionLot) : migrateRow(src, stats));
  const report = measure(label, before, after);
  return { after, report };
}

function main(): void {
  console.log(`[migrate-v2] mode = ${DRY_RUN ? 'DRY-RUN (default, writes NOTHING)' : 'COMMIT (rewrites JSON in place)'}`);

  for (const p of [LOTS_PATH, ARCHIVE_PATH]) {
    if (!fs.existsSync(p)) {
      console.error(`[migrate-v2] FATAL: missing ${p}`);
      process.exit(1);
    }
  }

  const lots = migrateFile(LOTS_PATH, 'lots.json');
  const archive = migrateFile(ARCHIVE_PATH, 'sold-archive.json');

  printReport(lots.report);
  printReport(archive.report);

  // hard acceptance gate on the combined post-invariants
  const combined = [lots.report, archive.report];
  const anyViolation = combined.some(r =>
    r.pricedNonSold || r.usdMismatch || r.badIdPrefix || r.badSaleDate);

  console.log('\n[migrate-v2] ── ACCEPTANCE ──');
  console.log(` non-USD signal ratio moved toward the USD control:`);
  console.log(`   lots.json:      ${fmt(lots.report.ratioBeforeNonUsd)} → ${fmt(lots.report.ratioAfterNonUsd)}  (USD control ${fmt(lots.report.ratioUsdControl)})`);
  console.log(`   sold-archive:   ${fmt(archive.report.ratioBeforeNonUsd)} → ${fmt(archive.report.ratioAfterNonUsd)}  (USD control ${fmt(archive.report.ratioUsdControl)})`);
  console.log(` priced non-sold after: ${lots.report.pricedNonSold + archive.report.pricedNonSold} (target 0)`);
  console.log(` *Usd == native×fxRate violations: ${lots.report.usdMismatch + archive.report.usdMismatch} (target 0)`);

  if (DRY_RUN) {
    console.log('\n[migrate-v2] DRY-RUN complete. Wrote NOTHING. Re-run with --commit to rewrite the JSON (a human then commits).');
    if (anyViolation) {
      console.log('[migrate-v2] NOTE: post-migration invariant violations present above — investigate BEFORE --commit.');
    }
    return;
  }

  // --commit path: rewrite minified in place. NO git, NO auto-commit.
  if (anyViolation) {
    console.error('[migrate-v2] REFUSING to --commit: post-migration invariants failed (see report above). Data honesty > a bad write.');
    process.exit(1);
  }
  fs.writeFileSync(LOTS_PATH, JSON.stringify(lots.after));
  fs.writeFileSync(ARCHIVE_PATH, JSON.stringify(archive.after));
  console.log(`\n[migrate-v2] COMMIT complete. Rewrote:\n  ${LOTS_PATH}\n  ${ARCHIVE_PATH}\n(minified). Review the diff and commit manually.`);
}

main();
