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
import RecordPlate from './RecordPlate';
import { useRayData } from '../hooks/useRayData';
import { useSavedLots } from '../hooks/useSavedLots';
import { useChartDraw } from '../hooks/useChartDraw';
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

/** M8 — some player-book names arrive as catalogue shout ("MICHAEL JORDAN");
    the Fraunces display face wants a proper name. Title-case ONLY fully
    uppercase strings — mixed-case names (LeBron James) pass through. */
function displayName(name: string): string {
  if (name !== name.toUpperCase()) return name;
  return name
    .toLowerCase()
    .replace(/(^|[\s\-'.])([a-z])/g, (_, sep: string, c: string) => sep + c.toUpperCase());
}

// module cache — one fetch per session. The failure flag is NOT part of the
// cache contract: it clears on the next mount so one flaky fetch never bricks
// every /player page for the whole session (RefPage's exact pattern).
let cache: PlayerEntry[] | null = null;
let failed = false;
function usePlayers(): { players: PlayerEntry[] | null; failed: boolean } {
  // fresh mounts start un-failed — the effect below retries the fetch
  const [state, setState] = useState({ players: cache, failed: false });
  useEffect(() => {
    if (cache) return;
    failed = false; // retry on every fresh mount — never a permanent latch
    let dead = false;
    fetch('/data/ray/players.json')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(j => { cache = j.players || []; if (!dead) setState({ players: cache, failed: false }); })
      .catch(() => { failed = true; if (!dead) setState({ players: null, failed: true }); });
    return () => { dead = true; };
  }, []);
  return state;
}

/* M23 — the raw yearly points stay exactly as computed (no smoothing); the
   line gains the hero chart's grammar: soft area fill, last-point glow dot,
   and an IO-armed 900ms draw-in on first view. */
function TrendLine({ yearly }: { yearly: PlayerEntry['yearly'] }) {
  const drawRef = useChartDraw();
  if (yearly.length < 3) return null;
  const W = 640, H = 130, PAD = 6;
  const vals = yearly.map(p => p.med);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const xy = yearly.map((p, i) => [
    PAD + (i / (yearly.length - 1)) * (W - PAD * 2),
    H - PAD - ((p.med - min) / span) * (H - PAD * 2),
  ] as const);
  const pts = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const last = xy[xy.length - 1];
  return (
    <div className="lectr-lineplot" data-arm="true" ref={drawRef} style={{ marginTop: 16 }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible' }} aria-label="Yearly median card sale">
        <defs>
          <linearGradient id="playerLineFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-fg)" stopOpacity="0.09" />
            <stop offset="100%" stopColor="var(--color-fg)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon
          points={`${PAD.toFixed(1)},${(H - PAD).toFixed(1)} ${pts} ${(W - PAD).toFixed(1)},${(H - PAD).toFixed(1)}`}
          fill="url(#playerLineFill)"
        />
        <polyline points={pts} fill="none" stroke="var(--color-fg)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={last[0]} cy={last[1]} r="7" fill="rgba(232, 218, 182, 0.18)" />
        <circle cx={last[0]} cy={last[1]} r="3" fill="var(--color-fg)" stroke="var(--color-bg)" strokeWidth="1.5" />
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
  // M8 — the hero's right quadrant: the strongest result on the book (marquee
  // objects + recent sales). The player book carries no images, so the plate
  // stands as the engraved mini-certificate — figure, date, category.
  const topResult = (() => {
    let best: { p: number; d: string; t: string; cat: string; id?: string } | null = null;
    for (const o of entry.objects) if (!best || o.p > best.p) best = o;
    for (const s of entry.recent) if (!best || s.p > best.p) best = s;
    return best;
  })();

  return (
    <>
      {nav}
      <div className="rail" style={{ paddingTop: 'var(--space-4)', paddingBottom: 40 }}>
        <style dangerouslySetInnerHTML={{ __html: LOTPAGE_CSS }} />
        <div className="lectr-dossier-hero">
          <div style={{ minWidth: 0 }}>
            <p className="ray-hero2-label" style={{ marginBottom: 6 }}>
              {entry.sport ? `${entry.sport} · ` : ''}player dossier
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              {/* M8 — the dossier name speaks Fraunces display */}
              <h1 className="lectr-dossier-name">
                {displayName(entry.name)}
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
          </div>
          {topResult && (
            <RecordPlate
              label="Top result on the book"
              figure={topResult.p}
              date={topResult.d}
              house={CAT_LABEL[topResult.cat] || topResult.cat}
              title={topResult.t}
              href={topResult.id ? `/lot?id=${encodeURIComponent(topResult.id)}` : null}
            />
          )}
        </div>

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
