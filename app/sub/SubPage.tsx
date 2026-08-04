'use client';

/**
 * SubPage — the sub-market dossier. /sub?id=<drill slug> renders one tracked
 * sub-market row from market.json's `drills` (per vertical, A-vs-B splits) as a
 * certificate in the leader grammar: the strongest honest read it supports as
 * the hero figure, a chart when a series exists, then the record / volume /
 * sell-through / coverage as leader rows.
 *
 * Honesty ladder (sacred, mirrors SubMarketDrills + SubMarketDirectory):
 *   · readType 'index'  → CI'd move, mono %, green/red allowed (a REAL CI'd delta)
 *   · readType 'demand' → measured %-over-estimate, mono %, green/red allowed
 *   · readType 'descriptive' → typical $, plain ink, NEVER colored
 * Reference/volume/count figures are never colored; abstain beats wrong.
 */
import React, { useMemo } from 'react';
import Link from 'next/link';
import ArtistNav from '../components/ArtistNav';
import { LOTPAGE_CSS } from '../components/LotPage';
import { Colophon } from '../components/Terminal';
import HeroChart, { type HeroLine } from '../preview/terminal/HeroChart';
import { LAYER_PALETTE } from '../lib/heroLayers';
import { useRayData, type SubMarketRead } from '../hooks/useRayData';
import { useSavedLots } from '../hooks/useSavedLots';
import { MARKETS } from '../constants';
import { subCatLabel } from '../lib/subcat-labels';
import { formatPrice, formatDate, getUpcomingCounts } from '../utils';

type DrillRow = SubMarketRead & { parent: string };

const MARKET_LABEL: Record<string, string> = {};
for (const m of MARKETS) MARKET_LABEL[m.key] = m.label;

const fmtPct0 = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(0)}%`;

/** Rebase a base-100 level series to Δ% off the first visible reading, so the
    index line reads as a move (labeled Δ%), never an unlabeled level. */
function rebaseToDelta(series: { period: string; value: number; n: number }[]): HeroLine['points'] {
  if (!series.length) return [];
  const base = series[0].value || 1;
  return series.map(p => ({ period: p.period, value: (p.value / base - 1) * 100, n: p.n }));
}

/** Pick the strongest honest series for the chart, mapped to a HeroLine.
    index → Δ% (rebased level, unit 'pct'); demand → measured % (unit 'pct');
    hist → yearly typical $ (unit 'money'); vol → sold counts (unit 'count').
    Returns null when no series clears HeroChart's minimum shape. */
function pickChart(row: DrillRow, label: string): HeroLine | null {
  const color = LAYER_PALETTE[0];
  if (row.readType === 'index' && row.indexSeries && row.indexSeries.length >= 4) {
    return { key: row.slug, label: `${label} · Δ%`, color, unit: 'pct', points: rebaseToDelta(row.indexSeries) };
  }
  if (row.readType === 'demand' && row.demandSeries && row.demandSeries.length >= 4) {
    return { key: row.slug, label: `${label} · demand`, color, unit: 'pct', points: row.demandSeries.map(p => ({ period: p.period, value: p.value, n: p.n })) };
  }
  if (row.histSeries && row.histSeries.length >= 4) {
    return { key: row.slug, label: `${label} · typical`, color, unit: 'money', points: row.histSeries.map(p => ({ period: p.period, value: p.value, n: p.n })) };
  }
  if (row.volSeries && row.volSeries.length >= 4) {
    return { key: row.slug, label: `${label} · volume`, color, unit: 'count', points: row.volSeries.map(p => ({ period: p.period, value: p.n, n: p.n })) };
  }
  return null;
}

/** The hero read — the strongest honest figure the row supports. Only index &
    demand may color; descriptive typical-$ is plain ink, always. */
function HeroRead({ row }: { row: DrillRow }) {
  if (row.readType === 'index' && row.index) {
    const v = row.index.changePct;
    return (
      <div style={{ marginTop: 14 }}>
        <span
          style={{ fontFamily: 'var(--font-mono, ui-monospace), monospace', fontSize: 'clamp(34px, 6vw, 52px)', fontWeight: 700, letterSpacing: '-0.02em', color: v >= 0 ? 'var(--color-up)' : 'var(--color-down-text)' }}
        >
          {fmtPct0(v)}
        </span>
        <div style={{ color: 'var(--color-text-muted)', fontSize: 13, marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>
          {row.index.horizon} verified
          {' · '}
          <span style={{ color: 'var(--color-text-faint)' }}>
            CI [{row.index.ciLoPct.toFixed(0)}, {row.index.ciHiPct.toFixed(0)}]
          </span>
          {row.indexMethod ? ` · ${row.indexMethod === 'repeat-sale' ? 'repeat-sale' : 'hedonic'}` : ''}
        </div>
      </div>
    );
  }
  if (row.readType === 'demand' && row.demandNow != null) {
    const v = row.demandNow;
    return (
      <div style={{ marginTop: 14 }}>
        <span
          style={{ fontFamily: 'var(--font-mono, ui-monospace), monospace', fontSize: 'clamp(34px, 6vw, 52px)', fontWeight: 700, letterSpacing: '-0.02em', color: v >= 0 ? 'var(--color-up)' : 'var(--color-down-text)' }}
        >
          {fmtPct0(v)}
        </span>
        <div style={{ color: 'var(--color-text-muted)', fontSize: 13, marginTop: 6 }}>
          measured, vs estimate
        </div>
      </div>
    );
  }
  // descriptive — typical price, PLAIN ink (never colored)
  return (
    <div style={{ marginTop: 14 }}>
      <span style={{ fontSize: 'clamp(30px, 5.5vw, 46px)', fontWeight: 750, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
        {row.typicalUsd != null ? formatPrice(row.typicalUsd) : '—'}
      </span>
      <div style={{ color: 'var(--color-text-muted)', fontSize: 13, marginTop: 6 }}>
        {row.typicalUsd != null ? 'typical price · last 12 months' : 'no verified read — abstaining'}
      </div>
    </div>
  );
}

/** A leader row: label + base on the left, figure on the right. Tones honest —
    only pass a color for real deltas; volume/count/reference figures stay ink. */
function LeaderRow({ label, base, children }: { label: string; base?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 14, alignItems: 'baseline', padding: '11px 0', borderBottom: '2px dotted rgba(255,255,255,0.09)' }}>
      <span style={{ fontSize: 13.5 }}>
        {label}
        {base && <span style={{ color: 'var(--color-text-faint)', fontSize: 12, marginLeft: 8 }}>{base}</span>}
      </span>
      <span style={{ fontSize: 13.5, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{children}</span>
    </div>
  );
}

export default function SubPage({ slug }: { slug: string }) {
  const { market, allLots, lastCrawl, totalLots } = useRayData();
  const { savedIds } = useSavedLots();
  const upcomingCounts = useMemo(() => getUpcomingCounts(allLots), [allLots]);

  // scan every vertical's drills for the matching slug
  const row = useMemo<DrillRow | null>(() => {
    const drills = market?.drills;
    if (!drills) return null;
    for (const vertical of Object.keys(drills)) {
      const hit = drills[vertical].find(r => r.slug === slug);
      if (hit) return hit;
    }
    return null;
  }, [market, slug]);

  // hooks must precede any early return — compute the chart null-safely here
  const chart = useMemo(() => (row ? pickChart(row, row.label || subCatLabel(slug.split(':')[1] || slug)) : null), [row, slug]);

  const nav = <ArtistNav activeSlug="analytics" savedCount={savedIds.length} upcomingCounts={upcomingCounts} lastCrawl={lastCrawl ? formatDate(lastCrawl) : undefined} />;

  if (!row) {
    return (
      <>
        {nav}
        {/* while market.json loads, fill the viewport so the colophon never
            paints on screen and then gets shoved down by the dossier (CLS) */}
        <div className="rail" style={{ paddingBlock: 80, textAlign: 'center', minHeight: market === null ? '100dvh' : undefined, boxSizing: 'border-box' }}>
          {market === null ? (
            <p style={{ color: 'var(--color-text-faint)', fontSize: 14 }}>Loading the sub-market book&hellip;</p>
          ) : (
            <>
              <p style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>Not a tracked sub-market</p>
              <p style={{ color: 'var(--color-text-faint)', fontSize: 13.5, marginTop: 8 }}>
                lectr keeps a dossier only where a split clears its evidence gate.
              </p>
              <p style={{ marginTop: 18 }}>
                <Link href="/analytics" style={{ color: 'var(--color-fg)', fontSize: 13.5 }}>← All sub-markets on Analytics</Link>
              </p>
            </>
          )}
        </div>
        <Colophon record={null} />
      </>
    );
  }

  // human label: prefer the drill's own label, else the slug's part label
  const part = slug.split(':')[1] || slug;
  const label = row.label || subCatLabel(part);
  const verticalLabel = MARKET_LABEL[row.vertical] || row.vertical;
  const parentLabel = subCatLabel(row.parent);

  return (
    <>
      {nav}
      <div className="rail" style={{ paddingTop: 'var(--space-4)', paddingBottom: 40 }}>
        <style dangerouslySetInnerHTML={{ __html: LOTPAGE_CSS }} />
        <p className="ray-hero2-label" style={{ marginBottom: 6 }}>
          <Link href="/analytics" style={{ color: 'inherit', textDecoration: 'none' }}>{verticalLabel}</Link>
          {' · sub-market dossier'}
        </p>
        <h1 style={{ fontSize: 'clamp(28px, 5vw, 44px)', fontWeight: 750, letterSpacing: '-0.02em', margin: 0 }}>
          {label}
        </h1>
        <p style={{ color: 'var(--color-text-muted)', fontSize: 13.5, margin: '10px 0 0', lineHeight: 1.55 }}>
          {parentLabel && parentLabel !== label ? <>{parentLabel} · </> : null}
          {row.lots.toLocaleString()} lots tracked
          {row.estCoverage != null && row.estCoverage > 0 && <> · {Math.round(row.estCoverage * 100)}% carry estimates</>}
        </p>

        <HeroRead row={row} />

        {chart && (
          <section style={{ marginTop: 30 }} aria-label={`${label} series`}>
            <div className="lectr-lot-comps-head">
              <span>
                {row.readType === 'index' ? 'Verified index · rebased Δ%'
                  : row.readType === 'demand' ? 'Demand vs estimate · quarterly'
                  : chart.unit === 'money' ? 'Typical price · yearly'
                  : 'Sales volume · quarterly'}
              </span>
              <span className="ctx">every point a real reading</span>
            </div>
            <div style={{ marginTop: 10 }}>
              <HeroChart anchor={chart} play={false} height={220} />
            </div>
          </section>
        )}

        <section style={{ marginTop: 34 }} aria-label="The record behind the read">
          <div className="lectr-lot-comps-head">
            <span>The record</span>
            <span className="ctx">measured, never modeled</span>
          </div>
          <div style={{ marginTop: 6 }}>
            {row.record && (
              <LeaderRow label={row.record.title || 'Top result'} base={[row.record.house || null, row.record.date ? formatDate(row.record.date, { month: 'short', year: 'numeric' }) : null].filter(Boolean).join(' · ') || undefined}>
                <span style={{ fontWeight: 650 }}>{formatPrice(row.record.usd)}</span>
              </LeaderRow>
            )}
            <LeaderRow label="Lots tracked" base="observed volume">
              {row.lots.toLocaleString()}
            </LeaderRow>
            {row.sellThroughPct != null && (
              <LeaderRow label="Sell-through" base="of lots offered">
                <span style={{ fontFamily: 'var(--font-mono, ui-monospace), monospace' }}>{Math.round(row.sellThroughPct)}%</span>
              </LeaderRow>
            )}
            <LeaderRow label="Estimate coverage" base="carry a house estimate">
              <span style={{ fontFamily: 'var(--font-mono, ui-monospace), monospace' }}>{Math.round((row.estCoverage || 0) * 100)}%</span>
            </LeaderRow>
            {row.typicalUsd != null && row.readType !== 'descriptive' && (
              <LeaderRow label="Typical price" base="median, last 12 months">
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatPrice(row.typicalUsd)}</span>
              </LeaderRow>
            )}
            {row.bidCompNow != null && (
              <LeaderRow label="Bid competition" base="median bids/lot, latest qtr">
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{row.bidCompNow.toLocaleString()}</span>
              </LeaderRow>
            )}
          </div>
          <p style={{ fontSize: 11.5, color: 'var(--color-text-faint)', margin: '16px 0 0', lineHeight: 1.5 }}>
            {row.readType === 'index'
              ? 'The move is a CI-resolved index — it publishes only when the confidence interval clears the sign.'
              : row.readType === 'demand'
              ? 'Demand is the measured median realized price over the house estimate — an observed fact, not a forecast.'
              : 'A descriptive read: the typical price and the record, with no move claimed where the evidence can’t verify one.'}
          </p>
        </section>

        <p style={{ marginTop: 30 }}>
          <Link href="/analytics" style={{ color: 'var(--color-fg)', fontSize: 13.5, textDecoration: 'none' }}>← All sub-markets on Analytics</Link>
          <span style={{ color: 'var(--color-text-faint)', margin: '0 10px' }}>·</span>
          <Link href="/makers" style={{ color: 'var(--color-text-muted)', fontSize: 13.5, textDecoration: 'none' }}>The taxonomy on Makers</Link>
        </p>
      </div>
      <Colophon record={null} />
    </>
  );
}
