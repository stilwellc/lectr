'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { AuctionLot } from '../types';
import { ARTIST_LABEL } from '../constants';
import { houseColors, categoryLabels, categoryColors, formatDate, formatPrice, craftTitle, httpsImg, sizedImg, cleanText } from '../utils';
import { areComparable, signalWithPool, isSportsScienceObject, soldCompBand, FORM_LABEL, signalMagnitude } from '../lib/comps';
import { drillRowFor, drillSlugFor } from '../lib/submarkets';
import { loadCompEvidence, evRowsToLots } from '../lib/comp-evidence';
import { safeHref } from '../lib/safe-href';
import type { MarketData, Backtest } from '../hooks/useRayData';
import { useSoldArchive, retryArchiveLoad, useFullLots } from '../hooks/useRayData';
// One formatter, one string: the card and the modal must print the same
// estimate for the same lot (the modal's old local copy produced
// "$500–$500 EUR" where the card said "$500 est.").
import { formatEstimate } from './LotCard';
import { CopyLinkButton } from './LotPage';
import Flick from './Flick';
// hotlinked photo that unmounts on failure so the monogram plate under it shows
import PlateImg from './PlateImg';

// ── LotValueBlock — the engine's under/over-valued read + the exact-item moment.
// Reads the build-time `value` stamped on upcoming lots (app/lib/value.ts). Only
// makes a claim the temporal holdout validated: a DIRECTIONAL "trading below/
// above comparable market" call (not a fabricated price), and — where a genuine
// repeat sale exists — "this exact item last sold for $Z".
function usd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}
function LotValueBlock({ lot, allLots, market, backtest }: { lot: AuctionLot; allLots: AuctionLot[]; market: MarketData | null; backtest: Backtest | null }) {
  const v = (lot as AuctionLot & { value?: NonNullable<AuctionLot['value']> }).value;
  // ×5 ESTIMATE-BAND SANITY (mirrors scripts/build-upcoming.ts): a compRatio
  // outside [1/5, 5] is a data fault the build killed at the source — never
  // resurrect the directional call here.
  const evSane = !v || v.compRatio == null || (v.compRatio <= 5 && v.compRatio >= 1 / 5);
  const dir = v && evSane ? v.signal : null;
  const under = dir && dir.label === 'below comparable market';
  const over = dir && dir.label === 'above comparable market';
  const exactLot = v?.exact ? allLots.find(l => l.id === v.exact!.id) : null;
  // A2-5: a Today's-Call lot can carry the crawl-stamped `signal` without the
  // build's `value` stamp — the SAME engine statistic, measured pre-outcome.
  // The directional line, the calibration disclosure and the sub-market link
  // must not vanish with the stamp: fall back to `signal` where honest.
  const sig = !v && lot.status === 'upcoming' ? lot.signal : null;
  const confidence = v?.confidence ?? sig?.confidence ?? null;
  const drow = drillRowFor(lot, market);
  const dslug = drillSlugFor(lot);
  const calBand = confidence ? backtest?.calibration?.band?.[confidence] : null;
  if (!v && !sig && !calBand && !(drow && dslug)) return null;
  return (
    <div className="ray-lv" style={{ margin: '10px 0 2px', padding: '10px 12px', border: '1px solid var(--hairline)', borderRadius: 8, background: 'var(--panel)' }}>
      {v && v.exact && exactLot && (
        <div style={{ fontSize: 13.5, color: 'var(--color-fg)', fontWeight: 600, marginBottom: dir || v.estimateUsd ? 8 : 0 }}>
          {v.exact.cls === 'physicalMatch' ? 'This exact item' : 'This model'} last sold for{' '}
          <b>{usd(v.exact.realizedUsd)}</b>{' '}
          <span style={{ color: 'var(--color-text-faint)', fontWeight: 400 }}>· {formatDate(v.exact.saleDate, { month: 'short', year: 'numeric' })}</span>
        </div>
      )}
      {v && dir && (
        <div style={{ fontSize: 13.5 }}>
          <span style={{ color: under ? 'var(--color-up)' : over ? 'var(--color-down-text)' : 'var(--color-text-secondary)', fontWeight: 650 }}>
            {under ? 'Trading below' : over ? 'Trading above' : 'At'} comparable market
          </span>
          <span style={{ color: 'var(--color-text-muted)' }}> · comparable sales carry a {dir.beatRatePct}% rate of beating estimates like this · {v.n} sales</span>
        </div>
      )}
      {/* no value stamp, but the crawl-stamped card signal exists — the same
          comps-median-vs-ask read the card and the /value ledger print */}
      {!dir && sig && (
        <div style={{ fontSize: 13.5 }}>
          <span style={{ color: sig.label === 'Below Market' ? 'var(--color-up)' : 'var(--color-down-text)', fontWeight: 650 }}>
            Trading {sig.label === 'Below Market' ? 'below' : 'above'} comparable market
          </span>
          <span style={{ color: 'var(--color-text-muted)' }}>
            {' '}· comps median vs ask {signalMagnitude(sig.label, sig.pct)}{sig.basis ? ` · ${sig.basis} sales` : ''}
          </span>
        </div>
      )}
      {v && !dir && v.estimateUsd != null && (
        <div style={{ fontSize: 13.5 }}>
          <span style={{ color: 'var(--color-fg)', fontWeight: 650 }}>
            lectr value {v.low === v.high ? usd(v.estimateUsd) : `${usd(v.low)}–${usd(v.high)}`}
          </span>
          {/* card-comp value: a point estimate from same-card / same-player sales
              (build-market §3), so it reads "from N same-card sales" not a band */}
          <span style={{ color: 'var(--color-text-muted)' }}> · {v.confidence} confidence · from {v.n} {v.basis === 'card-comp' ? 'comparable card sales' : 'comparable sales'}{v.vsBid ? ` · bid ${v.vsBid.pct >= 0 ? '+' : ''}${v.vsBid.pct}% vs comps` : ''}</span>
        </div>
      )}

      {/* #13 · CALIBRATION PROOF at the decision point: the honest conformal
          coverage for this confidence tier — how tightly calls like this have
          landed against lectr's own value across the full replay. Never a
          promise; a measured band. */}
      {calBand && confidence && (
        // any confidence-tiered read, not only directional flags — and not
        // only value-stamped lots (the signal's tier is the same tier)
        <div style={{ fontSize: 12, color: 'var(--color-text-faint)', marginTop: 6 }}>
          Calibration · {confidence}-confidence reads have landed within{' '}
          <b style={{ color: 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums' }}>{calBand.lo.toFixed(2)}×–{calBand.hi.toFixed(2)}×</b>{' '}
          of lectr&rsquo;s value, 70% of the time{backtest?.calibration?.n != null ? ` · n ${backtest.calibration.n.toLocaleString()}` : ''}
        </div>
      )}

      {/* #16 · SUB-MARKET CONTEXT: where this lot trades, and how that market
          is moving — the flagship taxonomy read, at the bid-decision moment. */}
      {(() => {
        if (!drow || !dslug) return null;
        const pct = drow.readType === 'index' && drow.index ? drow.index.changePct
          : drow.readType === 'demand' ? drow.demandNow : null;
        const tone = pct == null ? undefined : pct >= 0 ? 'var(--color-up)' : 'var(--color-down-text)';
        return (
          <div style={{ fontSize: 12, marginTop: 6 }}>
            <a href={`/sub/${dslug.slug.replace(':', '/')}`} style={{ color: 'var(--color-text-muted)', textDecoration: 'none' }}>
              Sub-market · <b style={{ color: 'var(--color-text-secondary)' }}>{drow.label}</b>
              {pct != null && drow.readType === 'index' && drow.index && (
                <> · <span style={{ color: tone, fontFamily: 'var(--font-mono), monospace' }}>{pct >= 0 ? '+' : ''}{Math.round(pct)}%</span> {drow.index.horizon} verified</>
              )}
              {pct != null && drow.readType === 'demand' && (
                <> · <span style={{ color: tone, fontFamily: 'var(--font-mono), monospace' }}>{pct >= 0 ? '+' : ''}{Math.round(pct)}%</span> vs estimate</>
              )}
              {' '}<Flick size={9} />
            </a>
          </div>
        );
      })()}
    </div>
  );
}

// ── CardCompsBlock — the same-card / same-player evidence behind a bid-only
// card's simulated value (build-market §3). The exact-card sale history and the
// grade ladder ride on the lot itself (lot.cardComps) — no archive fetch — so
// the reader can see WHAT the value was built from. The value.poolIds (the
// exact sale ids used) are stamped in the data and inspectable there; here we
// render the human-readable same-card sales the join produced.
function CardCompsBlock({ lot }: { lot: AuctionLot }) {
  const cc = (lot as AuctionLot & { cardComps?: NonNullable<AuctionLot['cardComps']> }).cardComps;
  const v = (lot as AuctionLot & { value?: NonNullable<AuctionLot['value']> }).value;
  if (!v || v.basis !== 'card-comp' || !cc) return null;
  const sales = (cc.lastSales || []).filter(s => s.p > 0);
  const ladder = cc.gradeLadder || [];
  if (!sales.length && !ladder.length) return null;
  return (
    <div style={{ margin: '4px 0 2px' }}>
      {sales.length > 0 && (
        <div style={{ marginBottom: ladder.length ? 10 : 0 }}>
          <div style={{ fontSize: 12, letterSpacing: '-0.01em', color: 'var(--color-text-muted)', fontWeight: 600, marginBottom: 6 }}>
            This exact card — recent sales
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {sales.map((s, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--color-text-secondary)' }}>
                <span style={{ color: 'var(--color-text-faint)' }}>{s.d ? formatDate(s.d, { month: 'short', year: 'numeric' }) : '—'}</span>
                <span style={{ color: 'var(--color-fg)', fontWeight: 500 }}>{formatPrice(s.p)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {ladder.length > 0 && (
        <div>
          <div style={{ fontSize: 12, letterSpacing: '-0.01em', color: 'var(--color-text-muted)', fontWeight: 600, marginBottom: 6 }}>
            Grade ladder — same card, by grade
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {ladder.map((r, i) => (
              <span key={i} style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', border: '1px solid var(--hairline)', borderRadius: 6, padding: '3px 8px' }}>
                {r.g} <b style={{ color: 'var(--color-fg)' }}>{formatPrice(r.med)}</b>
                <span style={{ color: 'var(--color-text-faint)' }}> · {r.n}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * PriceBand — the decision picture. Every comparable sale plotted as a dot on
 * a log price axis, the median marked, and this lot's estimate drawn as a
 * band over it — so "is this cheap?" is readable at a glance: estimate band
 * left of the dot cloud = priced under the market.
 */
export function PriceBand({
  prices,
  median,
  estLow,
  estHigh,
  below,
}: {
  prices: number[];
  median: number;
  estLow: number | null;
  estHigh: number | null;
  below: boolean | null;
}) {
  // last line of defense for the log axis: one undefined/NaN/≤0 price in the
  // pool would pass the lo/hi guard (NaN compares false) and emit cx="NaN%"
  prices = prices.filter(p => Number.isFinite(p) && p > 0);
  if (prices.length < 3) return null;
  const all = [...prices, ...(estLow ? [estLow] : []), ...(estHigh ? [estHigh] : [])];
  const lo = Math.min(...all) * 0.9;
  const hi = Math.max(...all) * 1.1;
  if (lo <= 0 || hi <= lo) return null;
  const x = (v: number) => ((Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))) * 100;
  const bandColor = below === null ? 'var(--color-text-faint)' : below ? 'var(--color-up)' : 'var(--color-down)';
  const fmt = (n: number) => formatPrice(n);
  return (
    <div style={{ padding: '20px 28px 6px' }}>
      <svg width="100%" height="76" style={{ display: 'block', overflow: 'visible' }} aria-label="Comparable sales vs estimate">
        {/* axis */}
        <line x1="0" y1="44" x2="100%" y2="44" stroke="var(--color-border-mid)" strokeWidth="1" />
        {/* estimate band */}
        {estLow && estHigh && (
          <>
            <rect
              x={`${x(estLow)}%`}
              y="30"
              width={`${Math.max(x(estHigh) - x(estLow), 1.2)}%`}
              height="28"
              rx="4"
              fill={bandColor}
              opacity="0.16"
            />
            <rect
              x={`${x(estLow)}%`}
              y="30"
              width={`${Math.max(x(estHigh) - x(estLow), 1.2)}%`}
              height="28"
              rx="4"
              fill="none"
              stroke={bandColor}
              strokeOpacity="0.7"
              strokeWidth="1.25"
            />
            <text x={`${(x(estLow) + x(estHigh)) / 2}%`} y="74" textAnchor="middle" fill={bandColor} fontSize="11" fontWeight="600" fontFamily="var(--font-sans)">
              this estimate
            </text>
          </>
        )}
        {/* comp dots */}
        {prices.map((p, i) => (
          <circle key={i} cx={`${x(p)}%`} cy="44" r="3.5" fill="var(--color-text-muted)" opacity="0.55" />
        ))}
        {/* median */}
        <line x1={`${x(median)}%`} y1="26" x2={`${x(median)}%`} y2="62" stroke="var(--color-fg)" strokeWidth="1.5" />
        <text x={`${x(median)}%`} y="16" textAnchor="middle" fill="var(--color-fg)" fontSize="11" fontWeight="600" fontFamily="var(--font-sans)">
          comps median {fmt(median)}
        </text>
      </svg>
    </div>
  );
}

/** Convert fraction characters (½, ¼, etc.), slash fractions (3/8), and mixed numbers to decimals */
function parseFrac(s: string): number {
  const fracs: Record<string, number> = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 0.333, '⅔': 0.667, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 };
  // Strip non-numeric prefixes like "I." or "S." (image/sheet size labels)
  const cleaned = s.replace(/^[A-Za-z.]+\s*/, '').trim();
  let val = 0;
  // Try: "10 3/8" or "23 1/4" (integer + slash fraction)
  const mixedSlash = cleaned.match(/^(\d+)\s+(\d+)\/(\d+)/);
  if (mixedSlash) {
    return parseFloat(mixedSlash[1]) + parseFloat(mixedSlash[2]) / parseFloat(mixedSlash[3]);
  }
  // Try standalone slash fraction "3/8"
  const slashFrac = cleaned.match(/^(\d+)\/(\d+)/);
  if (slashFrac) {
    return parseFloat(slashFrac[1]) / parseFloat(slashFrac[2]);
  }
  // Match leading integer/decimal
  const intMatch = cleaned.match(/^(\d+\.?\d*)/);
  if (intMatch) val += parseFloat(intMatch[1]);
  // Match trailing unicode fraction character
  for (const [ch, n] of Object.entries(fracs)) {
    if (cleaned.includes(ch)) { val += n; break; }
  }
  // If nothing matched, try decimal parse
  if (val === 0) val = parseFloat(cleaned) || 0;
  return val;
}

/** Parse a dimension string into [height, width] or null.
 *  Handles: "24 x 18 in", "25¼ h × 20¾ w in", "63 × 52 cm",
 *  "99.8 by 73 cm.", "I. 23 1/4 x 39 3/4 in. (59.1 x 101 cm)S. ..." */
function parseDims(dims: string | null): [number, number] | null {
  if (!dims) return null;
  // For Image/Sheet format, extract just the first measurement block
  // e.g., "I. 23 1/4 x 39 3/4 in. (59.1 x 101 cm)S. 30 3/8 x 45 3/4 in."
  let str = dims;
  const sheetMatch = dims.match(/[IS]\.\s*(.+?)(?:\(|[IS]\.|$)/);
  if (sheetMatch) str = sheetMatch[1].trim();
  // Prefer inches; fall back to cm
  const useIn = str.toLowerCase().includes('in');
  // Split on "x", "×", or "by"
  const tokens = str.split(/\s*(?:[x×]|\bby\b)\s*/i).map(t => t.trim());
  if (tokens.length < 2) return null;
  const h = parseFrac(tokens[0]);
  const w = parseFrac(tokens[1]);
  if (!h || !w) return null;
  // Normalize cm to inches for consistent comparison
  if (!useIn && str.toLowerCase().includes('cm')) {
    return [h / 2.54, w / 2.54];
  }
  return [h, w];
}

function parseArea(dims: string | null): number | null {
  const hw = parseDims(dims);
  return hw ? hw[0] * hw[1] : null;
}

/** Parse a year string like "2000" or "circa 2000" into a number */
function parseYear(y: string | null): number | null {
  if (!y) return null;
  const m = y.match(/(\d{4})/);
  return m ? parseInt(m[1]) : null;
}

/** Simple word overlap score between two medium strings (0-1) */
function mediumSimilarity(a: string | null, b: string | null): number {
  if (!a || !b) return 0;
  const wordsA = new Set(a.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(Boolean));
  const wordsB = new Set(b.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(Boolean));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let overlap = 0;
  Array.from(wordsA).forEach(w => { if (wordsB.has(w)) overlap++; });
  return overlap / Math.max(wordsA.size, wordsB.size);
}

/** Classify medium into sub-type for finer matching within "original" category */
function mediumClass(medium: string | null): string | null {
  if (!medium) return null;
  const m = medium.toLowerCase();
  if (/oil|acrylic|enamel/.test(m) && /canvas|linen|panel|board/.test(m)) return 'painting';
  if (/pencil|charcoal|graphite|crayon|ink|pastel|watercolor|gouache|marker/.test(m)) return 'work-on-paper';
  if (/screen\s*print|lithograph|etching|woodcut|gicl[eé]e|print|engraving|aquatint|monoprint/.test(m)) return 'print';
  if (/bronze|ceramic|resin|marble|plaster/.test(m)) return 'sculpture';
  if (/canvas|linen|panel/.test(m)) return 'painting';
  if (/paper/.test(m)) return 'work-on-paper';
  return null;
}

function scoreComparable(upcoming: AuctionLot, sold: AuctionLot): number {
  let score = 0;

  // Medium sub-class match (weight: 25) — distinguishes sketches from paintings
  const classA = mediumClass(upcoming.medium);
  const classB = mediumClass(sold.medium);
  if (classA && classB) {
    if (classA === classB) score += 25;
    else score += 3;
  }
  // Word-level medium similarity as tiebreaker (weight: 5)
  score += mediumSimilarity(upcoming.medium, sold.medium) * 5;

  // Dimensions similarity (weight: 35) — critical for matching scale
  const areaA = parseArea(upcoming.dimensions);
  const areaB = parseArea(sold.dimensions);
  if (areaA && areaB) {
    const ratio = Math.min(areaA, areaB) / Math.max(areaA, areaB);
    score += ratio * 35;
  }

  // Estimate proximity (weight: 25) — good proxy for importance/scale
  const estMid = upcoming.estimateLow && upcoming.estimateHigh
    ? (upcoming.estimateLow + upcoming.estimateHigh) / 2
    : null;
  if (estMid && sold.priceUsd) {
    const ratio = Math.min(estMid, sold.priceUsd) / Math.max(estMid, sold.priceUsd);
    score += ratio * 25;
  }

  // Year proximity (weight: 10)
  const yearA = parseYear(upcoming.year);
  const yearB = parseYear(sold.year);
  if (yearA && yearB) {
    const diff = Math.abs(yearA - yearB);
    score += Math.max(0, 1 - diff / 50) * 10;
  }

  return score;
}

const MAX_COMPARABLES = 15;

/**
 * ArchiveLoader — the phase-3 sold-archive is the 10MB tier, and `useSoldArchive`
 * fetches on mount (by contract). Hooks can't be called conditionally, so we
 * isolate the trigger in a child that the modal renders ONLY for sports/science
 * object lots. Art/watch/design modals never mount this, never pay the 10MB.
 * Renders nothing; reports the merged corpus + load flag up via a callback.
 */
function ArchiveLoader({ onState }: { onState: (s: { allLotsWithArchive: AuctionLot[]; archiveLoaded: boolean; archiveError: boolean }) => void }) {
  const { allLotsWithArchive, archiveLoaded, archiveError } = useSoldArchive();
  useEffect(() => {
    onState({ allLotsWithArchive, archiveLoaded, archiveError });
  }, [allLotsWithArchive, archiveLoaded, archiveError, onState]);
  return null;
}

export default function ComparableModal({
  lot,
  allLots,
  onClose,
  saved = false,
  onToggleSave,
}: {
  lot: AuctionLot;
  allLots: AuctionLot[];
  onClose: () => void;
  saved?: boolean;
  // the full lot rides along (account.tsx toggle(lotId, lot)): without it the
  // watchlist entry saves bare AND a signed-out save dies after the OAuth
  // round-trip (the lectr-pending-save stash only writes `if (lot)`).
  onToggleSave?: (lotId: string, lot?: AuctionLot) => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  // Opening comps is a full-corpus interaction: the sold pool the modal maps
  // (poolIds → allLots) lives in the phase-2 history. On the lean home lander
  // that isn't loaded yet, so kick it here — idempotent, and pages that already
  // mount useFullLots() are unaffected. The frozen call still renders instantly
  // from lot.value; the comparable-sales rows fill in as the corpus lands.
  // fullLoaded/fullError gate the CLIENT-computed read below: a "0 comparable
  // sales (no call)" verdict must never print against a still-loading corpus.
  const { fullLoaded, fullError, market, backtest } = useFullLots();

  // Bottom-sheet drag (under 900px): the handle tracks the finger, and a
  // decisive pull down dismisses — the native sheet gesture.
  const touchStartY = useRef<number | null>(null);
  const [dragY, setDragY] = useState(0);
  const onHandleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
  };
  const onHandleTouchMove = (e: React.TouchEvent) => {
    if (touchStartY.current === null) return;
    const dy = e.touches[0].clientY - touchStartY.current;
    setDragY(Math.max(0, dy));
  };
  const onHandleTouchEnd = () => {
    if (dragY > 80) onClose();
    else setDragY(0);
    touchStartY.current = null;
  };

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Focus management: move focus into the dialog on open, trap Tab inside
  // the panel, and restore focus to the triggering element on close.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeBtnRef.current?.focus();

    const trapTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !panelRef.current) return;
      const focusables = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      const inside = active instanceof Node && panelRef.current.contains(active);
      if (e.shiftKey) {
        if (active === first || !inside) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !inside) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', trapTab);
    return () => {
      window.removeEventListener('keydown', trapTab);
      previouslyFocused?.focus();
    };
  }, []);

  // Lock body scroll — restore the PRIOR value (not ''), so stacked overlays
  // don't leave the page scrollable when the inner one closes.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // ONE LOT, ONE NUMBER: the card signal is stamped from the BACKTESTED engine
  // (lot.value) at build time — so when the engine made the call, the modal
  // renders the ENGINE's numbers (same median, same pct, poolIds resolved to
  // rows). Only for engine-declined lots does the client signalWithPool make
  // the call; 'at comparable market' means the engine looked and called it
  // fair — no call, no client second-guessing.
  const called = useMemo(() => {
    const ev = (lot as AuctionLot & { value?: { signal?: { label: string } | null; compRatio?: number | null; compValueUsd?: number; n?: number; confidence?: string; poolIds?: string[] } | null }).value;
    // ×5 ESTIMATE-BAND SANITY (mirrors scripts/build-upcoming.ts): a compRatio
    // outside [1/5, 5] is a data fault the build killed at the source — the
    // modal must never resurrect it. Treat it as no engine call and fall
    // through to the uncalled-lot path.
    const evSane = !ev || ev.compRatio == null || (ev.compRatio <= 5 && ev.compRatio >= 1 / 5);
    if (ev && ev.signal && ev.compRatio != null && evSane) {
      if (ev.signal.label.startsWith('at')) return null;
      const below = ev.signal.label.startsWith('below');
      const byId = new Map(allLots.map(l => [l.id, l]));
      // sold-with-price only: a pool id resolving to a relisted/faulted lot
      // must never feed a `priceUsd!` read ($NaN stats, cx="NaN%" dots)
      const pool = (ev.poolIds || [])
        .map(id => byId.get(id))
        .filter((x): x is AuctionLot => !!x && x.status === 'sold' && !!x.priceUsd);
      return {
        signal: {
          label: (below ? 'Below Market' : 'Above Market') as 'Below Market' | 'Above Market',
          pct: Math.round((below ? ev.compRatio - 1 : 1 - ev.compRatio) * 100),
          basis: ev.n || pool.length,
          med: ev.compValueUsd,
          kind: 'form' as const,
          form: ((lot as { formKey?: string }).formKey || 'unknown') as ReturnType<typeof signalWithPool> extends { signal: { form: infer F } } | null ? F : never,
          confidence: (ev.confidence === 'high' ? 'high' : ev.confidence === 'medium' ? 'medium' : 'low') as 'high' | 'medium' | 'low',
        },
        pool,
      };
    }
    return signalWithPool(lot, allLots);
  }, [lot, allLots]);

  // EVIDENCE FALLBACK: the engine's pool draws on the corpus-only tier, so
  // poolIds often resolve to ZERO on-wire rows — and the section would then
  // contradict its own header ("8 sales" … "no comparable sales"). The build
  // ships the pool's actual rows in comp-evidence.json; fetch them lazily
  // whenever the engine made the call but the client corpus can't show it.
  // undefined = still loading · null = fetched, nothing there
  const [evRows, setEvRows] = useState<AuctionLot[] | null | undefined>(undefined);
  // engine call with an unresolvable pool, OR a crawl-stamped signal with no
  // call at all (its fallback pool also lives in the full corpus) — both have
  // build-shipped evidence. Sports/science objects keep their archive band.
  const needEvidence = (!!called && called.pool.length === 0)
    || (!called && !isSportsScienceObject(lot) && lot.status === 'upcoming' && !!lot.signal && (lot.signal.basis || 0) > 0);
  useEffect(() => {
    if (!needEvidence) { setEvRows(null); return; }
    let live = true;
    setEvRows(undefined);
    loadCompEvidence().then(map => {
      if (!live) return;
      const rows = map?.[String(lot.id)];
      setEvRows(rows && rows.length ? evRowsToLots(rows, lot) : null);
    });
    return () => { live = false; };
  }, [needEvidence, lot]);

  // A bid-only sports CARD valued by the §3 card-comp estimator. Its evidence
  // is the same-card sales / grade ladder rendered by CardCompsBlock in the
  // header (the poolIds — sold-card ids — aren't in the client corpus, so the
  // generic same-artist comps section would show a false "no comps found").
  // Suppress that section for these lots; the card block IS the proof surface.
  const isCardComp = (lot as AuctionLot & { value?: { basis?: string } | null }).value?.basis === 'card-comp';

  // The Goldin sold-archive is the 10MB tier — only sports/science object lots
  // (with no estimate-based call) can build a realized band, and only they need
  // the archive to fill the comp pool. Fetch on demand via <ArchiveLoader>
  // (mounted below, only when wantsArchive); block the band until it lands so
  // the pool isn't computed against a truncated corpus. Watches are also
  // `object` but their frozen `called` path never touches the archive.
  const wantsArchive = lot.category === 'object' && isSportsScienceObject(lot);
  const [archive, setArchive] = useState<{ allLotsWithArchive: AuctionLot[]; archiveLoaded: boolean; archiveError: boolean }>({
    allLotsWithArchive: allLots,
    archiveLoaded: false,
    archiveError: false,
  });
  const archiveLoaded = wantsArchive ? archive.archiveLoaded : true;
  const archiveFailed = wantsArchive && archive.archiveError && !archive.archiveLoaded;
  const bandPoolLots = wantsArchive && archive.archiveLoaded ? archive.allLotsWithArchive : allLots;

  // No call, and this is a Goldin sports/science object → a descriptive
  // realized band (median, range, n) — NEVER a below/above-market call.
  // Goldin publishes no estimates, so there is nothing to call against.
  const band = useMemo(
    () => (called ? null : isSportsScienceObject(lot) ? soldCompBand(lot, bandPoolLots) : null),
    [called, lot, bandPoolLots]
  );

  // No frozen engine call and no realized band yet, while the phase-2 corpus
  // is still downloading: the client read is running against a truncated pool,
  // so a confident "0 comparable sales (no call)" would contradict the card
  // glow. Show the loading state instead (LotPage's compsPending pattern).
  const compsPending = (!called && !band && !fullLoaded && !fullError)
    || (needEvidence && evRows === undefined);

  const comparables = useMemo(() => {
    if (called) {
      // the call's own pool, most recent first — this IS the statistic.
      // When the on-wire corpus can't resolve the ids, the build-shipped
      // evidence rows are the same pool (deep-corpus sales), not a substitute.
      const poolRows = called.pool.length ? called.pool : (evRows || []);
      return [...poolRows]
        .sort((a, b) => new Date(b.saleDate).getTime() - new Date(a.saleDate).getTime())
        .map(l => ({ lot: l, score: 1 }));
    }
    if (band) {
      // the realized band's own pool, most recent first — no similarity score,
      // no ranking against an estimate that doesn't exist
      return [...band.pool]
        .sort((a, b) => new Date(b.saleDate).getTime() - new Date(a.saleDate).getTime())
        .map(l => ({ lot: l, score: 1 }));
    }
    // context only: gated comps ranked by similarity
    const sold = allLots.filter(l =>
      l.artist === lot.artist &&
      l.status === 'sold' &&
      l.priceUsd &&
      l.id !== lot.id &&
      areComparable(lot, l)
    );
    const scored = sold.map(s => ({ lot: s, score: scoreComparable(lot, s) }));
    scored.sort((a, b) => {
      if (Math.abs(a.score - b.score) > 0.01) return b.score - a.score;
      return new Date(b.lot.saleDate).getTime() - new Date(a.lot.saleDate).getTime();
    });
    // crawl-stamped signal with no client-derivable pool: the build-shipped
    // evidence rows ARE its pool (deep-corpus sales, most recent first)
    if (!scored.length && evRows?.length) {
      return [...evRows]
        .sort((a, b) => new Date(b.saleDate).getTime() - new Date(a.saleDate).getTime())
        .map(l => ({ lot: l, score: 1 }));
    }
    return scored.slice(0, MAX_COMPARABLES);
  }, [lot, allLots, called, band, evRows]);

  const compStats = useMemo(() => {
    if (comparables.length === 0) return null;
    // the realized band is descriptive: its own median/range/n, no estimate
    // ratio (hammerVsEst null hides the "vs. Est." column and the % column)
    if (band) {
      return { median: band.median, low: band.low, high: band.high, aboveEst: 0, total: band.n, hammerVsEst: null };
    }
    const prices = comparables.map(c => c.lot.priceUsd!).sort((a, b) => a - b);
    const low = prices[0];
    const high = prices[prices.length - 1];
    const estMid = lot.estimateLow && lot.estimateHigh
      ? (lot.estimateLow + lot.estimateHigh) / 2
      : null;
    const aboveEst = estMid ? prices.filter(p => p >= estMid).length : 0;
    // when a call exists, the median is the CALL's median — never re-derived
    const median = called?.signal.med ?? (prices.length % 2 === 0
      ? (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2
      : prices[Math.floor(prices.length / 2)]);
    const hammerVsEst = estMid ? median / estMid : null;
    return { median, low, high, aboveEst, total: prices.length, hammerVsEst };
  }, [comparables, lot, called, band]);

  // PROOF SURFACE HONESTY: when the printed median is the ENGINE's number
  // (called.signal.med) and it differs >10% from the median of the pool the
  // reader can actually see below, calling it "Median" is a self-contradiction
  // — label it "lectr value" (the LotValueBlock term) instead.
  const medianLabel = useMemo(() => {
    if (!compStats || comparables.length === 0) return 'Median';
    const prices = comparables.map(c => c.lot.priceUsd).filter((p): p is number => !!p).sort((a, b) => a - b);
    if (prices.length === 0) return 'Median';
    const poolMed = prices.length % 2 === 0
      ? (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2
      : prices[Math.floor(prices.length / 2)];
    return poolMed > 0 && Math.abs(compStats.median - poolMed) / poolMed > 0.1 ? 'lectr value' : 'Median';
  }, [compStats, comparables]);

  const houseColor = houseColors[lot.auctionHouse] || 'var(--color-text-secondary)';
  const catLabel = categoryLabels[lot.category] || null;
  const catColor = categoryColors[lot.category] || 'var(--color-text-faint)';

  // Portal to <body>: the card grid animates with transforms, and a transformed
  // ancestor traps fixed/z-indexed descendants beneath the sticky toolbar.
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      onClick={onClose}
      role="presentation"
      className="comp-modal-overlay terminal-shell"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        padding: 0,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {/* __html, not a text child: this CSS carries quotes (content: '',
          attribute selectors) which React would escape in SSR text while the
          browser leaves <style> raw text undecoded — a hydration mismatch
          whenever this ships in prerendered HTML. */}
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes compModalFade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes compModalRise { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
        @media (prefers-reduced-motion: no-preference) {
          .comp-modal-overlay { animation: compModalFade 160ms cubic-bezier(0.22, 0.9, 0.24, 1) both; }
        }
        /* desktop only — under 901px the .ray-sheet bottom-sheet entrance owns the motion */
        @media (min-width: 901px) and (prefers-reduced-motion: no-preference) {
          .comp-modal-panel { animation: compModalRise 220ms cubic-bezier(0.22, 0.9, 0.24, 1) backwards; }
        }
        .comp-modal-row[href]:hover { background: var(--color-bg-elevated) !important; }
        .comp-modal-row:not([href]) { cursor: default; }
        .comp-modal-close:hover { color: var(--color-fg) !important; }
        .comp-modal-panel {
          width: 100%;
          max-width: 720px;
          max-height: calc(100vh - 40px);
          border-radius: 20px 20px 0 0;
          overflow: auto;
        }
        .comp-modal-header {
          display: flex;
          gap: 0;
        }
        .comp-modal-img {
          width: 200px;
          min-height: 200px;
        }
        .comp-modal-header-info { padding: 28px 28px; }
        .comp-modal-comps { padding: 24px 28px 32px; }
        .comp-modal-row-inner {
          display: flex;
          align-items: center;
          gap: 14px;
        }
        .comp-modal-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
          align-items: center;
        }
        .comp-modal-meta-dims { display: inline; }
        .comp-modal-thumb {
          width: 52px;
          height: 52px;
        }
        .comp-modal-price { text-align: right; }
        .comp-modal-maker:hover { text-decoration: underline !important; }
        /* the sheet's drag handle only exists as a gesture surface on the
           bottom-sheet presentation — desktop hides it */
        .comp-modal-handle { display: none; }
        @media (min-width: 901px) {
          .comp-modal-panel {
            align-self: center;
            border-radius: 20px;
            margin: 20px;
            max-height: calc(100vh - 40px);
          }
        }
        @media (max-width: 900px) {
          .comp-modal-handle {
            display: flex;
            justify-content: center;
            padding: 10px 0 2px;
            touch-action: none;
          }
          .comp-modal-handle::before {
            content: '';
            width: 40px;
            height: 4px;
            border-radius: 100px;
            background: var(--color-border-mid);
          }
          .comp-modal-header { flex-direction: column !important; }
          .comp-modal-img { width: 100% !important; height: 180px !important; min-height: auto !important; }
          .comp-modal-header-info { padding: 20px 20px !important; }
          .comp-modal-stats { padding: 14px 16px !important; }
          .comp-modal-comps { padding: 20px 16px 28px !important; }
          .comp-modal-row-inner { gap: 10px !important; }
          .comp-modal-thumb { width: 44px !important; height: 44px !important; }
          .comp-modal-meta-dims { display: none !important; }
          .comp-modal-price { min-width: 60px; }
        }
      ` }} />
      {/* Mounted only for sports/science objects — its mount triggers the
          10MB sold-archive fetch. Renders nothing. */}
      {wantsArchive && <ArchiveLoader onState={setArchive} />}
      <div
        ref={panelRef}
        onClick={e => e.stopPropagation()}
        className="comp-modal-panel glass ray-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`Comparable sales for ${lot.title}`}
        style={{
          position: 'relative',
          transform: dragY > 0 ? `translateY(${dragY}px)` : undefined,
          transition: touchStartY.current === null ? 'transform 200ms var(--ease-signature)' : 'none',
        }}
      >
        {/* Bottom-sheet drag handle — swipe down to dismiss (under 900px) */}
        <div
          className="comp-modal-handle"
          aria-hidden="true"
          onTouchStart={onHandleTouchStart}
          onTouchMove={onHandleTouchMove}
          onTouchEnd={onHandleTouchEnd}
        />

        {/* Close button */}
        <button
          ref={closeBtnRef}
          className="comp-modal-close"
          onClick={onClose}
          aria-label="Close"
          style={{
            position: 'sticky',
            top: 12,
            float: 'right',
            marginRight: 12,
            marginTop: 12,
            background: 'var(--color-bg-elevated)',
            border: '1px solid var(--color-border)',
            borderRadius: 100,
            width: 44,
            height: 44,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            color: 'var(--color-text-faint)',
            fontSize: 18,
            zIndex: 2,
            boxShadow: '0 2px 12px rgba(0,0,0,0.45)',
            transition: 'color var(--duration-fast) var(--ease-signature)',
          }}
        >
          &times;
        </button>

        {/* Save — a lot can be bookmarked without leaving the comps */}
        {onToggleSave && (
          <button
            className="ray-save-btn"
            onClick={() => onToggleSave(lot.id, lot)}
            aria-label={saved ? 'Remove from saved' : 'Save lot'}
            style={{
              position: 'sticky',
              top: 12,
              float: 'right',
              marginRight: 8,
              marginTop: 12,
              background: saved ? 'var(--color-fg)' : 'var(--color-bg-elevated)',
              border: saved ? 'none' : '1px solid var(--color-border)',
              borderRadius: 100,
              width: 44,
              height: 44,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              padding: 0,
              zIndex: 2,
              boxShadow: '0 2px 12px rgba(0,0,0,0.45)',
            }}
          >
            <svg width="12" height="14" viewBox="0 0 12 14" fill="none" aria-hidden="true">
              <path
                d="M1 1.5C1 1.22386 1.22386 1 1.5 1H10.5C10.7761 1 11 1.22386 11 1.5V12.5C11 12.6894 10.8862 12.8625 10.7096 12.9472C10.533 13.0319 10.3239 13.0136 10.1646 12.8994L6 9.91421L1.83541 12.8994C1.67614 13.0136 1.46698 13.0319 1.29037 12.9472C1.11377 12.8625 1 12.6894 1 12.5V1.5Z"
                fill={saved ? 'var(--color-bg)' : 'var(--color-text-faint)'}
                stroke={saved ? 'var(--color-bg)' : 'var(--color-text-faint)'}
                strokeWidth="0.8"
              />
            </svg>
          </button>
        )}

        {/* Header: image + lot info */}
        <div className="comp-modal-header" style={{
          borderBottom: '1px solid var(--color-border)',
        }}>
          <div className="comp-modal-img" style={{
            position: 'relative',
            flexShrink: 0,
            background: `linear-gradient(135deg, var(--color-bg-elevated) 0%, var(--color-bg) 100%)`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}>
            {/* serif-initial plate always behind, photo overlays — on a
                hotlink-block the plate shows through, never an empty well
                (the comp-row thumbs' exact pattern) */}
            <div style={{
              fontFamily: "var(--font-serif), serif",
              fontSize: 56,
              fontWeight: 300,
              color: 'var(--color-text-faint)',
              opacity: 0.3,
              fontStyle: 'normal',
            }}>
              {lot.title.charAt(0)}
            </div>
            {lot.imageUrl && (
              <PlateImg
                // .comp-modal-img: 200×200 desktop, full-panel-width × 180
                // on the mobile sheet — 640 covers 2× the widest sheet
                src={sizedImg(httpsImg(lot.imageUrl), 640)}
                alt={lot.title}
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
              />
            )}
          </div>

          <div className="comp-modal-header-info" style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <span style={{
                fontSize: 12.5,
                letterSpacing: '-0.01em',
                textTransform: 'none',
                color: houseColor,
                fontWeight: 600,
              }}>
                {lot.auctionHouse}
              </span>
              {/* 'object' is suppressed exactly as LotCard suppresses it —
                  an "Object" chip names nothing */}
              {catLabel && lot.category !== 'unknown' && lot.category !== 'object' && (
                <>
                  <span style={{ color: 'var(--color-text-faint)', fontSize: 12.5 }}>&middot;</span>
                  <span style={{
                    fontSize: 12.5,
                    letterSpacing: '-0.01em',
                    textTransform: 'none',
                    color: catColor,
                    fontWeight: 600,
                  }}>
                    {catLabel}
                  </span>
                </>
              )}
            </div>

            {/* the maker's own book — internal link; the house URL lives on
                the "View lot" CTA only */}
            <Link
              href={`/makers/${lot.artist}`}
              className="comp-modal-maker"
              onClick={e => e.stopPropagation()}
              style={{
                fontSize: 12.5,
                letterSpacing: '-0.01em',
                textTransform: 'none',
                color: 'var(--color-text-muted)',
                fontWeight: 600,
                marginBottom: 4,
                textDecoration: 'none',
                alignSelf: 'flex-start',
              }}
            >
              {ARTIST_LABEL[lot.artist] || lot.artist}
            </Link>

            {/* "Pablo Picasso / Pablo Picasso" — skip the title when it
                merely repeats the maker line above it */}
            {craftTitle(lot.title) !== (ARTIST_LABEL[lot.artist] || lot.artist) && (
              <h2 style={{
                fontFamily: "var(--font-serif), serif",
                fontSize: 22,
                fontWeight: 600,
                lineHeight: 1.25,
                marginBottom: 4,
              }}>
                {craftTitle(lot.title)}
              </h2>
            )}

            {lot.year && (
              <div style={{ fontSize: 12.5, color: 'var(--color-text-faint)', marginBottom: 10 }}>
                {lot.year}{lot.medium ? ` · ${cleanText(lot.medium)}` : ''}
              </div>
            )}

            <div style={{ fontSize: 16, color: 'var(--color-fg)', fontWeight: 500, marginBottom: 3 }}>
              {formatEstimate(lot)}
            </div>
            <LotValueBlock lot={lot} allLots={allLots} market={market} backtest={backtest} />
            <CardCompsBlock lot={lot} />
            <div style={{ fontSize: 12.5, color: 'var(--color-text-faint)' }}>
              {formatDate(lot.saleDate, { month: 'long', day: 'numeric', year: 'numeric' })}
              {lot.saleName ? ` · ${lot.saleName}` : ''}
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 14, alignSelf: 'flex-start' }}>
              {/* the in-app certificate first — no journey should HAVE to exit
                  to the house before the lot's own dossier (wayfinding: both
                  page audits ranked this the top gap) */}
              <Link
                href={`/lot?id=${encodeURIComponent(lot.id)}`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 20px',
                  borderRadius: 100,
                  border: '1px solid var(--color-border-mid)',
                  color: 'var(--color-fg)',
                  fontSize: 12.5,
                  fontWeight: 600,
                  textDecoration: 'none',
                }}
              >
                Open the lot page <Flick size={10} />
              </Link>
              {/* scheme-allowlisted (safe-href): a crawler-faulted URL means
                  no house CTA at all — the in-app certificate still stands */}
              {safeHref(lot.url) && (
                <a
                  href={safeHref(lot.url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '8px 20px',
                    borderRadius: 100,
                    background: 'var(--color-butter)',
                    color: 'var(--color-butter-ink)',
                    fontSize: 12.5,
                    fontWeight: 600,
                    letterSpacing: '-0.01em',
                    textTransform: 'none',
                    textDecoration: 'none',
                    transition: 'opacity var(--duration-fast) var(--ease-signature)',
                  }}
                >
                  View lot <Flick size={10} style={{ marginLeft: 0 }} />
                </a>
              )}
              {/* the share point — every card's modal can mint the permalink */}
              <CopyLinkButton id={lot.id} style={{ borderRadius: 100, padding: '7px 16px', fontSize: 12.5 }} />
            </div>
          </div>
        </div>

        {/* The decision picture: comps plotted against this lot's estimate.
            For a Goldin realized band there IS no estimate to plot — pass null
            band bounds and a null "below" so the median line stays neutral
            (no red/green): realized prices are not a call.
            Gated on archiveLoaded/compsPending exactly like the rows below —
            the band stats must never print from a truncated corpus and then
            silently swap when the full pool lands.
            1.3 green threshold matches the signal engine (lib/comps.ts):
            1.2–1.3 is pure buyer's premium, not edge. */}
        {compStats && archiveLoaded && !compsPending && (
          <PriceBand
            prices={comparables.map(c => c.lot.priceUsd!)}
            median={compStats.median}
            estLow={band ? null : lot.estimateLow}
            estHigh={band ? null : lot.estimateHigh}
            below={band ? null : compStats.hammerVsEst === null ? null : compStats.hammerVsEst >= 1.3 ? true : compStats.hammerVsEst <= 0.75 ? false : null}
          />
        )}

        {/* Summary Stats */}
        {compStats && archiveLoaded && !compsPending && (
          <div className="comp-modal-stats" style={{
            padding: '18px 28px',
            borderBottom: '1px solid var(--color-border)',
            display: 'flex',
            gap: 0,
          }}>
            <div style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ fontSize: 18, fontWeight: 500, color: 'var(--color-fg)', fontVariantNumeric: 'tabular-nums' }}>
                {formatPrice(compStats.median)}
              </div>
              <div style={{ fontSize: 12.5, letterSpacing: '-0.01em', textTransform: 'none', color: 'var(--color-text-faint)', marginTop: 3 }}>
                {medianLabel}
              </div>
            </div>
            <div style={{ width: 1, background: 'var(--color-border)', margin: '0 4px' }} />
            <div style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ fontSize: 18, fontWeight: 500, color: 'var(--color-fg)', fontVariantNumeric: 'tabular-nums' }}>
                {formatPrice(compStats.low)} — {formatPrice(compStats.high)}
              </div>
              <div style={{ fontSize: 12.5, letterSpacing: '-0.01em', textTransform: 'none', color: 'var(--color-text-faint)', marginTop: 3 }}>
                Range
              </div>
            </div>
            {compStats.hammerVsEst !== null && (
              <>
                <div style={{ width: 1, background: 'var(--color-border)', margin: '0 4px' }} />
                <div style={{ flex: 1, textAlign: 'center' }}>
                  <div style={{
                    fontSize: 18,
                    fontWeight: 500,
                    fontVariantNumeric: 'tabular-nums',
                    color: compStats.hammerVsEst >= 1 ? 'var(--color-up)' : 'var(--color-down-text)',
                  }}>
                    {/* signalMagnitude caps broken percents — never "+5976%" */}
                    {compStats.hammerVsEst >= 1
                      ? signalMagnitude('Below Market', Math.round((compStats.hammerVsEst - 1) * 100))
                      : signalMagnitude('Above Market', Math.round((1 - compStats.hammerVsEst) * 100))}
                  </div>
                  <div style={{ fontSize: 12.5, letterSpacing: '-0.01em', textTransform: 'none', color: 'var(--color-text-faint)', marginTop: 3 }}>
                    vs. Est.
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Comparables — suppressed for card-comp lots (CardCompsBlock in the
            header already carries their same-card evidence; the poolIds resolve
            to sold-card ids that aren't in the client corpus). */}
        {!isCardComp && (
        <div className="comp-modal-comps">
          <div style={{
            fontSize: 12.5,
            letterSpacing: '-0.01em',
            textTransform: 'none',
            color: 'var(--color-text-muted)',
            fontWeight: 600,
            marginBottom: band ? 6 : 16,
          }}>
            {called
              ? called.signal.kind === 'edition'
                ? `The call — this exact work, sold ${comparables.length} times`
                : `The call — ${comparables.length} comparable ${FORM_LABEL[called.signal.form]}${(lot as AuctionLot & { value?: { crossPlayer?: boolean } | null }).value?.crossPlayer ? ' · same-game jerseys, player-tier matched' : ''}`
              : band
                ? `Recent sold — ${band.n} comparable ${(FORM_LABEL as Record<string, string>)[band.form] || band.form}${band.confidence === 'low' ? ' · thin evidence' : ''}`
                : compsPending || comparables.length === 0
                  ? 'Context — comparable sales'
                  : lot.status === 'upcoming' && (lot.signal?.basis || 0) > 0
                    // crawl-signal lot whose pool arrived via the evidence
                    // fetch — these rows ARE the call's pool, never "no call"
                    ? `The call — ${comparables.length} comparable sales`
                    : `Context — ${comparables.length} comparable sales (no call on this lot)`}
          </div>

          {/* Realized prices are hammer + premium, not an estimate call —
              Goldin runs bid auctions and publishes no estimates, so there is
              nothing to be above or below. Say so plainly. */}
          {band && (
            <div style={{
              fontSize: 12.5,
              letterSpacing: '-0.01em',
              color: 'var(--color-text-faint)',
              marginBottom: 16,
              lineHeight: 1.45,
            }}>
              Realized prices — winning bid plus buyer&rsquo;s premium. Goldin publishes no estimates.
            </div>
          )}

          {archiveFailed ? (
            <div style={{ padding: '36px 0', textAlign: 'center', color: 'var(--color-text-faint)', fontSize: 13.5 }}>
              Comparable sales couldn&rsquo;t be loaded.
              <button
                onClick={() => { setArchive(a => ({ ...a, archiveError: false })); retryArchiveLoad(); }}
                style={{ display: 'block', margin: '12px auto 0', background: 'none', border: '1px solid var(--hairline)', color: 'var(--color-text-secondary)', padding: '7px 16px', borderRadius: 8, fontSize: 13.5, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Try again
              </button>
            </div>
          ) : (wantsArchive && !archiveLoaded) || compsPending ? (
            // Skeleton shaped like what arrives (band + stat strip + rows) so
            // the sheet doesn't jump when the evidence lands.
            <div aria-label="Loading comparable sales" role="status" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ height: 76, margin: '4px 12px 10px', borderRadius: 12, background: 'var(--color-bg-elevated)', opacity: 0.55 }} />
              <div style={{ height: 52, margin: '0 12px 14px', borderRadius: 12, background: 'var(--color-bg-elevated)', opacity: 0.4 }} />
              {[0, 1, 2, 3, 4].map(i => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 12px', opacity: Math.max(0.12, 0.4 - i * 0.07) }}>
                  <div style={{ width: 52, height: 52, borderRadius: 8, background: 'var(--color-bg-elevated)', flexShrink: 0 }} />
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ height: 12, width: '38%', borderRadius: 4, background: 'var(--color-bg-elevated)' }} />
                    <div style={{ height: 10, width: '58%', borderRadius: 4, background: 'var(--color-bg-elevated)' }} />
                  </div>
                  <div style={{ height: 12, width: 48, borderRadius: 4, background: 'var(--color-bg-elevated)' }} />
                </div>
              ))}
            </div>
          ) : comparables.length === 0 ? (
            <div style={{
              padding: '40px 0',
              textAlign: 'center',
              color: 'var(--color-text-faint)',
              fontSize: 13.5,
            }}>
              {/* one message, one voice (LotPage's phrasing) — the header
                  above already dropped its own "0 comparable sales" count.
                  When the ENGINE called it, the pool exists in the deep corpus
                  — say that, never "no comps" against our own header. */}
              {(() => {
                const n = (called && (called.signal as { basis?: number }).basis) || (lot.status === 'upcoming' && lot.signal?.basis) || 0;
                return n > 0
                  ? <>The {n} sales behind this call sit in the deep corpus &mdash; the evidence rows couldn&rsquo;t be loaded right now.</>
                  : <>No comparable sales clear the gates for this lot &mdash; lectr doesn&rsquo;t manufacture a pool.</>;
              })()}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {comparables.map(({ lot: comp }, i) => {
                const compHouseColor = houseColors[comp.auctionHouse] || 'var(--color-text-secondary)';
                const estMid = lot.estimateLow && lot.estimateHigh
                  ? (lot.estimateLow + lot.estimateHigh) / 2
                  : null;
                const ratio = estMid && comp.priceUsd
                  ? comp.priceUsd / estMid
                  : null;

                return (
                  <a
                    key={comp.id}
                    // scheme-allowlisted; undefined renders a non-navigating
                    // row — the comp's facts still read, no dead click
                    href={safeHref(comp.url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="comp-modal-row"
                    style={{
                      display: 'block',
                      padding: '10px 12px',
                      borderRadius: 12,
                      textDecoration: 'none',
                      color: 'inherit',
                      transition: 'background var(--duration-fast) var(--ease-signature)',
                    }}
                  >
                    <div className="comp-modal-row-inner">
                      {/* Rank */}
                      <span style={{
                        fontSize: 12.5,
                        color: 'var(--color-text-faint)',
                        fontWeight: 500,
                        width: 16,
                        textAlign: 'right',
                        flexShrink: 0,
                      }}>
                        {i + 1}
                      </span>

                      {/* Thumbnail — matte plate always behind, photo overlays;
                          on a hotlink-block the plate shows through, never a gap */}
                      <div className="comp-modal-thumb" style={{
                        position: 'relative',
                        borderRadius: 8,
                        overflow: 'hidden',
                        flexShrink: 0,
                        background: 'var(--color-bg-elevated)',
                        border: '1px solid color-mix(in srgb, var(--color-butter) 13%, transparent)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}>
                        <span style={{ fontFamily: 'var(--font-inter), sans-serif', fontWeight: 600, fontSize: 20, lineHeight: 1, color: 'color-mix(in srgb, var(--color-butter) 55%, var(--color-text-faint))' }}>
                          {(craftTitle(comp.title) || '?').charAt(0)}
                        </span>
                        {comp.imageUrl && (
                          // .comp-modal-thumb is 52×52 (44×44 on the sheet) —
                          // 160 is 3× the largest box, still ~1/150th the master
                          <PlateImg src={sizedImg(httpsImg(comp.imageUrl), 160)} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                        )}
                      </div>

                      {/* Info */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: 14,
                          fontFamily: "var(--font-serif), serif",
                          fontWeight: 500,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          marginBottom: 3,
                        }}>
                          {comp.title}
                        </div>
                        <div className="comp-modal-meta" style={{
                          fontSize: 12.5,
                          color: 'var(--color-text-faint)',
                        }}>
                          <span style={{ color: compHouseColor, fontWeight: 600 }}>{comp.auctionHouse}</span>
                          <span>&middot;</span>
                          <span>{formatDate(comp.saleDate, { month: 'short', year: 'numeric' })}</span>
                          {comp.medium && (
                            <>
                              <span>&middot;</span>
                              <span style={{
                                maxWidth: 140,
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}>{cleanText(comp.medium)}</span>
                            </>
                          )}
                          {comp.dimensions && (
                            <span className="comp-modal-meta-dims">
                              <span>&middot; </span>
                              {comp.dimensions}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Price + ratio */}
                      <div className="comp-modal-price" style={{ flexShrink: 0 }}>
                        <div style={{
                          fontSize: 14,
                          fontWeight: 500,
                          color: 'var(--color-fg)',
                        }}>
                          {comp.priceUsd ? formatPrice(comp.priceUsd) : '—'}
                        </div>
                        {ratio !== null && (
                          <div style={{
                            fontSize: 12.5,
                            color: 'var(--color-text-secondary)',
                            fontWeight: 500,
                          }}>
                            {ratio >= 1
                              ? signalMagnitude('Below Market', Math.round((ratio - 1) * 100))
                              : signalMagnitude('Above Market', Math.round((1 - ratio) * 100))} est.
                          </div>
                        )}
                      </div>
                    </div>
                  </a>
                );
              })}
            </div>
          )}
        </div>
        )}
      </div>
    </div>
  , document.body);
}
