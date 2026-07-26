'use client';

/**
 * PlayerPage — the athlete dossier. /player?id=<slug> renders one player's
 * WHOLE market from players.json (build-time aggregates over every sold
 * sports lot): cards vs game-used vs tickets/trophies medians side by side —
 * "how is this athlete doing in the wider market" — plus the yearly card
 * trend, marquee object results, live lots, and recent sales.
 */
import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import ArtistNav from './ArtistNav';
import { LOTPAGE_CSS } from './LotPage';
import { Colophon } from './Terminal';
import { useRayData } from '../hooks/useRayData';
import { useSavedLots } from '../hooks/useSavedLots';
import { formatPrice, formatDate, getUpcomingCounts } from '../utils';
import FollowButton from './FollowButton';
import type { AuctionLot } from '../types';

interface CatCell { n: number; medUsd: number; ttmMedUsd: number | null }
export interface PlayerEntry {
  slug: string; name: string; sport: string | null; n: number;
  cats: Record<string, CatCell>;
  yearly: { y: number; med: number; n: number }[];
  objects: { id: string; d: string; p: number; t: string; cat: string }[];
  recent: { d: string; p: number; t: string; cat: string }[];
}

const CAT_LABEL: Record<string, string> = {
  'sports-cards': 'Cards', 'game-used': 'Game worn & used',
  'trophies-awards': 'Trophies & awards', 'tickets-passes': 'Tickets & passes',
  'sports-memorabilia': 'Memorabilia',
};

let cache: PlayerEntry[] | null = null;
let failed = false;
function usePlayers(): { players: PlayerEntry[] | null; failed: boolean } {
  const [state, setState] = useState({ players: cache, failed });
  useEffect(() => {
    if (cache || failed) return;
    let dead = false;
    fetch('/data/ray/players.json')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(j => { cache = j.players || []; if (!dead) setState({ players: cache, failed: false }); })
      .catch(() => { failed = true; if (!dead) setState({ players: null, failed: true }); });
    return () => { dead = true; };
  }, []);
  return state;
}

function TrendLine({ yearly }: { yearly: PlayerEntry['yearly'] }) {
  if (yearly.length < 3) return null;
  const W = 640, H = 130, PAD = 6;
  const vals = yearly.map(p => p.med);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const pts = yearly.map((p, i) => {
    const x = PAD + (i / (yearly.length - 1)) * (W - PAD * 2);
    const y = H - PAD - ((p.med - min) / span) * (H - PAD * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <div style={{ marginTop: 16 }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} aria-label="Yearly median card sale">
        <polyline points={pts} fill="none" stroke="var(--color-fg)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--color-text-faint)', marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>
        <span>{yearly[0].y} · {formatPrice(yearly[0].med)} card median</span>
        <span>{yearly[yearly.length - 1].y} · {formatPrice(yearly[yearly.length - 1].med)}</span>
      </div>
    </div>
  );
}

export default function PlayerPage({ playerSlug }: { playerSlug: string }) {
  const { allLots, lastCrawl, totalLots, sources } = useRayData();
  // house count is the meta.json source list — not a hardcoded 7 that silently
  // rots when a house is added. Fall back to the lots' own houses if meta is
  // still landing.
  const houseCount = sources.length || new Set(allLots.map(l => l.auctionHouse)).size;
  const { savedIds } = useSavedLots();
  const { players, failed: loadFailed } = usePlayers();
  const upcomingCounts = useMemo(() => getUpcomingCounts(allLots), [allLots]);
  const entry = useMemo(() => players?.find(p => p.slug === playerSlug) || null, [players, playerSlug]);

  // live lots for this player — the build stamps playerSlug on upcoming sports lots
  const live = useMemo(
    () => allLots.filter(l => l.status === 'upcoming' && (l as AuctionLot & { playerSlug?: string | null }).playerSlug === playerSlug),
    [allLots, playerSlug],
  );

  const nav = <ArtistNav activeSlug={null} savedCount={savedIds.length} upcomingCounts={upcomingCounts} lastCrawl={lastCrawl ? formatDate(lastCrawl) : undefined} />;

  if (!entry) {
    return (
      <>
        {nav}
        <div className="rail" style={{ paddingBlock: 80, textAlign: 'center' }}>
          {players === null && !loadFailed ? (
            <p style={{ color: 'var(--color-text-faint)', fontSize: 14 }}>Loading the player book&hellip;</p>
          ) : (
            <>
              <p style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>Not in the player book</p>
              <p style={{ color: 'var(--color-text-faint)', fontSize: 13.5, marginTop: 8 }}>
                {loadFailed ? 'The player data didn’t load — try again shortly.' : 'lectr keeps a dossier only where at least 25 sales back it.'}
              </p>
            </>
          )}
        </div>
        <Colophon lotCount={totalLots || allLots.length} houseCount={houseCount} record={null} />
      </>
    );
  }

  const cardMed = entry.cats['sports-cards']?.medUsd ?? null;
  const gearMed = entry.cats['game-used']?.medUsd ?? null;

  return (
    <>
      {nav}
      <div className="rail" style={{ paddingTop: 'var(--space-4)', paddingBottom: 40 }}>
        <style dangerouslySetInnerHTML={{ __html: LOTPAGE_CSS }} />
        <p className="ray-hero2-label" style={{ marginBottom: 6 }}>
          {entry.sport ? `${entry.sport} · ` : ''}player dossier
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <h1 style={{ fontSize: 'clamp(28px, 5vw, 44px)', fontWeight: 750, letterSpacing: '-0.02em', margin: 0 }}>
            {entry.name}
          </h1>
          <FollowButton slug={entry.slug} name={entry.name} />
        </div>
        {/* medians of WHAT SOLD, deliberately uncolored — a shift in the mix
            (premium cards trading more lately) is not appreciation, and green
            here would claim it is. The yearly line below is the honest trend. */}
        <p style={{ color: 'var(--color-text-muted)', fontSize: 13.5, margin: '10px 0 0', lineHeight: 1.55 }}>
          {entry.n.toLocaleString()} sales across the book
          {cardMed != null && <> · cards median {formatPrice(cardMed)}</>}
          {gearMed != null && <> · game-worn median {formatPrice(gearMed)}</>}
        </p>

        {/* the wider market, one row per category */}
        <div className="lectr-lot-leaders" style={{ marginTop: 20, maxWidth: 560 }}>
          {(['sports-cards', 'game-used', 'trophies-awards', 'tickets-passes', 'sports-memorabilia'] as const).map(cat => {
            const c = entry.cats[cat];
            if (!c) return null;
            return (
              <div key={cat} className="lectr-lot-row">
                <span className="lectr-lot-k">{CAT_LABEL[cat]}</span>
                <span className="lectr-lot-fill" aria-hidden />
                <span className="lectr-lot-sub">{c.n.toLocaleString()} sales</span>
                <span className="lectr-lot-v">
                  {formatPrice(c.medUsd)}
                  {c.ttmMedUsd != null && c.ttmMedUsd !== c.medUsd && (
                    <span style={{ marginLeft: 6, fontSize: 11.5, fontWeight: 600, color: 'var(--color-text-muted)' }}>
                      {formatPrice(c.ttmMedUsd)} past yr
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>

        <TrendLine yearly={entry.yearly} />

        {live.length > 0 && (
          <section style={{ marginTop: 34 }} aria-label="On the block now">
            <div className="lectr-lot-comps-head"><span>On the block now · {live.length}</span></div>
            <div style={{ marginTop: 6 }}>
              {live.slice(0, 8).map(l => (
                <Link key={l.id} href={`/lot?id=${encodeURIComponent(l.id)}`} className="lectr-lot-comp">
                  <span className="lectr-lot-comp-t">
                    <span className="lectr-lot-comp-title" style={{ display: 'block' }}>{l.title}</span>
                    <span className="lectr-lot-comp-meta" style={{ display: 'block' }}>
                      {CAT_LABEL[l.artist] || l.artist} · hammers {formatDate(l.saleDate)}
                    </span>
                  </span>
                  <span className="lectr-lot-comp-p">
                    {(l as AuctionLot & { currentBid?: number }).currentBid
                      ? `${formatPrice((l as AuctionLot & { currentBid?: number }).currentBid!)} bid`
                      : 'on the block'}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {entry.objects.length > 0 && (
          <section style={{ marginTop: 34 }} aria-label="The wider market">
            <div className="lectr-lot-comps-head">
              <span>The wider market · top object results</span>
              <span className="ctx">game-worn, trophies &amp; tickets</span>
            </div>
            <div style={{ marginTop: 6 }}>
              {entry.objects.map((o, i) => (
                <span key={i} className="lectr-lot-comp" style={{ cursor: 'default' }}>
                  <span className="lectr-lot-comp-t">
                    <span className="lectr-lot-comp-title" style={{ display: 'block' }}>{o.t}</span>
                    <span className="lectr-lot-comp-meta" style={{ display: 'block' }}>
                      {CAT_LABEL[o.cat] || o.cat} · {formatDate(o.d, { month: 'short', year: 'numeric' })}
                    </span>
                  </span>
                  <span className="lectr-lot-comp-p">{formatPrice(o.p)}</span>
                </span>
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
            {entry.recent.map((s, i) => (
              <span key={i} className="lectr-lot-comp" style={{ cursor: 'default' }}>
                <span className="lectr-lot-comp-t">
                  <span className="lectr-lot-comp-title" style={{ display: 'block' }}>{s.t}</span>
                  <span className="lectr-lot-comp-meta" style={{ display: 'block' }}>
                    {CAT_LABEL[s.cat] || s.cat} · {formatDate(s.d, { month: 'short', year: 'numeric' })}
                  </span>
                </span>
                <span className="lectr-lot-comp-p">{formatPrice(s.p)}</span>
              </span>
            ))}
          </div>
          <p style={{ fontSize: 11.5, color: 'var(--color-text-faint)', margin: '14px 0 0', lineHeight: 1.5 }}>
            Medians over every {entry.name} sale lectr has catalogued — cards and the physical market read together.
          </p>
        </section>
      </div>
      <Colophon lotCount={totalLots || allLots.length} houseCount={houseCount} record={null} />
    </>
  );
}
