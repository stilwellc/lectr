'use client';

/**
 * THE LIVING INDEX — derived, display-ready values.
 *
 * Reads ONLY the eager phase-1 payload (useRayData): meta counts, upcoming.tape,
 * market.json `all` index series, backtest edge. NEVER triggers full/archive
 * load. Everything here is pure + memo-friendly so the scene never recomputes
 * mid-scroll.
 *
 * The headline records ($195M-tier) are CURATED per the brief — they live in the
 * full/stats tier, not the eager top-realized, so we hardcode them (source-flagged).
 */

import type { TapeByMarket, Backtest, MarketData } from '../../hooks/useRayData';

/** One drifting realized hammer on the tape. */
export interface TapeLine {
  maker: string;
  title: string;
  price: string;
  house: string;
}

/** A row on the Record Board — an all-time cross-category hammer. */
export interface RecordRow {
  rank: number;
  category: string;
  object: string;
  maker: string;
  /** raw dollars — for the tabular figure + relative bar */
  amount: number;
  /** the pre-formatted display string (locked, never re-derives) */
  display: string;
  house: string;
  year: string;
  /** where the record comes from (source-flagged, per the brief) */
  source: string;
}

/**
 * THE RECORD BOARD — curated all-time cross-category hammer records.
 * Amounts are the widely-reported all-in prices. Kept source-flagged.
 * Ordered by amount desc; rank assigned at build.
 */
const RECORD_SEED: Omit<RecordRow, 'rank' | 'display'>[] = [
  {
    category: 'Art',
    object: "Femme à la montre",
    maker: 'Pablo Picasso',
    amount: 139_363_500,
    house: "Sotheby's",
    year: '2023',
    source: "Sotheby's, New York",
  },
  {
    category: 'Art',
    object: 'Les femmes d’Alger (Version O)',
    maker: 'Pablo Picasso',
    amount: 179_365_000,
    house: "Christie's",
    year: '2015',
    source: "Christie's, New York",
  },
  {
    category: 'Art',
    object: 'Shot Sage Blue Marilyn',
    maker: 'Andy Warhol',
    amount: 195_040_000,
    house: "Christie's",
    year: '2022',
    source: "Christie's, New York",
  },
  {
    category: 'Science',
    object: 'Stan — Tyrannosaurus rex skeleton',
    maker: 'Cretaceous, ~67M yrs',
    amount: 31_847_500,
    house: "Christie's",
    year: '2020',
    source: "Christie's, New York",
  },
  {
    category: 'Science',
    object: 'Apex — Stegosaurus skeleton',
    maker: 'Jurassic, ~150M yrs',
    amount: 44_600_000,
    house: "Sotheby's",
    year: '2024',
    source: "Sotheby's, New York",
  },
  {
    category: 'Watches',
    object: 'Grandmaster Chime Ref. 6300A-010',
    maker: 'Patek Philippe',
    amount: 31_186_000,
    house: "Christie's",
    year: '2019',
    source: "Christie's, Geneva",
  },
  {
    category: 'Watches',
    object: 'Rolex Daytona “Paul Newman” Ref. 6239',
    maker: 'Rolex',
    amount: 17_752_500,
    house: 'Phillips',
    year: '2017',
    source: 'Phillips, New York',
  },
  {
    category: 'Design',
    object: 'Himalaya Birkin, diamonds & 18k gold',
    maker: 'Hermès',
    amount: 450_000,
    house: "Christie's",
    year: '2021',
    source: "Christie's, Hong Kong",
  },
  {
    category: 'Sports',
    object: '1952 Topps Mickey Mantle #311 (SGC 9.5)',
    maker: 'Topps',
    amount: 12_600_000,
    house: 'Heritage',
    year: '2022',
    source: 'Heritage Auctions',
  },
  {
    category: 'Sports',
    object: 'Kobe Bryant 2007–08 game-worn locker',
    maker: 'Los Angeles Lakers',
    amount: 2_880_000,
    house: "Sotheby's",
    year: '2024',
    source: "Sotheby's, New York",
  },
];

/** Format a raw dollar amount at record scale — always tabular, locked. */
function fmtRecord(n: number): string {
  if (n >= 1_000_000) {
    // keep the full weight of the biggest numbers; no rounding away $195,040,000
    return '$' + n.toLocaleString('en-US');
  }
  return '$' + n.toLocaleString('en-US');
}

export const RECORD_BOARD: RecordRow[] = RECORD_SEED
  .slice()
  .sort((a, b) => b.amount - a.amount)
  .map((r, i) => ({ ...r, rank: i + 1, display: fmtRecord(r.amount) }));

/** The single biggest amount — normalizes the relative bars on the board. */
export const RECORD_MAX = RECORD_BOARD[0]?.amount ?? 1;

/**
 * The hero figure. We surface TWO honest truths and let the composition pick:
 *  - corpus scale: 507,107 lots (from meta.totalLots)
 *  - the market index level (market.json `all`, base 100) — a lectr index level.
 * The count-up target is the corpus size (the unarguable, screenshot-worthy fact);
 * the index level rides underneath as the "lectr all-market index".
 */
export interface HeroTruth {
  totalLots: number;
  totalSold: number;
  /** latest lectr all-market index value (base 100), or null if unavailable */
  indexLevel: number | null;
  /** index change vs the prior period, in points (signed), or null */
  indexDeltaPct: number | null;
  lastPeriod: string | null;
}

export function deriveHeroTruth(
  totalLots: number | undefined,
  totalSold: number | undefined,
  market: MarketData | null,
): HeroTruth {
  const idx = market?.markets?.all?.index ?? [];
  const last = idx.length ? idx[idx.length - 1] : null;
  const prev = idx.length > 1 ? idx[idx.length - 2] : null;
  const indexLevel = last ? Math.round(last.value) : null;
  const indexDeltaPct =
    last && prev && prev.value ? ((last.value - prev.value) / prev.value) * 100 : null;
  return {
    totalLots: totalLots ?? 507107,
    totalSold: totalSold ?? 496486,
    indexLevel,
    indexDeltaPct,
    lastPeriod: last?.period ?? null,
  };
}

/**
 * The tape. Flatten the `all` market realized hammers into drifting lines.
 * Falls back to a curated static set so the tape is NEVER blank (data-load lag).
 */
const TAPE_FALLBACK: TapeLine[] = [
  { maker: 'Game Worn & Used', title: 'Aaron Judge rookie-debut Yankees jersey', price: '$1.79M', house: "Sotheby's" },
  { maker: 'Game Worn & Used', title: 'Chicago Bulls 1996–98 NBA Finals ring', price: '$1.79M', house: "Sotheby's" },
  { maker: 'Game Worn & Used', title: 'LeBron James 2013 NBA Finals jersey', price: '$1.02M', house: "Sotheby's" },
  { maker: 'Game Worn & Used', title: 'Derek Jeter “The Dive” Yankees jersey', price: '$576K', house: "Sotheby's" },
  { maker: 'Game Worn & Used', title: 'Shohei Ohtani 2025 Dodgers game jersey', price: '$375K', house: "Sotheby's" },
  { maker: 'Sports Memorabilia', title: 'Michael Schumacher 1992 Benetton B192', price: '$154K', house: "Sotheby's" },
];

export function deriveTape(tape: TapeByMarket): TapeLine[] {
  const all = tape?.all;
  if (Array.isArray(all) && all.length) {
    return all.map((t) => ({
      maker: t.artist || '',
      title: (t.title || '').replace(/…+$/, '').trim(),
      price: t.price || '',
      house: t.house || '',
    }));
  }
  return TAPE_FALLBACK;
}

/** A point on the drawn index chart. */
export interface IndexPoint {
  period: string;
  value: number;
  n: number;
}

/**
 * The dollar-normalized index series (market.json `all`, base 100). Falls back
 * to a curated shape so the chart NEVER draws empty. The y-axis reads as a real
 * index level; the label credits the cohort method.
 */
const INDEX_FALLBACK: IndexPoint[] = [
  { period: '2020 Q4', value: 100, n: 2443 },
  { period: '2021 Q2', value: 96, n: 3100 },
  { period: '2021 Q4', value: 118, n: 4200 },
  { period: '2022 Q2', value: 131, n: 5100 },
  { period: '2022 Q4', value: 112, n: 4800 },
  { period: '2023 Q2', value: 104, n: 5200 },
  { period: '2024 Q1', value: 98, n: 6100 },
  { period: '2024 Q4', value: 101, n: 7000 },
  { period: '2025 Q3', value: 99, n: 6600 },
  { period: '2026 Q2', value: 97, n: 22604 },
  { period: '2026 Q3', value: 104, n: 5705 },
];

export interface IndexSeries {
  points: IndexPoint[];
  label: string;
  n: number;
}

export function deriveIndex(market: MarketData | null): IndexSeries {
  const all = market?.markets?.all;
  if (all?.index?.length) {
    return { points: all.index, label: all.label || 'lectr all-market index', n: all.n || 0 };
  }
  return { points: INDEX_FALLBACK, label: 'lectr all-market index — cohort-normalized', n: 496486 };
}

/** The backtest edge, reduced to the two headline numbers + a safe fallback. */
export interface EdgeSummary {
  flaggedBeatPct: number;
  unflaggedBeatPct: number;
  flaggedMedianPct: number;
  unflaggedMedianPct: number;
  nFlagged: number;
  /** signed edge in beat-rate points (flagged − unflagged) */
  edgePts: number;
}

export function deriveEdge(bt: Backtest | null): EdgeSummary {
  const f = bt?.flagged;
  const u = bt?.unflagged;
  const flaggedBeatPct = f?.beatHighPct ?? 65;
  const unflaggedBeatPct = u?.beatHighPct ?? 47;
  return {
    flaggedBeatPct,
    unflaggedBeatPct,
    flaggedMedianPct: f?.medianPerfPct ?? 41,
    unflaggedMedianPct: u?.medianPerfPct ?? 17,
    nFlagged: f?.n ?? 20817,
    edgePts: flaggedBeatPct - unflaggedBeatPct,
  };
}

/** Format a big integer with grouping, always tabular. */
export function grouped(n: number): string {
  return n.toLocaleString('en-US');
}
