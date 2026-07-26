'use client';

/**
 * RefPage — the reference dossier. /ref?id=<maker:refKey> renders one watch
 * reference/model line from refs.json (build-time aggregates over the sold
 * book): sample size, medians, the yearly monoline, and the recent sales as
 * ledger rows. The page a bidder reads before trusting an estimate.
 */
import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import ArtistNav from './ArtistNav';
import { LOTPAGE_CSS } from './LotPage';
import { Colophon } from './Terminal';
import Flick from './Flick';
import { useRayData } from '../hooks/useRayData';
import { useSavedLots } from '../hooks/useSavedLots';
import { ARTIST_LABEL } from '../constants';
import { formatPrice, formatDate, getUpcomingCounts, houseColors, craftTitle, refLabel } from '../utils';

export interface RefEntry {
  key: string; maker: string; ref: string; n: number;
  medianUsd: number; ttmMedianUsd: number | null; beatHighPct: number | null;
  houses: string[];
  yearly: { y: number; med: number; n: number }[];
  recent: { id: string; d: string; h: string; p: number; t: string; img: string | null }[];
}

// module cache — one fetch per session, shared across ref pages
let refsCache: RefEntry[] | null = null;
let refsFailed = false;
function useRefs(): { refs: RefEntry[] | null; failed: boolean } {
  const [state, setState] = useState<{ refs: RefEntry[] | null; failed: boolean }>({ refs: refsCache, failed: refsFailed });
  useEffect(() => {
    if (refsCache || refsFailed) return;
    let dead = false;
    fetch('/data/ray/refs.json')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(j => { refsCache = j.refs || []; if (!dead) setState({ refs: refsCache, failed: false }); })
      .catch(() => { refsFailed = true; if (!dead) setState({ refs: null, failed: true }); });
    return () => { dead = true; };
  }, []);
  return state;
}

/** The yearly median as a plain monoline — the numeral IS the line. */
function RefLine({ yearly }: { yearly: RefEntry['yearly'] }) {
  if (yearly.length < 3) return null;
  const W = 640, H = 150, PAD = 6;
  const vals = yearly.map(p => p.med);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const pts = yearly.map((p, i) => {
    const x = PAD + (i / (yearly.length - 1)) * (W - PAD * 2);
    const y = H - PAD - ((p.med - min) / span) * (H - PAD * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <div style={{ marginTop: 18 }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} aria-label="Yearly median sale price">
        <polyline points={pts} fill="none" stroke="var(--color-fg)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--color-text-faint)', marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>
        <span>{yearly[0].y} · {formatPrice(yearly[0].med)}</span>
        <span>{yearly[yearly.length - 1].y} · {formatPrice(yearly[yearly.length - 1].med)}</span>
      </div>
    </div>
  );
}

export default function RefPage({ refKey }: { refKey: string }) {
  const { allLots, lastCrawl, totalLots } = useRayData();
  const { savedIds } = useSavedLots();
  const { refs, failed } = useRefs();
  const upcomingCounts = useMemo(() => getUpcomingCounts(allLots), [allLots]);
  const entry = useMemo(() => refs?.find(r => r.key === refKey) || null, [refs, refKey]);

  // live lots of this reference currently on the block (client-derived — the
  // slim payload carries `reference` on watch lots)
  const onBlock = useMemo(() => {
    if (!entry) return [];
    return allLots.filter(l => l.status === 'upcoming' && l.artist === entry.maker && l.reference === entry.ref);
  }, [allLots, entry]);

  const nav = <ArtistNav activeSlug={entry ? entry.maker : null} savedCount={savedIds.length} upcomingCounts={upcomingCounts} lastCrawl={lastCrawl ? formatDate(lastCrawl) : undefined} />;

  if (!entry) {
    return (
      <>
        {nav}
        <div className="rail" style={{ paddingBlock: 80, textAlign: 'center' }}>
          {refs === null && !failed ? (
            <p style={{ color: 'var(--color-text-faint)', fontSize: 14 }}>Loading the reference book&hellip;</p>
          ) : (
            <>
              <p style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>Not in the reference book</p>
              <p style={{ color: 'var(--color-text-faint)', fontSize: 13.5, marginTop: 8 }}>
                {failed ? 'The reference data didn’t load — try again shortly.' : 'lectr keeps a dossier only where at least eight sales back it.'}
              </p>
            </>
          )}
        </div>
        <Colophon lotCount={totalLots || allLots.length} houseCount={7} record={null} />
      </>
    );
  }

  const makerName = ARTIST_LABEL[entry.maker] || entry.maker;
  const delta = entry.ttmMedianUsd != null && entry.medianUsd > 0
    ? Math.round(100 * (entry.ttmMedianUsd / entry.medianUsd - 1)) : null;

  return (
    <>
      {nav}
      <div className="rail" style={{ paddingTop: 'var(--space-4)', paddingBottom: 40 }}>
        <style dangerouslySetInnerHTML={{ __html: LOTPAGE_CSS }} />
        <p className="ray-hero2-label" style={{ marginBottom: 6 }}>
          <Link href={`/${entry.maker}`} style={{ color: 'inherit', textDecoration: 'none' }}>{makerName}</Link>
          {' · reference dossier'}
        </p>
        <h1 style={{ fontSize: 'clamp(28px, 5vw, 44px)', fontWeight: 750, letterSpacing: '-0.02em', margin: 0 }}>
          {refLabel(entry.ref)}
        </h1>
        <p style={{ color: 'var(--color-text-muted)', fontSize: 13.5, margin: '10px 0 0', lineHeight: 1.55 }}>
          {entry.n.toLocaleString()} sales on the book · median {formatPrice(entry.medianUsd)}
          {entry.ttmMedianUsd != null && (
            <>
              {' '}· past year {formatPrice(entry.ttmMedianUsd)}
              {delta != null && delta !== 0 && (
                <b style={{ color: delta > 0 ? 'var(--color-up)' : 'var(--color-down-text)', fontWeight: 650 }}>
                  {' '}{delta > 0 ? '+' : ''}{delta}%
                </b>
              )}
            </>
          )}
          {entry.beatHighPct != null && <> · {entry.beatHighPct}% beat the high estimate</>}
          {' '}· {entry.houses.join(', ')}
        </p>

        <RefLine yearly={entry.yearly} />

        {onBlock.length > 0 && (
          <section style={{ marginTop: 34 }} aria-label="On the block now">
            <div className="lectr-lot-comps-head"><span>On the block now · {onBlock.length}</span></div>
            <div style={{ marginTop: 6 }}>
              {onBlock.slice(0, 6).map(l => (
                <Link key={l.id} href={`/lot?id=${encodeURIComponent(l.id)}`} className="lectr-lot-comp">
                  <span className="lectr-lot-comp-t">
                    <span className="lectr-lot-comp-title" style={{ display: 'block' }}>{craftTitle(l.title)}</span>
                    <span className="lectr-lot-comp-meta" style={{ display: 'block' }}>
                      <span style={{ color: houseColors[l.auctionHouse] || 'var(--color-text-faint)', fontWeight: 600 }}>{l.auctionHouse}</span>
                      {' · hammers '}{formatDate(l.saleDate)}
                    </span>
                  </span>
                  <span className="lectr-lot-comp-p">
                    {l.estimateLow ? `${formatPrice(l.estimateLow)} est.` : '—'}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}

        <section style={{ marginTop: 34 }} aria-label="Recent sales">
          <div className="lectr-lot-comps-head">
            <span>Recent sales</span>
            <span className="ctx">realized, buyer&rsquo;s premium included</span>
          </div>
          <div style={{ marginTop: 6 }}>
            {entry.recent.map(s => (
              <Link key={s.id} href={`/lot?id=${encodeURIComponent(s.id)}`} className="lectr-lot-comp">
                <span className="lectr-lot-comp-thumb" aria-hidden>
                  <span>{(s.t || '?').charAt(0)}</span>
                  {s.img && <img src={s.img.replace(/^http:/, 'https:')} alt="" loading="lazy" referrerPolicy="no-referrer" onError={e => e.currentTarget.remove()} />}
                </span>
                <span className="lectr-lot-comp-t">
                  <span className="lectr-lot-comp-title" style={{ display: 'block' }}>{craftTitle(s.t)}</span>
                  <span className="lectr-lot-comp-meta" style={{ display: 'block' }}>
                    <span style={{ color: houseColors[s.h] || 'var(--color-text-faint)', fontWeight: 600 }}>{s.h}</span>
                    {' · '}{formatDate(s.d, { month: 'short', year: 'numeric' })}
                  </span>
                </span>
                <span className="lectr-lot-comp-p">{formatPrice(s.p)}</span>
              </Link>
            ))}
          </div>
          <p style={{ fontSize: 11.5, color: 'var(--color-text-faint)', margin: '14px 0 0', lineHeight: 1.5 }}>
            Medians over every {makerName} sale lectr has catalogued for this reference
            <Flick size={10} style={{ marginLeft: 5 }} />
          </p>
        </section>
      </div>
      <Colophon lotCount={totalLots || allLots.length} houseCount={7} record={null} />
    </>
  );
}
