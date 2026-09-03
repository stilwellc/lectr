'use client';

/**
 * SubIndex — /sub with no dossier named: the index of every tracked
 * sub-market, grouped by top-level category (the vertical) and then by the
 * taxonomy parent (a watch maker's model families, a sport's kinds, art by
 * kind…). Rows are market.json's drills — the same honesty ladder as every
 * sub-market surface: CI'd index / measured demand / plain descriptive facts;
 * green-red ONLY on real deltas, mono ONLY on % figures.
 */
import React, { useEffect, useMemo } from 'react';
import Link from 'next/link';
import ArtistNav from '../components/ArtistNav';
import { Colophon } from '../components/Terminal';
import { SubMarketWell, groupDrillsByParent } from '../components/SubMarketDirectory';
import { useRayData } from '../hooks/useRayData';
import { useSavedLots } from '../hooks/useSavedLots';
import { MARKETS } from '../constants';
import type { DrillRow } from '../lib/submarkets';
import { formatDate, getUpcomingCounts } from '../utils';
import '../northstar-pages.css';

export default function SubIndex() {
  const { market, allLots, lastCrawl, totalLots } = useRayData();
  const { savedIds } = useSavedLots();
  const upcomingCounts = useMemo(() => getUpcomingCounts(allLots), [allLots]);

  useEffect(() => {
    const prev = document.title;
    document.title = 'Sub-markets — lectr';
    return () => { document.title = prev; };
  }, []);

  // one section per live vertical, in MARKETS order; inside, wells by parent
  const sections = useMemo(() => {
    const drills = market?.drills as Record<string, DrillRow[]> | undefined;
    if (!drills) return [];
    return MARKETS
      .filter(m => m.key !== 'all' && drills[m.key]?.length)
      .map(m => {
        const rows = drills[m.key];
        return {
          key: m.key,
          label: m.label,
          tagline: m.tagline,
          lots: rows.reduce((s, r) => s + r.lots, 0),
          wells: groupDrillsByParent(rows),
        };
      });
  }, [market]);
  const total = sections.reduce((s, v) => s + v.wells.reduce((t, w) => t + w.rows.length, 0), 0);

  const nav = <ArtistNav activeSlug="analytics" savedCount={savedIds.length} upcomingCounts={upcomingCounts} lastCrawl={lastCrawl ? formatDate(lastCrawl) : undefined} />;

  return (
    <div className="terminal-shell">
      {nav}
      <div className="rail nsp-doss" style={{ minHeight: market === null ? '100dvh' : undefined }}>
        <div className="nsp-kicker-row">
          <span className="ns-kicker">The taxonomy · every tracked split</span>
          {total > 0 && <span className="no">{total} sub-markets</span>}
        </div>
        <h1 className="nsp-h1">Sub-markets</h1>
        <p className="nsp-dek">
          Cards by era and sport, watch model families, art and design kinds, the culture and science collections —
          each read at the strength its data supports: a verified index move, measured demand against the estimate,
          or the plain typical price. Where a split can&rsquo;t clear its evidence gate, it isn&rsquo;t here.
        </p>

        {market === null ? (
          <p className="nsp-note" style={{ marginTop: 28 }}>Loading the sub-market book&hellip;</p>
        ) : sections.length === 0 ? (
          <p className="nsp-note" style={{ marginTop: 28 }}>No tracked sub-markets in this book yet.</p>
        ) : sections.map(sec => (
          <section key={sec.key} className="nsp-section ns-plate" aria-label={`${sec.label} sub-markets`}>
            <div className="nsp-shead">
              <div>
                <span className="ns-kicker">{sec.tagline}</span>
                <h2 className="nsp-h2">
                  <Link href={`/analytics/${sec.key}`} style={{ color: 'inherit', textDecoration: 'none' }}>{sec.label}</Link>
                </h2>
              </div>
              <span className="nsp-shctx">
                {sec.wells.reduce((t, w) => t + w.rows.length, 0)} tracked · {sec.lots.toLocaleString()} lots
              </span>
            </div>
            <div className="nsp-wells">
              {sec.wells.map(w => <SubMarketWell key={w.title} title={w.title} rows={w.rows} />)}
            </div>
          </section>
        ))}

        <div className="nsp-links">
          <Link href="/analytics" className="ray-call-btn ray-call-btn-quiet" style={{ textDecoration: 'none' }}>The research desk</Link>
          <Link href="/makers" className="ray-call-btn ray-call-btn-quiet" style={{ textDecoration: 'none' }}>The taxonomy on Makers</Link>
        </div>
      </div>
      <Colophon lotCount={totalLots || allLots.length} record={null} />
    </div>
  );
}
