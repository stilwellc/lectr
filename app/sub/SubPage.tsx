'use client';

/**
 * SubPage — the sub-market dossier. /sub/<group>/<part> renders one tracked
 * sub-market row from market.json's `drills` (per vertical, A-vs-B splits) as a
 * certificate in the north-star grammar: quiet kicker → light title → byline
 * ledger → the strongest honest read as a color cell (the lamp) → the series
 * in a framed chart → the record / volume / sell-through / coverage as dotted
 * spec rows.
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
import { signedPct, dirOf } from '../components/SubMarketDirectory';
import '../northstar-pages.css';

type DrillRow = SubMarketRead & { parent: string };

const MARKET_LABEL: Record<string, string> = {};
for (const m of MARKETS) MARKET_LABEL[m.key] = m.label;


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

/** The hero read as a color cell — the strongest honest figure the row
    supports, on the ground the signal earns. dir comes strictly from the
    read's own sign: index & demand may light up (a real measured delta);
    descriptive typical-$ is the ink cell, always. */
function HeroRead({ row }: { row: DrillRow }) {
  if (row.readType === 'index' && row.index) {
    const v = row.index.changePct;
    return (
      <div className="ns-cell ns-cell-color nsp-read" data-dir={dirOf(v) ?? 'ink'}>
        <span className="ns-cell-label">Verified index · {row.index.horizon}</span>
        <span className="nsp-read-stat">{signedPct(v)}</span>
        <span className="ns-cell-body">
          95% interval [{row.index.ciLoPct.toFixed(0)}, {row.index.ciHiPct.toFixed(0)}]
          {row.indexMethod ? ` · ${row.indexMethod === 'repeat-sale' ? 'repeat-sale' : 'hedonic'} fit` : ''}
          {' · publishes only when the interval clears the sign'}
        </span>
      </div>
    );
  }
  if (row.readType === 'demand' && row.demandNow != null) {
    const v = row.demandNow;
    return (
      <div className="ns-cell ns-cell-color nsp-read" data-dir={dirOf(v) ?? 'ink'}>
        <span className="ns-cell-label">Demand · vs estimate</span>
        <span className="nsp-read-stat">{signedPct(v)}</span>
        <span className="ns-cell-body">
          median realized price over the house estimate, trailing year — an observed fact, not a forecast
        </span>
      </div>
    );
  }
  // descriptive — typical price, the INK cell (never colored)
  return (
    <div className="ns-cell ns-cell-color nsp-read" data-dir="ink">
      <span className="ns-cell-label">{row.typicalUsd != null ? 'Typical price · last 12 months' : 'No verified read'}</span>
      <span className="nsp-read-stat">{row.typicalUsd != null ? formatPrice(row.typicalUsd) : '—'}</span>
      <span className="ns-cell-body">
        {row.typicalUsd != null
          ? 'a descriptive read — the median sale, with no move claimed where the evidence can’t verify one'
          : 'abstaining — no split here clears the evidence gate'}
      </span>
    </div>
  );
}

/** A spec row on the dotted ledger: label (+ base) left, figure right. Tones
    honest — only pass a tone for real deltas; volume/count/reference figures
    stay ink. */
function SpecRow({ label, title, base, mono, children }: { label?: string; title?: string; base?: string; mono?: boolean; children: React.ReactNode }) {
  return (
    <div className="ns-ledger-row">
      <span className="nsp-lk">
        {title ? <span className="t">{title}</span> : label}
        {base && <span className="nsp-lsub">{base}</span>}
      </span>
      <span className="nsp-lval">
        <span className={`nsp-lv${mono ? ' mono' : ''}`}>{children}</span>
      </span>
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
    const loading = market === null;
    return (
      <div className="terminal-shell">
        {nav}
        {/* while market.json loads, fill the viewport so the colophon never
            paints on screen and then gets shoved down by the dossier (CLS) */}
        <div className="rail nsp-empty" style={{ minHeight: loading ? '100dvh' : undefined }}>
          {loading ? (
            <p>Loading the sub-market book&hellip;</p>
          ) : (
            <>
              <span className="ns-kicker">Sub-market dossier</span>
              <h1>Not a tracked sub-market</h1>
              <p>lectr keeps a dossier only where a split clears its evidence gate.</p>
              <div className="nsp-links">
                <Link href="/sub" className="ray-call-btn ray-call-btn-quiet" style={{ textDecoration: 'none' }}>Every sub-market</Link>
                <Link href="/analytics" className="ray-call-btn ray-call-btn-quiet" style={{ textDecoration: 'none' }}>The research desk</Link>
              </div>
            </>
          )}
        </div>
        <Colophon lotCount={totalLots || allLots.length} record={null} />
      </div>
    );
  }

  // human label: prefer the drill's own label, else the slug's part label
  const part = slug.split(':')[1] || slug;
  const label = row.label || subCatLabel(part);
  const verticalLabel = MARKET_LABEL[row.vertical] || row.vertical;
  // the parent names a grouping only when it isn't the vertical itself
  // ('tcg' under TCG, 'art' under Art print nothing)
  const rawParent = subCatLabel(row.parent);
  const parentLabel = rawParent.toLowerCase() === row.vertical.toLowerCase() || rawParent.toLowerCase() === verticalLabel.toLowerCase() ? '' : rawParent;
  const readWord = row.readType === 'index' ? 'a verified index move'
    : row.readType === 'demand' ? 'measured demand against the house estimate'
    : 'the typical price and the record';

  return (
    <div className="terminal-shell">
      {nav}
      <div className="rail nsp-doss">
        <style dangerouslySetInnerHTML={{ __html: LOTPAGE_CSS }} />

        <div className="nsp-kicker-row">
          <span className="ns-kicker">
            <Link href="/sub">Sub-markets</Link>
            {' · '}
            <Link href={`/analytics/${row.vertical}`}>{verticalLabel}</Link>
            {parentLabel && parentLabel !== label ? <>{' · '}{parentLabel}</> : null}
          </span>
          <span className="no">{row.lots.toLocaleString()} lots</span>
        </div>
        <h1 className="nsp-h1">{label}</h1>
        <p className="nsp-dek">
          One tracked sub-market, read at the strength its data supports — {readWord}, with the record and the
          coverage behind it. Measured, never modeled.
        </p>

        {/* the byline ledger — the split's provenance columns */}
        <div className="ns-byline nsp-byline">
          <div>
            <div className="k">Market</div>
            <div className="v">{verticalLabel}</div>
            {parentLabel && parentLabel !== label && <div className="s">{parentLabel}</div>}
          </div>
          <div>
            <div className="k">Lots tracked</div>
            <div className="v">{row.lots.toLocaleString()}</div>
            <div className="s">observed volume</div>
          </div>
          <div>
            <div className="k">Read</div>
            <div className="v">{row.readType === 'index' ? 'Verified index' : row.readType === 'demand' ? 'Measured demand' : 'Descriptive'}</div>
            <div className="s">
              {row.readType === 'index' ? 'CI-resolved, sign verified' : row.readType === 'demand' ? 'vs the house estimate' : 'no move claimed'}
            </div>
          </div>
          {row.estCoverage != null && row.estCoverage > 0 && (
            <div>
              <div className="k">Carry estimates</div>
              <div className="v"><span className="mono">{Math.round(row.estCoverage * 100)}%</span></div>
              <div className="s">of lots, a house estimate</div>
            </div>
          )}
        </div>

        <HeroRead row={row} />

        {chart && (
          <section className="nsp-section ns-plate" aria-label={`${label} series`}>
            <div className="nsp-shead">
              <div>
                <span className="ns-kicker">The line</span>
                <h2 className="nsp-h2">
                  {row.readType === 'index' ? 'Verified index, rebased Δ%'
                    : row.readType === 'demand' ? 'Demand vs estimate, quarterly'
                    : chart.unit === 'money' ? 'Typical price, yearly'
                    : 'Sales volume, quarterly'}
                </h2>
              </div>
              <span className="nsp-shctx">every point a real reading</span>
            </div>
            <div className="nsp-chart">
              <HeroChart anchor={chart} play={false} height={220} />
            </div>
          </section>
        )}

        <section className="nsp-section ns-plate" aria-label="The record behind the read">
          <div className="nsp-shead">
            <div>
              <span className="ns-kicker">The record</span>
              <h2 className="nsp-h2">What the book shows</h2>
            </div>
            <span className="nsp-shctx">measured, never modeled</span>
          </div>
          <div className="nsp-ledger">
            {row.record && (
              <SpecRow
                title={row.record.title || 'Top result'}
                base={[row.record.house || null, row.record.date ? formatDate(row.record.date, { month: 'short', year: 'numeric' }) : null].filter(Boolean).join(' · ') || undefined}
              >
                {formatPrice(row.record.usd)}
              </SpecRow>
            )}
            <SpecRow label="Lots tracked" base="observed volume">
              {row.lots.toLocaleString()}
            </SpecRow>
            {row.sellThroughPct != null && (
              <SpecRow label="Sell-through" base="of lots offered" mono>
                {Math.round(row.sellThroughPct)}%
              </SpecRow>
            )}
            <SpecRow label="Estimate coverage" base="carry a house estimate" mono>
              {Math.round((row.estCoverage || 0) * 100)}%
            </SpecRow>
            {row.typicalUsd != null && row.readType !== 'descriptive' && (
              <SpecRow label="Typical price" base="median, last 12 months">
                {formatPrice(row.typicalUsd)}
              </SpecRow>
            )}
            {row.bidCompNow != null && (
              <SpecRow label="Bid competition" base="median bids per lot, latest quarter">
                {row.bidCompNow.toLocaleString()}
              </SpecRow>
            )}
          </div>
          <p className="nsp-note">
            {row.readType === 'index'
              ? 'The move is a CI-resolved index — it publishes only when the confidence interval clears the sign.'
              : row.readType === 'demand'
              ? 'Demand is the measured median realized price over the house estimate — an observed fact, not a forecast.'
              : 'A descriptive read: the typical price and the record, with no move claimed where the evidence can’t verify one.'}
          </p>
        </section>

        <div className="nsp-links">
          <Link href="/sub" className="ray-call-btn ray-call-btn-quiet" style={{ textDecoration: 'none' }}>Every sub-market</Link>
          <Link href={`/analytics/${row.vertical}`} className="ray-call-btn ray-call-btn-quiet" style={{ textDecoration: 'none' }}>{verticalLabel} on the desk</Link>
          <Link href="/makers" className="ray-call-btn ray-call-btn-quiet" style={{ textDecoration: 'none' }}>The taxonomy on Makers</Link>
        </div>
      </div>
      <Colophon lotCount={totalLots || allLots.length} record={null} />
    </div>
  );
}
