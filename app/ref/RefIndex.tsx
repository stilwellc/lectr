'use client';

/**
 * RefIndex — bare /ref: the whole reference book, every maker, filterable.
 * Reads the small reference list (search-meta.json, else page-stats
 * refIndex — app/lib/search-index.ts) rather than the 1.9MB refs.json.
 */
import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import ArtistNav from '../components/ArtistNav';
import { Colophon } from '../components/Terminal';
import { useRayData } from '../hooks/useRayData';
import { useSavedLots } from '../hooks/useSavedLots';
import { loadRefList, type RefRow } from '../lib/search-index';
import { ARTIST_LABEL } from '../constants';
import { formatDate, getUpcomingCounts } from '../utils';
import RefList from './RefList';
import { dedupeRefs } from './ref-book';
import '../northstar-pages.css';

const CSS = `
.ri-makers{display:flex;flex-wrap:wrap;gap:8px;margin:26px 0 4px}
.ri-makers button{display:inline-flex;align-items:center;gap:7px;min-height:34px;padding:0 14px;border-radius:999px;border:1px solid var(--color-border-mid);background:none;color:var(--color-text-secondary);font:inherit;font-size:13.5px;cursor:pointer}
.ri-makers button[aria-pressed=true]{background:var(--color-fg);border-color:var(--color-fg);color:var(--color-bg)}
.ri-makers button .n{font-variant-numeric:tabular-nums;opacity:.75;font-size:12.5px}
`;

export default function RefIndex() {
  const { allLots, lastCrawl } = useRayData();
  const { savedIds } = useSavedLots();
  const upcomingCounts = useMemo(() => getUpcomingCounts(allLots), [allLots]);
  const [refs, setRefs] = useState<RefRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [maker, setMaker] = useState<string>('all');

  useEffect(() => {
    let dead = false;
    loadRefList().then(r => { if (dead) return; if (r.length) setRefs(r); else setFailed(true); });
    return () => { dead = true; };
  }, []);

  const makers = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of refs || []) m.set(r.maker, (m.get(r.maker) || 0) + 1);
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [refs]);
  const rows = useMemo(() => (refs || []).filter(r => maker === 'all' || r.maker === maker), [refs, maker]);

  return (
    <div className="terminal-shell">
      <ArtistNav activeSlug="" savedCount={savedIds.length} upcomingCounts={upcomingCounts} lastCrawl={lastCrawl ? formatDate(lastCrawl) : undefined} />
      <div className="rail nsp-doss" style={{ minHeight: '100dvh' }}>
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
        <h1 className="nsp-h1">Watch references, read by the hammer</h1>
        <p className="nsp-dek">
          {refs ? `${dedupeRefs(refs).length.toLocaleString()} references` : 'Every reference'} with at least eight sales on the book. Each dossier
          plots every sale on a true time axis, with the medians and the hammers behind them.
        </p>
        {failed ? (
          <p className="nsp-note">The reference book didn&rsquo;t load — try again shortly.</p>
        ) : !refs ? (
          <div aria-busy="true" style={{ minHeight: 600 }} />
        ) : (
          <>
            <div className="ri-makers" role="group" aria-label="Maker">
              <button type="button" aria-pressed={maker === 'all'} onClick={() => setMaker('all')}>
                Every maker <span className="n">{refs.length}</span>
              </button>
              {makers.map(([m, n]) => (
                <button key={m} type="button" aria-pressed={maker === m} onClick={() => setMaker(m)}>
                  {ARTIST_LABEL[m] || m} <span className="n">{n}</span>
                </button>
              ))}
            </div>
            <RefList key={maker} rows={rows} showMaker={maker === 'all'} initial={40} />
          </>
        )}
        <div className="nsp-links">
          {maker !== 'all' && (
            <Link href={`/makers/${maker}`} className="ray-call-btn ray-call-btn-quiet" style={{ textDecoration: 'none' }}>
              {ARTIST_LABEL[maker] || maker}, the maker&rsquo;s book
            </Link>
          )}
          <Link href="/watches" className="ray-call-btn ray-call-btn-quiet" style={{ textDecoration: 'none' }}>The watch market</Link>
          <Link href="/glossary" className="ray-call-btn ray-call-btn-quiet" style={{ textDecoration: 'none' }}>Glossary</Link>
        </div>
      </div>
      <Colophon lastCrawl={lastCrawl || undefined} record={null} />
    </div>
  );
}
