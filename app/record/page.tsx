'use client';

import { useEffect, useMemo } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import ArtistNav from '../components/ArtistNav';
import RecordBand from '../components/RecordBand';
import Masthead, { Accent } from '../components/Masthead';
import Flick from '../components/Flick';
import { Colophon } from '../components/Terminal';
import { useRayData } from '../hooks/useRayData';
import { useSavedLots } from '../hooks/useSavedLots';
import { getUpcomingCounts, formatDate, fmtSignedPct, localToday, isLiveUpcoming } from '../utils';
import type { Backtest } from '../hooks/useRayData';
// The record's numbers are REAL and BUILD-TIME: backtest.json is the nightly
// replay's own output (4KB), imported statically so the +13/−6/n figures sit
// in the prerendered HTML — a skeptic viewing source sees the same numbers
// the page claims. The runtime payload (useRayData) only adds the live
// abstention ratio.
import backtestJson from '../../public/data/ray/backtest.json';
import meta from '../../public/data/ray/meta.json';

// recharts stays out of the initial bundle — the house rule (value/analytics)
const RecordByYear = dynamic(() => import('../components/RecordByYear'), {
  ssr: false,
  loading: () => <div style={{ height: 240, margin: '30px 0', borderRadius: 12, background: 'var(--color-surface)', opacity: 0.5 }} aria-hidden />,
});
const CalibrationCurve = dynamic(() => import('../components/analytics/CalibrationCurve'), { ssr: false });

const backtest = backtestJson as unknown as Backtest;

/**
 * /record — the investor's page: the ENTIRE track record on one certificate.
 * Everything here is measured from the nightly temporal-holdout replay
 * (backtest.json) — no number on this page is modeled, projected or chosen.
 */
export default function RecordPage() {
  const { allLots, lastCrawl } = useRayData();
  const { savedIds } = useSavedLots();
  const upcomingCounts = useMemo(() => getUpcomingCounts(allLots), [allLots]);

  useEffect(() => { document.title = 'The record — lectr'; }, []);

  // ABSTENTION, measured live: of the lots on the block right now, how many
  // carry a call at all. Computed from the eager payload after mount — the
  // static sentence stands alone until the real ratio lands.
  const abstain = useMemo(() => {
    const today = localToday();
    let live = 0;
    let called = 0;
    for (const l of allLots) {
      if (!isLiveUpcoming(l, today)) continue;
      live++;
      const v = l.value;
      if (
        (l.signal && (l.signal.label === 'Below Market' || l.signal.label === 'Above Market')) ||
        (v && v.signal && !v.signal.label.startsWith('at'))
      ) called++;
    }
    return live > 0 ? { live, called, pct: Math.round((called / live) * 100) } : null;
  }, [allLots]);

  const f = backtest.flagged;
  const u = backtest.unflagged;
  const a = backtest.above;
  const tiers = backtest.flaggedTiers;
  const serial = (backtest as unknown as { generatedAt?: string }).generatedAt || undefined;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)', color: 'var(--color-fg)', fontFamily: 'var(--font-sans), sans-serif' }}>
      <ArtistNav activeSlug={null} savedCount={savedIds.length} upcomingCounts={upcomingCounts} lastCrawl={lastCrawl ? formatDate(lastCrawl) : undefined} />

      <section className="rail" style={{ paddingTop: 'var(--space-4, 24px)' }}>
        <Masthead
          kicker="The record · every call replayed against history"
          serial={serial}
          title={<>The <Accent>record</Accent>.</>}
          sub={
            <>
              Every call lectr has ever made is replayed point-in-time against what actually hammered —
              using only sales that had already happened when the call was made. Flagged lots hammered{' '}
              <b style={{ color: 'var(--color-up)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtSignedPct(f.hammerMedianPct ?? f.medianPerfPct)}</b>{' '}
              vs{' '}
              <b style={{ color: 'var(--color-down-text)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtSignedPct(u.hammerMedianPct ?? u.medianPerfPct)}</b>{' '}
              unflagged, across {f.n.toLocaleString()} replayed sales. Measured, not modeled.
            </>
          }
        />
      </section>

      {/* the certificate — the same RecordBand the live /value page prints */}
      <div className="ray-band" style={{ marginTop: 26, paddingBlock: '28px 34px' }}>
        <section className="rail">
          <RecordBand
            title="The record"
            context="every call replayed against history"
            serial={serial ? serial.replace(/-/g, '') : undefined}
            footer="hammer basis · refit nightly from the full replay"
            cells={[
              {
                k: 'Flagged lots hammered',
                v: fmtSignedPct(f.hammerMedianPct ?? f.medianPerfPct),
                signed: f.hammerMedianPct ?? f.medianPerfPct,
                sub: `median hammer vs estimate · ${f.n.toLocaleString()} calls${f.hammerMedianPct != null ? ` · +${f.medianPerfPct}% with premium` : ''}`,
              },
              {
                k: 'Unflagged hammered',
                v: fmtSignedPct(u.hammerMedianPct ?? u.medianPerfPct),
                signed: u.hammerMedianPct ?? u.medianPerfPct,
                sub: <>the signal&rsquo;s edge: {(f.hammerMedianPct ?? f.medianPerfPct) - (u.hammerMedianPct ?? u.medianPerfPct)} pts</>,
              },
              {
                k: 'Beat their high estimate',
                v: `${Math.round(f.hammerBeatPct ?? f.beatHighPct)}%`,
                sub: `at the hammer · vs ${u.hammerBeatPct ?? u.beatHighPct}% unflagged`,
              },
              f.failToSellPct != null && a.failToSellPct != null
                ? {
                    k: 'Failed to sell',
                    v: `${f.failToSellPct.toFixed(1)}%`,
                    sub: <>of flagged lots · vs {a.failToSellPct}% of &ldquo;above market&rdquo;</>,
                  }
                : {
                    k: '“Above market” calls',
                    v: fmtSignedPct(a.hammerMedianPct ?? a.medianPerfPct),
                    signed: a.hammerMedianPct ?? a.medianPerfPct,
                    sub: 'underperformed both — the ordering holds',
                  },
            ]}
          />
        </section>
      </div>

      {/* year by year — the skeptic's chart: green over gray, every year */}
      <RecordByYear backtest={backtest} />

      {/* what a flag is worth — the measured calibration, honesty included */}
      {backtest.calibration && <CalibrationCurve backtest={backtest} />}

      {/* the tier split — the strict gate vs its fallback, both on the record */}
      {tiers && (
        <section className="rail" style={{ paddingBlock: '10px 8px' }}>
          <h2 className="ray-h2" style={{ marginBottom: 6 }}>The gate, tier by tier</h2>
          <p style={{ fontSize: 13.5, color: 'var(--color-text-muted)', margin: '0 0 16px', maxWidth: 640, lineHeight: 1.55 }}>
            Most flags clear the strict comp gate; a smaller tier passes on a relaxed pool.
            Both are replayed separately — the fallback earns less, and says so.
          </p>
          <div className="glass glass-quiet" style={{ overflow: 'hidden' }}>
            {/* __html (RecordBand's pattern) — keeps the tier grid readable at
                390px, where the desktop column widths crush the labels */}
            <style dangerouslySetInnerHTML={{ __html: `
              .lectr-rec-tier { display: grid; grid-template-columns: minmax(0,1fr) 90px 110px 110px; gap: 14px; }
              @media (max-width: 640px) {
                .lectr-rec-tier { grid-template-columns: minmax(0,1fr) 58px 66px 60px; gap: 8px; }
                .lectr-rec-tier > span { font-size: 12px !important; }
              }
            ` }} />
            <div className="lectr-rec-tier" style={{ padding: '10px 16px 8px', borderBottom: '1px solid var(--color-border)' }} aria-hidden>
              <span className="kicker">Tier</span>
              <span className="kicker" style={{ textAlign: 'right' }}>Calls</span>
              <span className="kicker" style={{ textAlign: 'right' }}>Hammered</span>
              <span className="kicker" style={{ textAlign: 'right' }}>Beat high</span>
            </div>
            {([['Main — strict comp gate', tiers.main], ['Fallback — relaxed pool', tiers.fallback]] as const).map(([label, t]) => (
              <div key={label} className="lectr-rec-tier" style={{ padding: '11px 16px', borderBottom: '1px solid var(--color-border)', fontVariantNumeric: 'tabular-nums' }}>
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>{label}</span>
                <span style={{ fontSize: 13.5, textAlign: 'right', color: 'var(--color-text-muted)' }}>{t.n.toLocaleString()}</span>
                <span style={{ fontSize: 13.5, textAlign: 'right', color: 'var(--color-up)', fontWeight: 700 }}>{fmtSignedPct(t.hammerMedianPct ?? t.medianPerfPct)}</span>
                <span style={{ fontSize: 13.5, textAlign: 'right', color: 'var(--color-fg)' }}>{Math.round(t.hammerBeatPct ?? t.beatHighPct)}%</span>
              </div>
            ))}
            <p style={{ fontSize: 12, color: 'var(--color-text-faint)', margin: 0, padding: '10px 16px 12px', lineHeight: 1.5 }}>
              Hammer basis — estimates are hammer-basis, so the premium is divided out before comparing.
            </p>
          </div>
        </section>
      )}

      {/* THE ABSTENTION — the statement investors don't expect */}
      <section className="rail" style={{ paddingBlock: '34px 10px' }}>
        <h2 className="ray-h2" style={{ marginBottom: 6 }}>What lectr doesn&rsquo;t call</h2>
        <p style={{ fontSize: 15, color: 'var(--color-text-secondary)', maxWidth: 640, lineHeight: 1.6, margin: 0 }}>
          lectr makes no call on most lots — <b style={{ color: 'var(--color-fg)' }}>silence over noise</b>.
          Fewer than three true comparables, or a pool that disagrees with itself, and the engine says nothing at all.
          {abstain && (
            <>
              {' '}Right now that is a call on{' '}
              <b style={{ color: 'var(--color-fg)', fontVariantNumeric: 'tabular-nums' }}>{abstain.called.toLocaleString()}</b> of{' '}
              <b style={{ color: 'var(--color-fg)', fontVariantNumeric: 'tabular-nums' }}>{abstain.live.toLocaleString()}</b> live lots —
              silence on the other {100 - abstain.pct}%.
            </>
          )}
        </p>
      </section>

      {/* where to go next */}
      <section className="rail" style={{ paddingBlock: '26px 64px', display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <Link href="/value" className="ray-call-btn ray-call-btn-primary" style={{ textDecoration: 'none' }}>
          The live calls <Flick size={11} />
        </Link>
        <Link href="/method" className="ray-call-btn ray-call-btn-quiet" style={{ textDecoration: 'none', border: '1px solid var(--color-border)' }}>
          How the calls are made
        </Link>
        <Link href="/analytics" className="ray-call-btn ray-call-btn-quiet" style={{ textDecoration: 'none', border: '1px solid var(--color-border)' }}>
          Analytics
        </Link>
      </section>

      <Colophon lotCount={meta.totalLots} houseCount={meta.sources.length} record={null} />
    </div>
  );
}
