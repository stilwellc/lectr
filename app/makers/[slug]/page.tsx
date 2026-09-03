'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import SubMarketDrills from '../../components/analytics/SubMarketDrills';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { ARTISTS, ARTIST_LABEL, marketOf } from '../../constants';
import type { AuctionLot, LotCategory, MarketStats } from '../../types';
import { useFullLots, retryFullLoad, useSoldArchive, retryArchiveLoad } from '../../hooks/useRayData';
import type { MarketData } from '../../hooks/useRayData';
import { useSavedLots } from '../../hooks/useSavedLots';
import { useMarket } from '../../lib/market';
import { getUpcomingCounts, formatDate, localToday, isLiveUpcoming, refLabel } from '../../utils';
import { useRefs, refsForMaker } from '../../hooks/useRefs';
import { encodeRefPath } from '../../ref/ref-path';

import ArtistNav from '../../components/ArtistNav';
import ArtistHero from '../../components/ArtistHero';
import MarketSwitch from '../../components/MarketSwitch';
import UpcomingLots from '../../components/UpcomingLots';
import PastResults from '../../components/PastResults';
import RayEntrance, { RayLoading } from '../../components/RayEntrance';
import { Colophon } from '../../components/Terminal';

// P1-10: both charts are client-only; without a placeholder the page jumps
// by a full chart well when the module lands. The skeletons match the wells
// exactly (PriceChart: section padding + 300px container, 200px on phones;
// the decade band: 150px) so the layout is settled before the chart draws.
function PriceChartWell() {
  return (
    <section className="rail" style={{ paddingBlock: 'var(--sect-t) var(--sect-b)' }} aria-hidden>
      <div className="mkr-chart-well" />
    </section>
  );
}
const PriceChart = dynamic(() => import('../../components/PriceChart'), { ssr: false, loading: PriceChartWell });
// #32 — the maker's-decade band rides on the same hand-rolled SVG instrument as
// the lander hero. ssr:false: it measures its container with a ResizeObserver.
const HeroChart = dynamic(() => import('../../preview/terminal/HeroChart'), { ssr: false, loading: () => <div style={{ height: 150 }} aria-hidden /> });
type HeroLine = import('../../preview/terminal/HeroChart').HeroLine;

// A thin wrapper so the decade band mounts the shared HeroChart with the
// dossier's conservative geometry (short, no subpane, no flip, always resolved
// — `play={false}` means the write-on animation never re-fires on re-render).
function HeroDecadeChart({ anchor }: { anchor: HeroLine }) {
  return <HeroChart anchor={anchor} height={150} play={false} compact hideTickLabels={false} />;
}

type CategoryFilter = 'all' | LotCategory;

// A retry-able "the archive didn't load" panel — shared by the phase-2
// (fullError) and phase-3 (archiveError) failure paths so a gated section
// never stalls on an eternal skeleton.
function ArchiveErrorPanel({ onRetry }: { onRetry: () => void }) {
  return (
    <div style={{ padding: '120px 24px', textAlign: 'center' }}>
      <h2 style={{
        fontFamily: 'var(--font-sans), sans-serif',
        fontSize: 34,
        fontWeight: 350,
        letterSpacing: '-0.02em',
        marginBottom: 10,
      }}>
        The archive didn&rsquo;t load
      </h2>
      <p style={{ fontSize: 14, color: 'var(--color-text-muted)', marginBottom: 24 }}>
        The crawl couldn&rsquo;t fetch the full sale history. Check your connection and try again.
      </p>
      <button className="ray-call-btn ray-call-btn-primary" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}

// ── DOSSIER FEATURE BLOCKS (wave 2c) ──────────────────────────────────────
// One injected stylesheet for the maker-dossier leader rows / strips below —
// mirrors the .ray-dr-row grammar from SubMarketDrills (2px-dotted rows, mono
// only on numerals) so these read as one family with the panel above them.
const DOSSIER_FEATURE_CSS = `
.mkr-panel{margin-top:14px}
/* self-contained card padding (HouseMatrix's pattern): the dossier never
   mounts VerifiedMovers, whose injected global is where .ray-vm-card's
   padding otherwise comes from */
.mkr-panel.ray-vm-card{padding:var(--card-pad)}
.mkr-chart-well{height:300px}
@media (max-width:768px){.mkr-chart-well{height:200px}}
.mkr-panel-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:2px}
.mkr-panel-title{font-size:15px;font-weight:550;letter-spacing:-0.01em;color:var(--color-fg,#E8EAED)}
.mkr-panel-method{font-size:11.5px;color:var(--color-text-faint,#7A8087)}
.mkr-rows{display:flex;flex-direction:column;margin-top:8px}
.mkr-row{display:grid;grid-template-columns:1fr auto auto;gap:14px;align-items:baseline;padding:9px 6px;margin:0 -6px;border-bottom:2px dotted var(--hairline,rgba(255,255,255,0.09));border-radius:8px;color:inherit;text-decoration:none;transition:background 0.14s ease}
.mkr-row:last-child{border-bottom:none}
a.mkr-row:hover{background:var(--color-hover-item,rgba(255,255,255,0.045))}
a.mkr-row:hover .mkr-row-name{color:var(--color-fg,#f7f8f8)}
.mkr-row-name{font-size:13.5px;color:var(--color-fg,#E8EAED)}
.mkr-row-sub{color:var(--color-text-faint,#7A8087);font-size:12px;margin-left:7px}
.mkr-row-val{font-size:13px;font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap;color:var(--color-fg,#E8EAED)}
/* $ levels stay sans (mono is reserved for %-deltas/serials) — matches the
   sub-market directory's grammar in the same view */
.mkr-row-val .num{font-variant-numeric:tabular-nums}
.mkr-row-val .tag{color:var(--color-text-faint,#7A8087);font-size:11px;margin-left:5px}
.mkr-row-meta{color:var(--color-text-faint,#7A8087);font-size:11.5px;font-variant-numeric:tabular-nums;text-align:right;min-width:64px}
@media (max-width:640px){.mkr-row{grid-template-columns:1fr auto}.mkr-row-meta{display:none}}
.mkr-note{margin-top:10px;font-size:11.5px;color:var(--color-text-faint,#7A8087)}
/* the engine-flags callout rides the cream ns-well plate; this class only
   keeps its type + link grammar */
.mkr-flag{display:inline-block;font-size:13.5px;color:var(--color-fg,#E8EAED)}
.mkr-flag a{color:inherit;text-decoration-color:var(--color-border-mid);text-underline-offset:3px}
`;
function useDossierFeatureStyles() {
  useEffect(() => {
    const ID = 'mkr-dossier-feature-style';
    if (document.getElementById(ID)) return;
    const el = document.createElement('style');
    el.id = ID;
    el.textContent = DOSSIER_FEATURE_CSS;
    document.head.appendChild(el);
  }, []);
}

const fmtUsdCompact = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `$${Math.round(n / 1000)}K` : `$${Math.round(n).toLocaleString()}`;

// median of a numeric array (undefined-safe caller)
function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// #26 — SPORTS DOSSIERS → PLAYER STRIP. Aggregate the maker's loaded lots by
// playerSlug, top ~6 by lot count, each a row into /player?id=<slug>. A median
// rides along ONLY when ≥3 of that player's rows carry a realized price (else
// the count stands alone — never a fabricated typical). Descriptive: counts and
// a median, never a %-move.
function PlayerStrip({ lots, label }: { lots: AuctionLot[]; label: string }) {
  const players = useMemo(() => {
    const by = new Map<string, { slug: string; name: string; n: number; prices: number[] }>();
    for (const l of lots) {
      if (!l.playerSlug) continue;
      const cur = by.get(l.playerSlug) || { slug: l.playerSlug, name: l.playerName || l.playerSlug, n: 0, prices: [] };
      cur.n += 1;
      if (l.status === 'sold' && l.priceUsd && l.priceUsd > 0) cur.prices.push(l.priceUsd);
      if (!cur.name && l.playerName) cur.name = l.playerName;
      by.set(l.playerSlug, cur);
    }
    return Array.from(by.values()).sort((a, b) => b.n - a.n).slice(0, 6);
  }, [lots]);

  if (players.length < 2) return null;

  return (
    <div className="ray-vm ray-vm-card glass glass-quiet mkr-panel">
      <div className="mkr-panel-head">
        <span className="mkr-panel-title">Most-traded names</span>
        <span className="mkr-panel-method">{label} lots on the desk · by athlete</span>
      </div>
      <div className="mkr-rows">
        {players.map(p => {
          const med = median(p.prices);
          return (
            <Link key={p.slug} href={`/player?id=${encodeURIComponent(p.slug)}`} className="mkr-row">
              <span className="mkr-row-name">
                {p.name}
                <span className="mkr-row-sub">{p.n} {p.n === 1 ? 'lot' : 'lots'}</span>
              </span>
              <span className="mkr-row-val">
                {med !== null && p.prices.length >= 3
                  ? <><span className="num">{fmtUsdCompact(med)}</span><span className="tag">median · n={p.prices.length}</span></>
                  : <span className="tag">—</span>}
              </span>
              {/* no third column: the lot count already rides the name — a
                  duplicate '138×' meta cell printed the same figure twice */}
            </Link>
          );
        })}
      </div>
      <p className="mkr-note">Counts are lots tracked for this name in the loaded set — a volume fact, not a price move. Median shown only where ≥3 sold with a realized price.</p>
    </div>
  );
}

// #27 — WATCH DOSSIERS → /ref REFERENCE LEDGER. The reference is the watch
// unit of decision. Top ~8 refs by sample depth, each into /ref/<maker>/<enc>.
// n · median · TTM delta (a real measured median-over-median move, so it may
// light up/down). Gated on refs loaded — honest loading/empty/failed states.
function RefLedger({ slug, label }: { slug: string; label: string }) {
  const { refs, failed, retry } = useRefs();
  const rows = useMemo(() => refsForMaker(refs, slug).slice(0, 8), [refs, slug]);

  if (failed) {
    return (
      <div className="ray-vm ray-vm-card glass glass-quiet mkr-panel">
        <div className="mkr-panel-head"><span className="mkr-panel-title">References</span></div>
        <p className="mkr-note">The reference book didn&rsquo;t load.</p>
        <button className="ray-show-more" style={{ marginTop: 10, padding: '7px 20px' }} onClick={retry}>
          Try again
        </button>
      </div>
    );
  }
  if (refs === null) {
    return (
      <div className="ray-vm ray-vm-card glass glass-quiet mkr-panel">
        <div className="mkr-panel-head"><span className="mkr-panel-title">References</span></div>
        <p className="mkr-note">Loading the reference book&hellip;</p>
      </div>
    );
  }
  if (rows.length < 2) return null;

  return (
    <div className="ray-vm ray-vm-card glass glass-quiet mkr-panel">
      <div className="mkr-panel-head">
        <span className="mkr-panel-title">References</span>
        <span className="mkr-panel-method">{label} · the deepest reference lines · median realized, all houses</span>
      </div>
      <div className="mkr-rows">
        {rows.map(r => {
          // TTM delta vs the all-time median — both sides are medians of
          // realized sales, but with no window-n floor or magnitude gate the
          // figure is a mix artifact at large sizes (prod rendered "+1155%
          // ttm" in green on /makers/rolex). Gate hard: a deep reference line
          // (n≥20) moving within ±100% may carry direction; anything outside
          // abstains — wrong is worse than blank.
          const rawTtm = r.ttmMedianUsd != null && r.medianUsd > 0
            ? ((r.ttmMedianUsd - r.medianUsd) / r.medianUsd) * 100
            : null;
          const ttmDelta = rawTtm != null && r.n >= 20 && Math.abs(rawTtm) <= 100 ? rawTtm : null;
          return (
            <Link key={r.key} href={`/ref/${slug}/${encodeRefPath(r.ref)}`} className="mkr-row">
              <span className="mkr-row-name">
                {/* the same display label /ref's h1 prints — never the raw
                    lower-case refs.json key ('oysterperpetual') */}
                {refLabel(r.ref)}
                <span className="mkr-row-sub">{r.n.toLocaleString()} sales</span>
              </span>
              <span className="mkr-row-val">
                <span className="num">{fmtUsdCompact(r.medianUsd)}</span>
                {ttmDelta !== null && Math.abs(ttmDelta) >= 1 && (
                  <span className="tag" style={{ color: ttmDelta >= 0 ? 'var(--color-up)' : 'var(--color-down-text)' }}>
                    {ttmDelta >= 0 ? '+' : ''}{ttmDelta.toFixed(0)}% ttm
                  </span>
                )}
              </span>
              <span className="mkr-row-meta">{r.houses.length} {r.houses.length === 1 ? 'house' : 'houses'}</span>
            </Link>
          );
        })}
      </div>
      <p className="mkr-note">Each reference&rsquo;s median is over all its realized sales; the ttm figure compares the trailing year&rsquo;s median to the all-time median (both measured). The reference page carries the full yearly series.</p>
    </div>
  );
}

// #28 — VALUE-ENGINE PRESENCE. Scan the maker's UPCOMING lots for a
// below-comparable-market engine signal (lot.value.signal — the same read the
// feed's cardTone uses). Surface a small honest summary; abstain when none.
function ValueEnginePresence({ upcoming }: { upcoming: AuctionLot[] }) {
  const { flagged, total } = useMemo(() => {
    let flagged = 0;
    let total = 0;
    for (const l of upcoming) {
      // only lots the engine actually appraised count toward the denominator
      if (!l.value || l.value.signal === undefined) continue;
      total += 1;
      if (l.value.signal && l.value.signal.label === 'below comparable market') flagged += 1;
    }
    return { flagged, total };
  }, [upcoming]);

  if (total === 0 || flagged === 0) return null;

  return (
    <div className="rail" style={{ marginTop: 4 }}>
      <div className="mkr-flag ns-well" style={{ display: 'inline-block', padding: '12px 18px' }}>
        The engine flags{' '}
        <a href="#upcoming"><strong>{flagged}</strong> of {total} appraised live {total === 1 ? 'lot' : 'lots'}</a>{' '}
        below comparable market.{' '}
        <Link href="/value" style={{ color: 'inherit' }}>See the value desk &rsaquo;</Link>
      </div>
    </div>
  );
}

// #30 — bidVELOCITY summary for the dossier's upcoming section. The individual
// cards already carry the .ray-lot-bidvel chip (via LotCard); this section-
// level summary counts the live lots that are moving. Butter accent, never
// green/red — a descriptive count of activity, mirroring wave-2a.
function MovingNowSummary({ upcoming }: { upcoming: AuctionLot[] }) {
  const { count, bids } = useMemo(() => {
    let count = 0;
    let bids = 0;
    for (const l of upcoming) {
      if (l.bidVelocity && l.bidVelocity.delta > 0) { count += 1; bids += l.bidVelocity.delta; }
    }
    return { count, bids };
  }, [upcoming]);

  if (count === 0) return null;

  return (
    <div className="rail" style={{ marginTop: 4 }}>
      <span className="ray-bidvel" style={{ fontSize: 12 }}>
        <span className="ray-bidvel-dot" aria-hidden />
        <span className="ray-bidvel-sub">
          {count} live {count === 1 ? 'lot' : 'lots'} moving now · +{bids.toLocaleString()} {bids === 1 ? 'bid' : 'bids'} recently
        </span>
      </span>
    </div>
  );
}

// #29 — NON-WATCH SUB-MARKET LEDGER. Art/design/etc. makers have NO per-maker
// drill rows (drills are per-KIND for the whole vertical). Show the VERTICAL's
// kind sub-markets as CONTEXT — clearly NOT the maker's own numbers. Reuses
// SubMarketDrills (scope=vertical, no parentFilter → the kind rows) with a
// method line that names it as the market the maker trades in.
function VerticalContextLedger({ marketData, vertical, label }: { marketData: MarketData | null; vertical: string; label: string }) {
  return (
    <div className="rail" style={{ marginTop: 10 }}>
      <SubMarketDrills
        marketData={marketData}
        scope={vertical}
        title="The market this maker trades in"
        method={`${vertical} sub-markets across the whole corpus — not ${label}'s own figures`}
      />
    </div>
  );
}

// #32 — "MAKER'S DECADE" ERA BAND. The maker's own yearly-median from the
// loaded SOLD lots, n-gated (≥8/yr). Rendered as a compact HeroChart money
// line. Labeled "yearly typical price" — a mix-affected median, NOT demand or
// appreciation. Renders nothing when the maker's yearly depth is too thin
// (fewer than 6 qualifying years — 3 mix-skewed years on sports-cards drew a
// ~$200K→$400 cliff that read as a market crash; abstain beats a wrong-looking
// picture).
function MakerDecadeBand({ lots, label }: { lots: AuctionLot[]; label: string }) {
  const points = useMemo(() => {
    const byYear = new Map<number, number[]>();
    for (const l of lots) {
      if (l.status !== 'sold' || !l.priceUsd || l.priceUsd <= 0 || !l.saleDate) continue;
      const d = new Date(l.saleDate);
      if (isNaN(d.getTime()) || d.getTime() > Date.now()) continue;
      const y = d.getUTCFullYear();
      const arr = byYear.get(y) || [];
      arr.push(l.priceUsd);
      byYear.set(y, arr);
    }
    return Array.from(byYear.entries())
      .filter(([, ps]) => ps.length >= 8) // n-gate: a year needs ≥8 sales to typify
      .sort((a, b) => a[0] - b[0])
      .map(([y, ps]) => ({ period: String(y), value: median(ps)!, n: ps.length }));
  }, [lots]);

  if (points.length < 6) return null;

  const anchor = { key: 'typical', label: `${label} · yearly typical`, color: 'var(--color-fg, #E8EAED)', unit: 'money' as const, points };

  return (
    <div className="rail mkr-panel">
      <div className="mkr-panel-head">
        <span className="mkr-panel-title">The maker&rsquo;s decade</span>
        <span className="mkr-panel-method">yearly typical price · median · n-gated ≥8/yr</span>
      </div>
      <div style={{ marginTop: 6 }}>
        <HeroDecadeChart anchor={anchor} />
      </div>
      <p className="mkr-note">This is the typical (median) price a {label} lot fetched each year — a mix-affected level, not a demand index or an appreciation rate. Years with fewer than eight sold lots are omitted.</p>
    </div>
  );
}

// The gated sold/upcoming sections. `sold`/`chartLots` already carry any
// merged archive rows; the hero re-renders with them too. Kept as a leaf so
// both the standard (phase-2) and archive (phase-3) bodies reuse it verbatim.
function MakerSections({
  slug,
  stats,
  label,
  chartLots,
  upcoming,
  sold,
  allLots,
  savedIds,
  onToggleSave,
  ownedIds,
  onToggleOwned,
  categoryFilter,
  onCategoryChange,
  fromCache,
}: {
  slug: string;
  stats: MarketStats | null;
  label: string;
  chartLots: AuctionLot[];
  upcoming: AuctionLot[];
  sold: AuctionLot[];
  allLots: AuctionLot[];
  savedIds: string[];
  onToggleSave: (id: string) => void;
  ownedIds: string[];
  onToggleOwned: (id: string) => void;
  categoryFilter: CategoryFilter;
  onCategoryChange: (c: CategoryFilter) => void;
  fromCache: boolean;
}) {
  return (
    <RayEntrance animate={!fromCache}>
      {sold.length === 0 && upcoming.length === 0 && (
        <div className="rail ray-enter" style={{ padding: '72px 24px', textAlign: 'center' }}>
          <p style={{ fontSize: 16, color: 'var(--color-text-secondary)', margin: 0 }}>
            No lots tracked for {label} right now.
          </p>
          <p style={{ fontSize: 13.5, color: 'var(--color-text-muted)', margin: '8px 0 0' }}>
            The desk refreshes daily as auction houses post new sales and results.
          </p>
          <Link href="/makers" className="ray-show-more" style={{ display: 'inline-block', marginTop: 20, textDecoration: 'none' }}>
            Back to the roster
          </Link>
        </div>
      )}
      {sold.length > 0 && (
        <div className="ray-enter" style={{ '--enter-delay': '90ms' } as React.CSSProperties}>
          <PriceChart
            lots={sold}
            allLots={chartLots}
            categoryFilter={categoryFilter}
            onCategoryChange={onCategoryChange}
            fallbackData={stats?.priceHistory}
            mark="01"
          />
        </div>
      )}
      {upcoming.length > 0 && (
        <div id="upcoming">
          <UpcomingLots
            lots={upcoming}
            allLots={allLots}
            stats={stats || undefined}
            savedIds={savedIds}
            onToggleSave={onToggleSave}
            mark="02"
            enterDelay={180}
          />
        </div>
      )}
      {sold.length > 0 && (
        <div className="ray-enter" style={{ '--enter-delay': '270ms' } as React.CSSProperties}>
          <PastResults
            lots={sold}
            categoryFilter={categoryFilter}
            onCategoryChange={onCategoryChange}
            savedIds={savedIds}
            onToggleSave={onToggleSave}
            ownedIds={ownedIds}
            onToggleOwned={onToggleOwned}
            mark="03"
          />
        </div>
      )}
    </RayEntrance>
  );
}

export default function ArtistDetailPage() {
  const params = useParams();
  const slug = params.slug as string;
  // useFullLots (not useRayData): the lot-level sections below gate on
  // fullLoaded, so this route must trigger the phase-2 corpus on mount.
  const { statsByArtist, allLots, lastCrawl, fullLoaded, fullError, fromCache, market: marketData } = useFullLots();
  const { toggle, savedIds, ownedIds, toggleOwned } = useSavedLots();
  const { setMarket } = useMarket();
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  useDossierFeatureStyles(); // one-shot injection for the dossier leader rows

  const label = ARTIST_LABEL[slug];
  const valid = ARTISTS.some(a => a.slug === slug);
  // A sports/science maker's Goldin sold history lives in the phase-3 archive
  // (split out of the eager + phase-2 payloads). Only these makers pay for it —
  // art/design/watches/culture makers never mount useSoldArchive() (Goldin
  // culture sold rows are deliberately kept in the phase-2 shards).
  const market = marketOf(slug);
  const isArchiveMaker = valid && (market === 'sports' || market === 'science');

  // A maker page IS its market: the switch under the nav lights the maker's
  // vertical, and the choice persists like landing on the vertical would.
  useEffect(() => {
    if (valid) setMarket(market);
    // once per maker — the user may still flip the switch afterwards
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, valid]);

  // Saves made here carry their baseline (est mid, signal, bids) so /profile
  // can say what changed since.
  const toggleWithLot = useCallback(
    (id: string) => toggle(id, allLots.find(l => l.id === id)),
    [toggle, allLots]
  );

  const stats = statsByArtist[slug] || null;
  // memoized on [allLots, slug]: the full-corpus filter + sort must not re-run
  // on every pill click / save toggle — and stable identities keep the memos
  // inside PriceChart/PastResults from re-aggregating the whole history.
  // `sold` lives here too: an inline filter in the JSX would hand PastResults
  // a fresh array identity every render, defeating exactly that.
  const { lots, upcoming, sold } = useMemo(() => {
    const lots = allLots.filter(l => l.artist === slug);
    const today = localToday(); // the reader's local YYYY-MM-DD
    const upcoming = lots
      .filter(l => isLiveUpcoming(l, today))
      .sort((a, b) => {
        if (!a.saleDate) return 1;
        if (!b.saleDate) return -1;
        return new Date(a.saleDate).getTime() - new Date(b.saleDate).getTime();
      });
    const sold = lots.filter(l => l.status === 'sold');
    return { lots, upcoming, sold };
  }, [allLots, slug]);

  const upcomingCounts = useMemo(() => getUpcomingCounts(allLots), [allLots]);

  return (
    <div className="terminal-shell" style={{
      minHeight: '100vh',
      fontFamily: "var(--font-sans), sans-serif",
    }}>
      <ArtistNav activeSlug={slug} savedCount={savedIds.length} upcomingCounts={upcomingCounts} lastCrawl={lastCrawl ? formatDate(lastCrawl) : undefined} />

      {!valid ? (
        <div style={{ padding: '120px 24px', textAlign: 'center' }}>
          <h2 style={{
            fontFamily: 'var(--font-sans), sans-serif',
            fontSize: 34,
            fontWeight: 350,
            letterSpacing: '-0.02em',
            marginBottom: 10,
          }}>
            Nothing tracked at this address
          </h2>
          <p style={{ fontSize: 14, color: 'var(--color-text-muted)', marginBottom: 24 }}>
            The desk follows {ARTISTS.length} artists and makers across art, design, watches, sports, science and pop culture.
          </p>
          <Link href="/" className="ray-call-btn ray-call-btn-primary" style={{ textDecoration: 'none', display: 'inline-block' }}>
            Back to the market
          </Link>
        </div>
      ) : (
        <>
          {/* The hero is un-gated: it paints from phase-1 statsByArtist the
              moment the stats land — the phase-2 corpus only gates the lot-level
              sections below. For archive makers it re-renders with merged
              sold rows once phase 3 arrives (ArchiveMakerBody re-renders it). */}
          {!isArchiveMaker && (
            <RayEntrance animate={!fromCache}>
              <div className="rail ray-enter" style={{ paddingTop: 'var(--space-4)' }}>
                <MarketSwitch compact />
              </div>
              <div className="ray-enter" style={{ '--enter-delay': '60ms' } as React.CSSProperties}>
                <ArtistHero animate={!fromCache} slug={slug} serial={lastCrawl ? lastCrawl.slice(0, 10).replace(/-/g, '') : undefined} label={label} stats={stats} lots={lots} upcomingCount={upcoming.length} market={market} />
              </div>
              {/* watch makers: the model-family ledger — pre-aggregated drill
                  rows scoped to this maker (Daytona vs Cellini, honest reads) */}
              {market === 'watches' && (
                <div className="rail ray-enter" style={{ '--enter-delay': '80ms', paddingTop: 8 } as React.CSSProperties}>
                  <SubMarketDrills marketData={marketData} scope="watches" parentFilter={slug} title="Model families" method={`${label} sub-markets · performance by family`} />
                  {/* #27 — the reference ledger: the watch unit of decision */}
                  <RefLedger slug={slug} label={label} />
                </div>
              )}
              {/* #32 — the maker's-decade band (art/design — sports/science get
                  it inside ArchiveMakerBody once the archive lands) */}
              {(market === 'art' || market === 'design' || market === 'culture') && (
                <div className="ray-enter" style={{ '--enter-delay': '80ms' } as React.CSSProperties}>
                  <MakerDecadeBand lots={lots} label={label} />
                </div>
              )}
              {/* #29 — non-watch makers have no per-maker drills; show the
                  vertical's kind sub-markets as clearly-labeled context */}
              {(market === 'art' || market === 'design') && (
                <div className="ray-enter" style={{ '--enter-delay': '100ms' } as React.CSSProperties}>
                  <VerticalContextLedger marketData={marketData} vertical={market} label={label} />
                </div>
              )}
              {/* #28/#30 — engine flags + live activity above the fold */}
              <div className="ray-enter" style={{ '--enter-delay': '120ms' } as React.CSSProperties}>
                <ValueEnginePresence upcoming={upcoming} />
                <MovingNowSummary upcoming={upcoming} />
              </div>
            </RayEntrance>
          )}

          {isArchiveMaker ? (
            <ArchiveMakerBody
              slug={slug}
              serial={lastCrawl ? lastCrawl.slice(0, 10).replace(/-/g, '') : undefined}
              label={label}
              stats={stats}
              phaseLots={lots}
              upcoming={upcoming}
              savedIds={savedIds}
              onToggleSave={toggleWithLot}
              ownedIds={ownedIds}
              onToggleOwned={toggleOwned}
              categoryFilter={categoryFilter}
              onCategoryChange={setCategoryFilter}
              fromCache={fromCache}
            />
          ) : !fullLoaded ? (
            fullError ? (
              // phase 2 (the full archive) failed after retries — say so and
              // offer a retry, never an eternal skeleton
              <ArchiveErrorPanel onRetry={() => retryFullLoad()} />
            ) : (
              <RayLoading />
            )
          ) : (
            <MakerSections
              slug={slug}
              label={label}
              stats={stats}
              chartLots={lots}
              upcoming={upcoming}
              sold={sold}
              allLots={allLots}
              savedIds={savedIds}
              onToggleSave={toggleWithLot}
              ownedIds={ownedIds}
              onToggleOwned={toggleOwned}
              categoryFilter={categoryFilter}
              onCategoryChange={setCategoryFilter}
              fromCache={fromCache}
            />
          )}

          {/* the closing colophon — corpus counts from meta.json */}
          <Colophon record={null} />
        </>
      )}
    </div>
  );
}

// Archive makers only: mounting this triggers useSoldArchive()'s phase-3
// fetch. It merges the maker's archive sold rows into lots/sold and re-renders
// the hero + the gated sections once the archive lands (RayLoading /
// archiveError-retry until then, mirroring the phase-2 fullError pattern).
function ArchiveMakerBody({
  slug,
  serial,
  label,
  stats,
  phaseLots,
  upcoming,
  savedIds,
  onToggleSave,
  ownedIds,
  onToggleOwned,
  categoryFilter,
  onCategoryChange,
  fromCache,
}: {
  slug: string;
  serial?: string;
  label: string;
  stats: MarketStats | null;
  phaseLots: AuctionLot[];
  upcoming: AuctionLot[];
  savedIds: string[];
  onToggleSave: (id: string) => void;
  ownedIds: string[];
  onToggleOwned: (id: string) => void;
  categoryFilter: CategoryFilter;
  onCategoryChange: (c: CategoryFilter) => void;
  fromCache: boolean;
}) {
  const { allLotsWithArchive, archiveLoaded, archiveError } = useSoldArchive();

  // the maker's full lot set with archive sold rows merged in
  const makerLots = useMemo(
    () => (archiveLoaded ? allLotsWithArchive.filter(l => l.artist === slug) : phaseLots),
    [archiveLoaded, allLotsWithArchive, slug, phaseLots]
  );
  const sold = useMemo(() => makerLots.filter(l => l.status === 'sold'), [makerLots]);

  return (
    <>
      <RayEntrance animate={!fromCache}>
        <div className="rail ray-enter" style={{ paddingTop: 'var(--space-4)' }}>
          <MarketSwitch compact />
        </div>
        <div className="ray-enter" style={{ '--enter-delay': '60ms' } as React.CSSProperties}>
          <ArtistHero animate={!fromCache} slug={slug} serial={serial} label={label} stats={stats} lots={makerLots} upcomingCount={upcoming.length} bidMarket market={marketOf(slug)} />
        </div>
        {/* #26 — sports player strip + #32 decade band ride the deep merged
            set, so they wait for the archive; the value/activity summaries
            read the always-present phase-2 upcoming and paint immediately. */}
        {marketOf(slug) === 'sports' && archiveLoaded && (
          <div className="rail ray-enter" style={{ '--enter-delay': '80ms' } as React.CSSProperties}>
            <PlayerStrip lots={makerLots} label={label} />
          </div>
        )}
        {archiveLoaded && (
          <div className="ray-enter" style={{ '--enter-delay': '90ms' } as React.CSSProperties}>
            <MakerDecadeBand lots={makerLots} label={label} />
          </div>
        )}
        <div className="ray-enter" style={{ '--enter-delay': '110ms' } as React.CSSProperties}>
          <ValueEnginePresence upcoming={upcoming} />
          <MovingNowSummary upcoming={upcoming} />
        </div>
      </RayEntrance>

      {!archiveLoaded ? (
        archiveError ? (
          <ArchiveErrorPanel onRetry={() => retryArchiveLoad()} />
        ) : (
          <RayLoading />
        )
      ) : (
        <MakerSections
          slug={slug}
          label={label}
          stats={stats}
          chartLots={makerLots}
          upcoming={upcoming}
          sold={sold}
          allLots={makerLots}
          savedIds={savedIds}
          onToggleSave={onToggleSave}
          ownedIds={ownedIds}
          onToggleOwned={onToggleOwned}
          categoryFilter={categoryFilter}
          onCategoryChange={onCategoryChange}
          fromCache={fromCache}
        />
      )}
    </>
  );
}
