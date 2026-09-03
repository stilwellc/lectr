'use client';

/**
 * PlayerPage — the athlete dossier. /player?id=<slug> renders one player's
 * WHOLE market from players.json (build-time aggregates over every sold
 * sports lot): cards vs game-used vs tickets/trophies medians side by side —
 * "how is this athlete doing in the wider market" — plus the yearly card
 * trend, marquee object results, live lots, and recent sales.
 *
 * North-star grammar (LotPage's pass): quiet kicker → light display name →
 * byline ledger → the category medians as dotted spec rows → the yearly
 * line in a framed chart → sections as registration plates.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { sportDrillOf, SPORTS_SLUG_KIND } from '../lib/submarkets';
import Link from 'next/link';
import ArtistNav from './ArtistNav';
import { LOTPAGE_CSS } from './LotPage';
import { Colophon } from './Terminal';
import { useRayData } from '../hooks/useRayData';
import { useSavedLots } from '../hooks/useSavedLots';
import { formatPrice, formatDate, getUpcomingCounts } from '../utils';
import FollowButton from './FollowButton';
import HeroChart, { type HeroLine } from '../preview/terminal/HeroChart';
import type { AuctionLot } from '../types';
import { signedPct } from './SubMarketDirectory';
import '../northstar-pages.css';

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

/** players.json carries names as the houses print them — Goldin shouts
    ("MICHAEL JORDAN", "KEN GRIFFEY JR."). A shouting name is re-cased for
    display everywhere it renders (title, Follow button, prose); a name the
    house already cased ("LeBron James", "Shohei Ohtani") is left alone. */
const SMALL = new Set(['de', 'da', 'del', 'della', 'di', 'la', 'le', 'van', 'von', 'y']);
export function displayName(raw: string): string {
  const name = (raw || '').trim();
  const letters = name.replace(/[^a-zA-Z]/g, '');
  if (letters.length < 3) return name;
  const shouting = name.replace(/[^A-Z]/g, '').length / letters.length > 0.85;
  if (!shouting) return name;
  return name.toLowerCase().split(/\s+/).map((w, i) => {
    const bare = w.replace(/[.,]/g, '');
    if (/^(ii|iii|iv|jr|sr)$/.test(bare)) return bare === 'jr' || bare === 'sr' ? `${bare.charAt(0).toUpperCase()}${bare.slice(1)}.` : bare.toUpperCase();
    if (i > 0 && SMALL.has(bare)) return w;
    // capitalize after word start, apostrophes, hyphens and "Mc"
    let out = w.replace(/(^|['’-])([a-z])/g, (_, a, b) => a + b.toUpperCase());
    out = out.replace(/^Mc([a-z])/, (_, b) => `Mc${b.toUpperCase()}`);
    return out;
  }).join(' ');
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

// The yearly card-median trend, drawn on the shared HeroChart money-line
// instrument (same adapter shape as SubPage / MakerDecadeBand: a yearly series
// mapped to a money HeroLine). A mix-affected median level, labeled as such —
// not appreciation. Abstains under 3 qualifying years, as the old line did.
function TrendLine({ yearly, name }: { yearly: PlayerEntry['yearly']; name: string }) {
  const points = useMemo<HeroLine['points']>(
    () => yearly.map(p => ({ period: String(p.y), value: p.med, n: p.n })),
    [yearly],
  );
  if (yearly.length < 3) return null;
  const anchor: HeroLine = {
    key: 'card-median',
    label: `${name} · yearly card median`,
    color: 'var(--color-fg, #f7f8f8)',
    unit: 'money',
    points,
  };
  return (
    <section className="nsp-section ns-plate" aria-label="Yearly card median">
      <div className="nsp-shead">
        <div>
          <span className="ns-kicker">The line</span>
          <h2 className="nsp-h2">Yearly card median, {yearly[0].y}–{yearly[yearly.length - 1].y}</h2>
        </div>
        <span className="nsp-shctx">median realized, by year</span>
      </div>
      <div className="nsp-chart">
        <HeroChart anchor={anchor} height={170} play={false} compact hideTickLabels={false} />
      </div>
      <p className="nsp-note">
        The typical (median) price a {name} card fetched each year — a mix-affected level, not an appreciation rate.
      </p>
    </section>
  );
}

export default function PlayerPage({ playerSlug }: { playerSlug: string }) {
  const { allLots, lastCrawl, totalLots, sources, market: marketData } = useRayData();
  // house count is the meta.json source list — not a hardcoded 7 that silently
  // rots when a house is added. Fall back to the lots' own houses if meta is
  // still landing.
  const houseCount = sources.length || new Set(allLots.map(l => l.auctionHouse)).size;
  const { savedIds } = useSavedLots();
  const { players, failed: loadFailed } = usePlayers();
  const upcomingCounts = useMemo(() => getUpcomingCounts(allLots), [allLots]);
  const entry = useMemo(() => players?.find(p => p.slug === playerSlug) || null, [players, playerSlug]);
  const name = entry ? displayName(entry.name) : '';

  // the document title — a client query page has no per-player static
  // metadata, so the dossier names itself once the entry lands
  useEffect(() => {
    if (!name) return;
    const prev = document.title;
    document.title = `${name} — player · lectr`;
    return () => { document.title = prev; };
  }, [name]);

  // live lots for this player — the build stamps playerSlug on upcoming sports lots
  const live = useMemo(
    () => allLots.filter(l => l.status === 'upcoming' && (l as AuctionLot & { playerSlug?: string | null }).playerSlug === playerSlug),
    [allLots, playerSlug],
  );

  const nav = <ArtistNav activeSlug={null} savedCount={savedIds.length} upcomingCounts={upcomingCounts} lastCrawl={lastCrawl ? formatDate(lastCrawl) : undefined} />;

  if (!entry) {
    const loading = players === null && !loadFailed;
    return (
      <div className="terminal-shell">
        {nav}
        <div className="rail nsp-empty" style={{ minHeight: loading ? '100dvh' : undefined }}>
          {loading ? (
            <p>Loading the player book&hellip;</p>
          ) : (
            <>
              <span className="ns-kicker">Player dossier</span>
              <h1>Not in the player book</h1>
              <p>{loadFailed ? 'The player data didn’t load — try again shortly.' : 'lectr keeps a dossier only where at least 25 sales back it.'}</p>
              <div className="nsp-links">
                <Link href="/sports" className="ray-call-btn ray-call-btn-quiet" style={{ textDecoration: 'none' }}>Back to the sports market</Link>
              </div>
            </>
          )}
        </div>
        <Colophon lotCount={totalLots || allLots.length} houseCount={houseCount} record={null} />
      </div>
    );
  }

  const cardMed = entry.cats['sports-cards']?.medUsd ?? null;
  const gearMed = entry.cats['game-used']?.medUsd ?? null;
  const catKeys = (['sports-cards', 'game-used', 'trophies-awards', 'tickets-passes', 'sports-memorabilia'] as const).filter(c => entry.cats[c]);

  return (
    <div className="terminal-shell">
      {nav}
      <div className="rail nsp-doss">
        <style dangerouslySetInnerHTML={{ __html: LOTPAGE_CSS }} />

        <div className="nsp-kicker-row">
          <span className="ns-kicker">
            <Link href="/sports">Sports</Link>
            {entry.sport ? <>{' · '}{entry.sport}</> : null}
            {' · player dossier'}
          </span>
          <span className="no">{entry.n.toLocaleString()} sales</span>
        </div>
        <div className="nsp-title-row">
          <h1 className="nsp-h1">{name}</h1>
          <FollowButton slug={entry.slug} name={name} />
        </div>
        <p className="nsp-dek">
          The whole market for one athlete — cards, game-worn and the physical record read together across every
          sale lectr has catalogued. Medians of what sold; the yearly line is the honest trend.
        </p>

        {/* the byline ledger — medians of WHAT SOLD, deliberately uncolored: a
            shift in the mix (premium cards trading more lately) is not
            appreciation, and green here would claim it is. */}
        <div className="ns-byline nsp-byline">
          <div>
            <div className="k">Sales on the book</div>
            <div className="v">{entry.n.toLocaleString()}</div>
            <div className="s">every category, realized</div>
          </div>
          {cardMed != null && (
            <div>
              <div className="k">Cards, median</div>
              <div className="v">{formatPrice(cardMed)}</div>
              <div className="s">{entry.cats['sports-cards'].n.toLocaleString()} sales</div>
            </div>
          )}
          {gearMed != null && (
            <div>
              <div className="k">Game-worn, median</div>
              <div className="v">{formatPrice(gearMed)}</div>
              <div className="s">{entry.cats['game-used'].n.toLocaleString()} sales</div>
            </div>
          )}
          {entry.sport && (
            <div>
              <div className="k">Sport</div>
              <div className="v">{entry.sport}</div>
            </div>
          )}
        </div>

        {/* the wider market, one spec row per category */}
        {catKeys.length > 0 && (
          <section className="nsp-section ns-plate" aria-label="The wider market">
            <div className="nsp-shead">
              <div>
                <span className="ns-kicker">The wider market</span>
                <h2 className="nsp-h2">By category, medians of what sold</h2>
              </div>
              <span className="nsp-shctx">plain ink — a shift in the mix is not appreciation</span>
            </div>
            <div className="nsp-ledger">
              {catKeys.map(cat => {
                const c = entry.cats[cat];
                // the athlete's sub-market: this kind x their sport, from drills —
                // "how the market they trade in is moving", beside their own numbers
                const drillSlug = sportDrillOf(entry.sport);
                const dr = drillSlug
                  ? (marketData?.drills?.sports || []).find(r => r.slug === `${SPORTS_SLUG_KIND[cat]}:${drillSlug}`)
                  : null;
                const drNote = dr && dr.readType === 'index' && dr.index
                  ? `market ${signedPct(dr.index.changePct)} ${dr.index.horizon} verified`
                  : dr && dr.readType === 'demand' && dr.demandNow != null
                    ? `market ${signedPct(dr.demandNow)} vs estimate`
                    : null;
                return (
                  <div key={cat} className="ns-ledger-row">
                    <span className="nsp-lk">
                      {dr ? <Link href={`/sub/${dr.slug.replace(':', '/')}`} className="t" style={{ textDecoration: 'none' }}>{CAT_LABEL[cat]}</Link> : <span className="t">{CAT_LABEL[cat]}</span>}
                      <span className="nsp-lsub">
                        {c.n.toLocaleString()} sales{drNote ? ` · ${drNote}` : ''}
                      </span>
                    </span>
                    <span className="nsp-lval">
                      {c.ttmMedUsd != null && c.ttmMedUsd !== c.medUsd && (
                        <span className="nsp-lsub" style={{ marginLeft: 0 }}>{formatPrice(c.ttmMedUsd)} past yr</span>
                      )}
                      <span className="nsp-lv">{formatPrice(c.medUsd)}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <TrendLine yearly={entry.yearly} name={name} />

        {live.length > 0 && (
          <section className="nsp-section ns-plate" aria-label="On the block now">
            <div className="nsp-shead">
              <div>
                <span className="ns-kicker">Live</span>
                <h2 className="nsp-h2">On the block now, {live.length}</h2>
              </div>
              <span className="nsp-shctx">printed bids only</span>
            </div>
            <div className="nsp-rows">
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
          <section className="nsp-section ns-plate" aria-label="Top object results">
            <div className="nsp-shead">
              <div>
                <span className="ns-kicker">The physical market</span>
                <h2 className="nsp-h2">Top object results</h2>
              </div>
              <span className="nsp-shctx">game-worn, trophies &amp; tickets</span>
            </div>
            <div className="nsp-rows">
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

        <section className="nsp-section ns-plate" aria-label="Recent sales">
          <div className="nsp-shead">
            <div>
              <span className="ns-kicker">The record</span>
              <h2 className="nsp-h2">Recent sales</h2>
            </div>
            <span className="nsp-shctx">realized, buyer&rsquo;s premium included</span>
          </div>
          <div className="nsp-rows">
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
          <p className="nsp-note">
            Medians over every {name} sale lectr has catalogued — cards and the physical market read together.
          </p>
        </section>

        <div className="nsp-links">
          <Link href="/sports" className="ray-call-btn ray-call-btn-quiet" style={{ textDecoration: 'none' }}>The sports market</Link>
          <Link href="/sub" className="ray-call-btn ray-call-btn-quiet" style={{ textDecoration: 'none' }}>Every sub-market</Link>
        </div>
      </div>
      <Colophon lotCount={totalLots || allLots.length} houseCount={houseCount} record={null} />
    </div>
  );
}
