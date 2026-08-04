'use client';

import { useMemo, useState, type CSSProperties } from 'react';
import { ResponsiveContainer, AreaChart, Area, YAxis, Tooltip, ReferenceLine } from 'recharts';
import { AuctionLot, MarketStats } from '../types';
import { formatPrice } from '../utils';
import { demandSeries, formatDemand } from '../lib/demand';
import CountUp from './CountUp';
import RecordBand from './RecordBand';
import RecordPlate, { type PlateSale } from './RecordPlate';
import Flick from './Flick';
import { useChartDraw } from '../hooks/useChartDraw';
import { useRayData } from '../hooks/useRayData';
import MethodologyNote from './MethodologyNote';
import ArtistAvatar from './ArtistAvatar';
import DeskNote from './analytics/DeskNote';
import type { Market } from '../constants';

type Range = '1Y' | '5Y' | 'MAX';

/* the terminal numeral register for the maker hero (Wave 3 editorial pass) */
const heroNumStyle: CSSProperties = {
  fontFamily: 'var(--font-mono), monospace',
  fontWeight: 500,
  letterSpacing: '-0.02em',
  fontVariantNumeric: 'tabular-nums',
};

/**
 * ArtistHero — the artist as a demand curve. The numeral is how their typical
 * sale performs against its own estimate (trailing 12 months) and the line is
 * that same quantity through time — mix-proof: every lot is normalized by its
 * own ask, so a print quarter and a canvas quarter read on the same scale.
 * The dashed zero line is "sells at estimate". Price context (typical sale,
 * record) lives in the sentence; the medium lens splits editions from unique
 * works when both sides have the sales to draw honestly.
 */
import FollowButton from './FollowButton';

export default function ArtistHero({
  animate: anim = true,
  slug,
  label,
  stats,
  lots,
  upcomingCount,
  bidMarket = false,
  market,
  serial,
}: {
  /** false on cached back-nav — numbers land resolved, no re-count */
  animate?: boolean;
  slug?: string;
  label: string;
  stats: MarketStats | null;
  lots: AuctionLot[];
  /** the page's date-filtered live-lot count — the ONE number that must
      equal the cards actually rendered in the Upcoming section below */
  upcomingCount?: number;
  /** sports/science: bid sales with NO house estimates — the vs-estimate
      Demand Index is meaningless there (it was reading a handful of ancient
      estimate-bearing rows and headlining a stale −45%). These heroes read
      the REALIZED tape instead: quarterly median sale price. */
  bidMarket?: boolean;
  /** the maker's market — the current-quarter desk-note cross-link */
  market?: Market;
  /** crawl-day YYYYMMDD for the record card's certificate footer */
  serial?: string;
}) {
  const [range, setRange] = useState<Range>('MAX');
  const [hover, setHover] = useState<{ date: string; value: number } | null>(null);
  const drawRef = useChartDraw();
  const [lens, setLens] = useState<'all' | 'original' | 'print'>('all');

  const lensCounts = useMemo(() => {
    const sold = lots.filter(l => l.status === 'sold' && l.priceUsd);
    return {
      original: sold.filter(l => l.category === 'original').length,
      print: sold.filter(l => l.category === 'print').length,
    };
  }, [lots]);
  const showLens = lensCounts.original >= 8 && lensCounts.print >= 8;

  const lensLots = useMemo(() => {
    if (lens === 'all' || !showLens) return lots;
    return lots.filter(l => l.category === lens);
  }, [lots, lens, showLens]);

  // The headline series: Demand Index (vs estimate) for estimate markets;
  // quarterly MEDIAN REALIZED for bid markets (no estimates exist to divide by).
  const series = useMemo<{ date: string; value: number }[]>(() => {
    if (!bidMarket) return demandSeries(lensLots);
    // Bid markets (cards, sports objects, culture): prefer the authoritative
    // full-corpus quarterly median from stats.json. The loaded `lensLots` is a
    // slim sample for these corpus-only/archive verticals, so computing the
    // series from it is sparse/empty — the artist-page chart went blank. Only
    // the whole-slug view (no category lens) maps to the stat.
    if (stats?.priceHistory?.length && (lens === 'all' || !showLens)) {
      return stats.priceHistory
        .filter(p => p.medianPrice > 0)
        .map(p => ({ date: p.date.replace('-', ' '), value: p.medianPrice }));
    }
    const byQ = new Map<string, { end: number; prices: number[] }>();
    for (const l of lensLots) {
      if (l.status !== 'sold' || !l.priceUsd) continue;
      const d = new Date(l.saleDate);
      if (isNaN(d.getTime()) || d.getTime() > Date.now()) continue;
      const q = Math.floor(d.getUTCMonth() / 3);
      const key = `${d.getUTCFullYear()} Q${q + 1}`;
      const cur = byQ.get(key) || { end: Date.UTC(d.getUTCFullYear(), q * 3 + 3, 1), prices: [] };
      cur.prices.push(l.priceUsd);
      byQ.set(key, cur);
    }
    return Array.from(byQ.entries())
      .filter(([, v]) => v.prices.length >= 5)
      .sort((a, b) => a[1].end - b[1].end)
      .map(([date, v]) => {
        const s = v.prices.sort((a, b) => a - b);
        const m = Math.floor(s.length / 2);
        return { date, value: s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 };
      });
  }, [lensLots, bidMarket, stats, lens, showLens]);

  // STALE GATE: a series whose newest quarter is >13 months old must never
  // headline as "trailing 12 months" — the hero falls back to price facts.
  const fresh = useMemo(() => {
    if (!series.length) return false;
    const last = series[series.length - 1].date; // "YYYY Qn"
    const y = parseInt(last.slice(0, 4), 10);
    const q = parseInt(last.slice(-1), 10);
    const endMs = Date.UTC(y, q * 3, 1);
    return Date.now() - endMs < 13 * 30.44 * 86_400_000;
  }, [series]);

  const visible = useMemo(() => {
    if (range === '1Y') return series.slice(-4);
    if (range === '5Y') return series.slice(-20);
    return series;
  }, [series, range]);

  const now = series.length ? series[series.length - 1].value : 0;
  const yearAgo = series.length >= 5 ? series[series.length - 5].value : null;
  const delta = yearAgo === null ? null : now - yearAgo;
  // Color says direction, never level: the chart line and ambient tone follow
  // the visible period's trend; the level numeral stays foreground-white.
  const dir = visible.length >= 2 ? visible[visible.length - 1].value - visible[0].value : 0;
  const lineColor = dir >= 0 ? 'var(--color-up)' : 'var(--color-down)';

  // Price context: median sale of the trailing 12 months (per lens).
  const typicalSale = useMemo(() => {
    // authoritative trailing-12mo median from stats.json for the whole slug
    // (loaded sample is sparse for cards/culture); else compute from the lens.
    if (bidMarket && stats?.medianPriceLast12Months && (lens === 'all' || !showLens)) {
      return stats.medianPriceLast12Months;
    }
    const cutoff = Date.now() - 365 * 86_400_000;
    const prices = lensLots
      .filter(l => l.status === 'sold' && l.priceUsd && new Date(l.saleDate).getTime() >= cutoff)
      .map(l => l.priceUsd!)
      .sort((a, b) => a - b);
    if (prices.length < 3) return null;
    const m = Math.floor(prices.length / 2);
    return prices.length % 2 === 0 ? (prices[m - 1] + prices[m]) / 2 : prices[m];
  }, [lensLots, bidMarket, stats, lens, showLens]);

  const facts = useMemo(() => {
    const concluded = lots.filter(l => l.status === 'sold' || l.status === 'bought_in');
    const soldCount = concluded.filter(l => l.status === 'sold').length;
    const sellThrough = concluded.length >= 5 ? Math.round((soldCount / concluded.length) * 100) : null;
    // Lots-tracked and house count are FULL-CORPUS facts — read them from
    // stats.json (built over every sold lot), NOT the loaded `lots` array,
    // which for non-archive makers is only a slim/top-sold sample and would
    // badly undercount. Fall back to the loaded set only if no stats row exists.
    const houses = stats?.houseDistribution?.length ?? new Set(lots.map(l => l.auctionHouse)).size;
    const total = stats?.totalLotsTracked ?? lots.length;
    // bid markets: every no-reserve lot concludes 'sold', so sell-through is
    // a constant 100% — count the past year's sales instead. On corpus-only
    // slugs (cards/sports) the loaded `lots` is a slim sample, so read the
    // authoritative count from stats.json: Σ totalSales over the trailing 4
    // quarters of priceHistory (mirrors the series/typicalSale stats path).
    const cutoff = Date.now() - 365 * 86_400_000;
    const sold12mo = bidMarket && stats?.priceHistory?.length
      ? stats.priceHistory.slice(-4).reduce((s, p) => s + (p.totalSales || 0), 0)
      : lots.filter(l =>
          l.status === 'sold' && l.priceUsd && new Date(l.saleDate).getTime() >= cutoff
        ).length;
    return { sellThrough, houses, total, sold12mo };
  }, [lots, stats, bidMarket]);

  // The live-lot count comes from the page (date-filtered, the same list the
  // Upcoming section renders) — never a stale status count. The internal
  // fallback survives only for callers that pass no count.
  const liveCount = upcomingCount ?? lots.filter(l => l.status === 'upcoming').length;

  const recordYear = stats?.recordDate ? new Date(stats.recordDate).getUTCFullYear() : null;
  const lensWord = lens === 'original' ? 'unique work' : lens === 'print' ? 'edition' : 'sale';

  // M8 — the record sale as a framed plate in the hero's right quadrant.
  // The photograph hangs only when the loaded lots actually carry the record
  // sale's image; the engraved certificate stands either way.
  const recordLot = useMemo(() => {
    if (!stats?.recordPrice) return null;
    return lots.find(l => l.status === 'sold' && l.priceUsd === stats.recordPrice && l.imageUrl) || null;
  }, [lots, stats]);

  // CLS: stats.recordPrice rides phase 1, but the record LOT (and so its photo)
  // only resolves once the phase-2 corpus lands — so the plate first painted
  // certificate-only and then grew by the image well's 190px + 12px margin when
  // the photo arrived. Measured 0.346 on /makers/kaws (C3 baseline 0.222), the
  // shift landing ~1.4s in. Hold the well's space while phase 2 could still
  // deliver it, and stop holding once fullLoaded proves it never will — a record
  // with genuinely no photo must not sit above a permanently empty frame.
  const { fullLoaded } = useRayData();
  const recordImagePending = !!stats?.recordPrice && !recordLot && !fullLoaded;

  // #33 — the ROTATING VITRINE deck: the top-3 realized sales the loaded lots
  // carry, record first. Built from the loaded set (honest to what's on the
  // page), then the authoritative record from stats.json is spliced in at the
  // top if the loaded set doesn't already reach it (the corpus record can
  // outrank the loaded sample on cards/culture). Each carries its own lot door.
  const topSales = useMemo(() => {
    const sold = lots
      .filter(l => l.status === 'sold' && l.priceUsd && l.priceUsd > 0)
      .sort((a, b) => (b.priceUsd! - a.priceUsd!));
    const deck: PlateSale[] = sold.slice(0, 3).map(l => ({
      figure: l.priceUsd!,
      date: l.saleDate || null,
      house: l.auctionHouse || null,
      title: l.title || null,
      imageUrl: l.imageUrl || null,
      href: `/lot?id=${encodeURIComponent(l.id)}`,
    }));
    // ensure the stats.json record heads the deck when the sample missed it
    if (stats?.recordPrice && (!deck.length || deck[0].figure < stats.recordPrice)) {
      deck.unshift({
        figure: stats.recordPrice,
        date: stats.recordDate || null,
        house: stats.recordHouse || null,
        title: stats.recordTitle || null,
        imageUrl: recordLot?.imageUrl || null,
        href: recordLot ? `/lot?id=${encodeURIComponent(recordLot.id)}` : null,
      });
    }
    return deck.slice(0, 3);
  }, [lots, stats, recordLot]);

  return (
    <section className="ray-hero2 rail" data-tone={dir >= 0 ? 'up' : 'down'}>
      <div className="lectr-dossier-hero" style={{ marginBottom: 4 }}>
        <div style={{ minWidth: 0 }}>
          {/* M8 — the maker's name in Fraunces display (was buried in the label line) */}
          <h1 className="lectr-dossier-name" style={{ marginBottom: 10 }}>{label}</h1>
          <p className="ray-hero2-label" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}>
              <ArtistAvatar label={label} size={26} />
              {bidMarket
                ? (hover ? `Median realized sale · ${hover.date}` : 'Median realized sale, by quarter')
                : hover
                  ? `Typical ${lensWord} vs estimate · 12 months to ${hover.date}`
                  : fresh
                    ? `Typical ${lensWord} vs its estimate, trailing 12 months`
                    : 'Recent sales'}
            </span>
            <MethodologyNote trigger="what is this?" />
            {slug && <span style={{ marginLeft: 'auto' }}><FollowButton slug={slug} name={label} /></span>}
          </p>
          {/* the maker's hero numeral speaks the terminal numeral register —
              mono 500 tabular (scoped here: .ray-hero2-value is shared with
              /profile and the board, which keep their own faces). The NAME is
              the page's h1 now; the numeral is display, not heading. */}
          {hover ? (
            <div className="ray-hero2-value" style={heroNumStyle}>{bidMarket ? formatPrice(hover.value) : formatDemand(hover.value)}</div>
          ) : (
            <div className="ray-hero2-value" style={heroNumStyle}>
              {/* Distinct keys per QUANTITY: the three branches sit at the same
                  tree position, so without keys React reuses one CountUp
                  instance across a branch switch — and CountUp eases from the
                  value on screen. When phase-2 flips the hero from the record
                  price to the demand %, that eased $31M → +28% as a fabricated
                  "+31,186,000%" sweep. A key change remounts, so a quantity
                  switch sweeps honestly from 0 (reduced motion still paints
                  the final figure directly). */}
              {series.length && fresh
                ? <CountUp key={bidMarket ? 'hero-median' : 'hero-demand'} animate={anim} to={now} format={bidMarket ? formatPrice : formatDemand} duration={1000} />
                : typicalSale !== null
                  ? <CountUp key="hero-typical" animate={anim} to={typicalSale} format={formatPrice} duration={1000} />
                  : stats?.recordPrice
                    ? <CountUp key="hero-record" animate={anim} to={stats.recordPrice} format={formatPrice} duration={1000} />
                    : '—'}
            </div>
          )}
          <p className="ray-hero2-delta">
        {fresh && delta !== null && Math.round(delta) !== 0 && yearAgo !== null && (
          <span className={delta > 0 ? 'up' : 'down'} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <Flick size={10} style={{ transform: delta > 0 ? undefined : 'scaleY(-1)' }} />
            {delta > 0 ? 'heating' : 'cooling'} · was {bidMarket ? formatPrice(yearAgo) : formatDemand(yearAgo)} a year ago
          </span>
        )}
        {/* price context stays ONE token: the typical sale. The record lives
            on THE MAKER'S RECORD card just below — never printed twice. */}
        <span className="ctx">
          {(() => {
            // suppressed when the big numeral IS the typical sale already
            const typicalToken = !fresh && !series.length && typicalSale !== null
              ? null
              : typicalSale !== null ? `typical ${lensWord} ${formatPrice(typicalSale)}` : null;
            return (
              <>
                {typicalToken}
                {liveCount > 0 && (
                  <>
                    {typicalToken ? ' · ' : ''}
                    <a href="#upcoming" style={{ color: 'inherit', textDecorationColor: 'var(--color-border-mid)', textUnderlineOffset: 3 }}>
                      {liveCount} live {liveCount === 1 ? 'lot' : 'lots'}
                    </a>
                  </>
                )}
              </>
            );
          })()}
        </span>
      </p>

          {/* the market's current-quarter note from the desk */}
          {market && <DeskNote market={market} style={{ marginTop: 6 }} />}
        </div>

        {/* M8 — the record plate fills the dead right quadrant (≥900px) */}
        {stats?.recordPrice ? (
          <RecordPlate
            label="Record sale"
            figure={stats.recordPrice}
            date={stats.recordDate || null}
            house={stats.recordHouse || null}
            title={stats.recordTitle || null}
            imageUrl={recordLot?.imageUrl || null}
            href={recordLot ? `/lot?id=${encodeURIComponent(recordLot.id)}` : null}
            sales={topSales.length >= 2 ? topSales : undefined}
            imagePending={recordImagePending}
          />
        ) : null}
      </div>

      {visible.length >= 2 && (
        <>
          <div key={`${range}-${lens}`} ref={drawRef} className="ray-hero2-chart ray-chartfade ray-chart-draw" style={{ height: 230 }} onMouseLeave={() => setHover(null)}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={visible}
                margin={{ top: 8, right: 0, left: 0, bottom: 0 }}
                onMouseMove={(s: { activePayload?: Array<{ payload: { date: string; value: number } }> }) => {
                  const p = s?.activePayload?.[0]?.payload;
                  if (p) setHover({ date: p.date, value: p.value });
                }}
                onMouseLeave={() => setHover(null)}
              >
                <defs>
                  <linearGradient id="artistHeroGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={lineColor} stopOpacity={0.13} />
                    <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <YAxis hide domain={bidMarket ? [(min: number) => min * 0.85, (max: number) => max * 1.05] : [(min: number) => Math.min(0, min), (max: number) => Math.max(0, max)]} />
                {!bidMarket && <ReferenceLine y={0} stroke="var(--color-border-mid)" strokeDasharray="4 4" />}
                <Tooltip content={() => null} cursor={{ stroke: 'var(--color-border-mid)', strokeWidth: 1 }} />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={lineColor}
                  strokeWidth={2.25}
                  fill="url(#artistHeroGrad)"
                  dot={false}
                  activeDot={{ r: 4, fill: lineColor, stroke: 'var(--color-bg)', strokeWidth: 2 }}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="ray-hero2-span" aria-hidden="true">
            <span>{visible[0].date}</span>
            <span style={{ color: 'var(--color-text-faint)' }}>{bidMarket ? 'median realized per quarter' : '0% = sells at estimate'}</span>
            <span>{visible[visible.length - 1].date}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <div className="ray-hero2-ranges" role="radiogroup" aria-label="Chart range">
              {(['1Y', '5Y', 'MAX'] as Range[]).map(r => (
                <button
                  key={r}
                  role="radio"
                  aria-checked={range === r}
                  className="ray-range-btn"
                  data-active={range === r}
                  onClick={() => { setRange(r); setHover(null); }}
                >
                  {r === 'MAX' ? 'Max' : r}
                </button>
              ))}
            </div>
            {showLens && (
              <div className="ray-seg" role="radiogroup" aria-label="Medium">
                {([['all', 'All'], ['original', 'Unique works'], ['print', 'Editions']] as const).map(([key, lbl]) => (
                  <button
                    key={key}
                    role="radio"
                    aria-checked={lens === key}
                    className="ray-seg-btn"
                    data-active={lens === key}
                    onClick={() => { setLens(key); setHover(null); }}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* the maker's record as a printed certificate CARD — the hero sits
          inside .rail, so the paper can't run full-bleed here; .ray-paper
          flips the tokens and the drawn border stands in for the band rule */}
      <div
        className="ray-paper"
        style={{ marginTop: 28, border: '1px solid var(--paper-edge)', borderRadius: 12, padding: '18px 20px 12px' }}
      >
        <RecordBand
          serial={serial}
          title={'The maker’s record'}
          context={label}
          footer="read nightly from the tape"
          cells={[
            {
              k: 'Record sale',
              v: stats?.recordPrice ? <CountUp animate={anim} to={stats.recordPrice} format={formatPrice} duration={1200} /> : '—',
              sub: stats?.recordTitle
                ? `${stats.recordTitle.length > 34 ? stats.recordTitle.slice(0, 32) + '…' : stats.recordTitle}${recordYear ? `, ${recordYear}` : ''}`
                : 'no concluded sales yet',
            },
            // no-reserve bid markets conclude every lot 'sold' — a constant
            // "Sell-through 100%" cell says nothing, so count the year instead
            bidMarket
              ? {
                  k: 'Sales, past 12 mo',
                  v: <CountUp animate={anim} to={facts.sold12mo} format={n => Math.round(n).toLocaleString()} duration={1200} />,
                  sub: 'sold, trailing 12 months',
                }
              : {
                  k: 'Sell-through',
                  v: facts.sellThrough !== null ? <CountUp animate={anim} to={facts.sellThrough} format={n => `${Math.round(n)}%`} duration={1200} /> : '—',
                  sub: 'of concluded lots found buyers',
                },
            {
              k: 'Lots tracked',
              v: <CountUp animate={anim} to={facts.total} format={n => Math.round(n).toLocaleString()} duration={1200} />,
              sub: liveCount > 0
                ? <a href="#upcoming" style={{ color: 'inherit', textUnderlineOffset: 3 }}>{liveCount} live right now</a>
                : `${liveCount} live right now`,
            },
            {
              k: 'Auction houses',
              v: <CountUp animate={anim} to={facts.houses} format={n => `${Math.round(n)}`} duration={1200} />,
              sub: 'selling this maker',
            },
          ]}
        />
      </div>
    </section>
  );
}
