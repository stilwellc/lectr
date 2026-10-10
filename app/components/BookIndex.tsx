'use client';

/**
 * BookIndex — what a bare /lot, /ref or /player prints. Those addresses used
 * to dead-end at "Not in the book" (and /lot streamed the whole corpus to
 * decide it). Each is now the directory for its dossier kind, built from data
 * the page already has or from the build's small page-stats.json:
 *
 *   /lot     the engine's flagged lots closing soonest (eager tape, 0 extra bytes)
 *   /ref     every watch reference with a dossier, by maker (page-stats refIndex)
 *   /player  the deepest player dossiers (page-stats playerIndex)
 *
 * Nav lights nothing (activeSlug '') — these are not the Overview.
 */
import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import ArtistNav from './ArtistNav';
import { LOTPAGE_CSS } from './LotPage';
import { Colophon } from './Terminal';
import { useRayData } from '../hooks/useRayData';
import { useSavedLots } from '../hooks/useSavedLots';
import { loadPageStats, type PageStats } from '../lib/page-data';
import { ARTIST_LABEL } from '../constants';
import { makerLineOf } from '../lib/lot-labels';
import { encodeRefPath } from '../ref/ref-path';
import { craftTitle, formatDate, formatPrice, getUpcomingCounts, isLiveUpcoming, localToday, refLabel, trueSaleDay, houseColors } from '../utils';
import { signalMagnitude, dealScore } from '../lib/comps';
import { OPEN_CK_EVENT } from './CommandK';
import '../northstar-pages.css';
import { makerHref } from '../lib/entity/retired';

type Kind = 'lot' | 'ref' | 'player';

function usePageStats(on: boolean): { stats: PageStats | null; failed: boolean } {
  const [s, setS] = useState<{ stats: PageStats | null; failed: boolean }>({ stats: null, failed: false });
  useEffect(() => {
    if (!on) return;
    let dead = false;
    loadPageStats().then(st => { if (!dead) setS({ stats: st, failed: !st }); });
    return () => { dead = true; };
  }, [on]);
  return s;
}

export default function BookIndex({ kind }: { kind: Kind }) {
  const { allLots, lastCrawl, loading } = useRayData();
  const { savedIds } = useSavedLots();
  const upcomingCounts = useMemo(() => getUpcomingCounts(allLots), [allLots]);
  const { stats, failed } = usePageStats(kind !== 'lot');

  const flagged = useMemo(() => {
    if (kind !== 'lot') return [];
    const today = localToday();
    return allLots
      .filter(l => isLiveUpcoming(l, today) && l.signal?.label === 'Below Market')
      .sort((a, b) => trueSaleDay(a).localeCompare(trueSaleDay(b)) || dealScore(b, b.signal!.pct) - dealScore(a, a.signal!.pct))
      .slice(0, 12);
  }, [allLots, kind]);

  const refsByMaker = useMemo(() => {
    const m = new Map<string, NonNullable<PageStats['refIndex']>>();
    for (const r of stats?.refIndex || []) (m.get(r.maker) || m.set(r.maker, []).get(r.maker)!).push(r);
    return Array.from(m.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [stats]);
  const players = useMemo(() => (stats?.playerIndex || []).slice(0, 40), [stats]);

  const pending = kind === 'lot' ? loading : !stats && !failed;
  const head = {
    lot: { k: 'Lot certificates', h: 'Every lot on the book has a certificate', d: 'Open one from the tape, a maker, or search. These are the lots the engine flagged below their comps, closing soonest.' },
    ref: { k: 'Reference dossiers', h: 'Watch references, read by the hammer', d: `${stats ? stats.refIndex.length.toLocaleString() + ' references' : 'References'} with at least eight sales on the book — each with its yearly median and the recent hammers behind it.` },
    player: { k: 'Player dossiers', h: 'Athletes across the whole market', d: `${stats ? stats.playerIndex.length.toLocaleString() + ' players' : 'Players'} with at least 25 sales — cards, game-worn, trophies and tickets in one read. The deepest books first.` },
  }[kind];

  return (
    <div className="terminal-shell">
      <ArtistNav activeSlug="" savedCount={savedIds.length} upcomingCounts={upcomingCounts} lastCrawl={lastCrawl ? formatDate(lastCrawl) : undefined} />
      <div className="rail nsp-doss lectr-lot" style={{ minHeight: '100dvh' }}>
        <style dangerouslySetInnerHTML={{ __html: LOTPAGE_CSS }} />
        <span className="ns-kicker">{head.k}</span>
        <h1 className="nsp-h1">{head.h}</h1>
        <p className="nsp-dek">{head.d}</p>

        <section className="nsp-section ns-plate" aria-busy={pending || undefined}>
          {pending ? (
            <div aria-hidden>{Array.from({ length: 6 }, (_, i) => <div key={i} className="lectr-lot-comp" style={{ height: 58 }} />)}</div>
          ) : kind === 'lot' ? (
            flagged.length ? flagged.map(l => (
              <Link key={l.id} href={`/lot/${encodeURIComponent(l.id)}`} className="lectr-lot-comp">
                <span className="lectr-lot-comp-t">
                  <span className="lectr-lot-comp-title" style={{ display: 'block' }}>{craftTitle(l.title, l.auctionHouse)}</span>
                  <span className="lectr-lot-comp-meta" style={{ display: 'block' }}>
                    {makerLineOf(l).name} · <span style={{ color: houseColors[l.auctionHouse] || 'inherit', fontWeight: 600 }}>{l.auctionHouse}</span> · hammers {formatDate(trueSaleDay(l))}
                  </span>
                </span>
                <span className="lectr-lot-comp-p" style={{ color: 'var(--color-up)' }}>{signalMagnitude('Below Market', l.signal!.pct)}</span>
              </Link>
            )) : <p className="nsp-note">No flagged lots are on the block right now — the board refreshes nightly.</p>
          ) : kind === 'ref' ? (
            refsByMaker.map(([maker, rows]) => (
              <div key={maker} style={{ marginBottom: 26 }}>
                <div className="lectr-lot-shead" style={{ paddingTop: 6 }}>
                  <h2 className="lectr-lot-h2"><Link href={makerHref(maker)} style={{ color: 'inherit', textDecoration: 'none' }}>{ARTIST_LABEL[maker] || maker}</Link></h2>
                  <span className="nsp-note" style={{ margin: 0 }}>{rows.length} {rows.length === 1 ? 'reference' : 'references'}</span>
                </div>
                {rows.slice(0, 8).map(r => (
                  <Link key={r.ref} href={`/ref/${r.maker}/${encodeRefPath(r.ref)}`} className="lectr-lot-comp">
                    <span className="lectr-lot-comp-t"><span className="lectr-lot-comp-title" style={{ display: 'block' }}>{refLabel(r.ref)}</span>
                      <span className="lectr-lot-comp-meta" style={{ display: 'block' }}>{r.n.toLocaleString()} sales · median</span></span>
                    <span className="lectr-lot-comp-p">{formatPrice(r.med)}</span>
                  </Link>
                ))}
              </div>
            ))
          ) : (
            players.map(p => (
              <Link key={p.slug} href={`/player?id=${encodeURIComponent(p.slug)}`} className="lectr-lot-comp">
                <span className="lectr-lot-comp-t"><span className="lectr-lot-comp-title" style={{ display: 'block' }}>{p.name === p.name.toUpperCase() ? p.name.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase()) : p.name}</span>
                  <span className="lectr-lot-comp-meta" style={{ display: 'block' }}>{p.sport ? `${p.sport} · ` : ''}{p.n.toLocaleString()} sales on the book</span></span>
              </Link>
            ))
          )}
          {!pending && kind !== 'lot' && failed && <p className="nsp-note">The directory didn&rsquo;t load — try again shortly.</p>}
        </section>

        {/* the links land with the list, never above an empty frame that the
            list then shoves them out of (CLS) */}
        {!pending && <div className="nsp-links">
          <Link href="/value" className="ray-call-btn ray-call-btn-quiet" style={{ textDecoration: 'none' }}>Open the value desk</Link>
          <button type="button" className="ray-call-btn ray-call-btn-quiet" onClick={() => window.dispatchEvent(new Event(OPEN_CK_EVENT))}>Search the book</button>
          {kind !== 'lot' && <Link href={kind === 'ref' ? '/watches' : '/sports'} className="ray-call-btn ray-call-btn-quiet" style={{ textDecoration: 'none' }}>{kind === 'ref' ? 'The watch market' : 'The sports market'}</Link>}
        </div>}
      </div>
      <Colophon lastCrawl={lastCrawl || undefined} record={null} />
    </div>
  );
}
