'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { ARTISTS, MARKETS, marketArtists, rosterNoun, type Market } from '../constants';
import { useMarket } from '../lib/market';
import MarketSwitch from '../components/MarketSwitch';
import MarketIcon from '../components/MarketIcon';
import { useRayData } from '../hooks/useRayData';
import { useSavedLots } from '../hooks/useSavedLots';
import ArtistNav from '../components/ArtistNav';
import RayEntrance, { RayLoading } from '../components/RayEntrance';
import { formatDate, formatPrice, getUpcomingCounts } from '../utils';
import { formatDemand } from '../lib/demand';
import { verifiedMovers, type VerifiedMover } from '../preview/terminal/verified';
import CountUp from '../components/CountUp';
import Masthead, { Accent } from '../components/Masthead';
import { Colophon } from '../components/Terminal';
import Flick from '../components/Flick';

/**
 * Makers — THE DIRECTORY (Aug 2026 rebuild, Linear grammar). One dense,
 * filterable ledger of every tracked name, grouped by top-level category,
 * every row carrying its labels: discipline, market basis, verified index,
 * on-the-block state, history depth. ENTIRELY phase-1 — the row sparklines
 * ride stats.json's quarterly median history, so nothing on this page waits
 * for the 32MB corpus and nothing painted early ever changes.
 */

/* ── THE LABEL SYSTEM ────────────────────────────────────────────────────
   Discipline labels are curated facts, one per maker; anything not mapped
   falls back to the market's roster noun. States (verified / on the block /
   thin history / bid market) are MEASURED — derived from stats, the live
   book, and the CI'd maker index, never asserted. ── */
const DISCIPLINE: Record<string, string> = {
  // art
  'george-condo': 'Contemporary painting',
  'futura-2000': 'Street art',
  'kaws': 'Street & pop',
  'andy-warhol': 'Pop art',
  'tom-sachs': 'Sculpture & bricolage',
  'barry-mcgee': 'Street art',
  'keith-haring': 'Pop & street',
  'peter-saul': 'Pop surrealism',
  'ed-ruscha': 'Pop & conceptual',
  'r-crumb': 'Underground comix',
  'raymond-pettibon': 'Drawing',
  'henri-matisse': 'Modern master',
  'pablo-picasso': 'Modern master',
  'fab-5-freddy': 'Street art',
  'francesco-clemente': 'Neo-expressionism',
  'eddie-martinez': 'Contemporary painting',
  'kenny-scharf': 'Street & pop',
  'jean-michel-basquiat': 'Neo-expressionism',
  'roy-lichtenstein': 'Pop art',
  'francis-bacon': 'Figurative master',
  'alexander-calder': 'Sculpture & mobiles',
  'rashid-johnson': 'Contemporary',
  'jeff-koons': 'Sculpture & editions',
  // design
  'george-nakashima': 'Studio furniture',
  'charles-eames': 'Mid-century modern',
  'jean-prouve': 'Modernist metalwork',
  'pierre-jeanneret': 'Chandigarh modernism',
  // watches
  'rolex': 'Watchmaker',
  'patek-philippe': 'Watchmaker',
  'audemars-piguet': 'Watchmaker',
  'omega': 'Watchmaker',
  'cartier': 'Watchmaker & jeweler',
  // science
  'meteorites': 'Natural history',
  'fossils': 'Natural history',
  'space-exploration': 'Space history',
  'scientific-instruments': 'Instruments',
  'science-tech': 'Technology',
};
/** markets whose books post no estimates — their reads are realized-$.
    Culture is NOT here: its book carries enough estimates that the build
    publishes a demand index for it (served demand.culture exists). */
const BID_MARKETS = new Set<Market>(['sports', 'tcg']);

interface Row {
  slug: string; label: string; market: Market;
  discipline: string | null;
  spark: number[] | null;
  live: number;
  sold: number | null;
  median: number | null;
  verified: VerifiedMover | null;
  thin: boolean;
}

type SortKey = 'sold' | 'live' | 'median' | 'delta' | 'name';
const SORTS: { k: SortKey; label: string }[] = [
  { k: 'sold', label: 'Sold' },
  { k: 'live', label: 'Live' },
  { k: 'median', label: 'Median' },
  { k: 'delta', label: 'Verified Δ' },
  { k: 'name', label: 'A–Z' },
];

function Spark({ values }: { values: number[] }) {
  const w = 90, h = 22;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) =>
    `${(i / (values.length - 1)) * (w - 2) + 1},${h - 2 - ((v - min) / span) * (h - 4)}`
  ).join(' ');
  return (
    <svg width={w} height={h} aria-hidden>
      <polyline points={pts} fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function MakersPage() {
  // phase 1 ONLY — the directory's every figure derives from stats.json,
  // market.json and the eager upcoming set. No corpus, no late repaint.
  const { allLots, statsByArtist, lastCrawl, loading, fromCache, market: marketData, demand } = useRayData();
  const { market } = useMarket();
  const activeKey = MARKETS.find(m => m.key === market)?.live ? market : 'all';
  const activeLabel = activeKey === 'all' ? 'full' : activeKey === 'tcg' ? 'TCG' : MARKETS.find(m => m.key === activeKey)!.label.toLowerCase();
  const mktSet = useMemo(() => marketArtists(activeKey), [activeKey]);
  const rosterCount = useMemo(() => ARTISTS.filter(a => mktSet.has(a.slug)).length, [mktSet]);
  const { savedIds } = useSavedLots();
  const upcomingCounts = useMemo(() => getUpcomingCounts(allLots), [allLots]);
  const noun = activeKey === 'all' ? (rosterCount === 1 ? 'tracked name' : 'tracked names') : rosterNoun(activeKey, rosterCount);

  // ── the ledger's controls ──
  const [q, setQ] = useState('');
  const [fLive, setFLive] = useState(false);
  const [fVerified, setFVerified] = useState(false);
  const [sort, setSort] = useState<SortKey>('sold');

  const verifiedBySlug = useMemo(() => {
    const m = new Map<string, VerifiedMover>();
    if (marketData) for (const v of verifiedMovers(marketData)) m.set(v.slug, v);
    return m;
  }, [marketData]);

  const rows = useMemo<Row[]>(() => ARTISTS.map(a => {
    const st = statsByArtist[a.slug];
    const hist = st?.priceHistory || [];
    const sparkVals = hist.slice(-12).map(p => p.medianPrice || p.avgPrice).filter(v => v > 0);
    const sold = st?.totalSoldTracked ?? null;
    return {
      slug: a.slug, label: a.label, market: a.market as Market,
      // curated disciplines only — a bare roster-noun chip ("Category" on
      // every sports row) repeats what the group head already says
      discipline: DISCIPLINE[a.slug] || null,
      spark: sparkVals.length >= 4 ? sparkVals : null,
      live: upcomingCounts[a.slug] || 0,
      sold,
      median: st?.medianPriceLast12Months || null,
      verified: verifiedBySlug.get(a.slug) || null,
      thin: sold != null && sold > 0 && sold < 50,
    };
  }), [statsByArtist, upcomingCounts, verifiedBySlug]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const cmp = (a: Row, b: Row): number => {
      switch (sort) {
        case 'live': return b.live - a.live || (b.sold ?? 0) - (a.sold ?? 0);
        case 'median': return (b.median ?? -1) - (a.median ?? -1);
        case 'delta': return (b.verified?.changePct ?? -Infinity) - (a.verified?.changePct ?? -Infinity);
        case 'name': return a.label.localeCompare(b.label);
        default: return (b.sold ?? 0) - (a.sold ?? 0);
      }
    };
    return rows
      .filter(r => mktSet.has(r.slug))
      .filter(r => !needle || r.label.toLowerCase().includes(needle) || (r.discipline ?? '').toLowerCase().includes(needle))
      .filter(r => !fLive || r.live > 0)
      .filter(r => !fVerified || !!r.verified)
      .sort(cmp);
  }, [rows, mktSet, q, fLive, fVerified, sort]);

  // ── grouped by top-level category, MARKETS order ──
  const groups = useMemo(() =>
    MARKETS
      .filter(m => m.key !== 'all' && (activeKey === 'all' || m.key === activeKey))
      .map(m => {
        const g = visible.filter(r => r.market === m.key);
        const live = g.reduce((s, r) => s + r.live, 0);
        const ds = demand?.[m.key] || [];
        const demandNow = ds.length ? ds[ds.length - 1].value : null;
        return { key: m.key as Market, label: m.label, rows: g, live, demandNow };
      })
      .filter(g => g.rows.length > 0),
    [visible, activeKey, demand]);

  const totalLive = useMemo(() => ARTISTS.filter(a => mktSet.has(a.slug)).reduce((s, a) => s + (upcomingCounts[a.slug] || 0), 0), [mktSet, upcomingCounts]);
  const verifiedCount = useMemo(() => rows.filter(r => mktSet.has(r.slug) && r.verified).length, [rows, mktSet]);

  const row = (r: Row) => (
    <Link key={r.slug} href={`/makers/${r.slug}`} className="mk-row" data-nav-row>
      <span className="mk-mono" aria-hidden>{r.label.charAt(0)}</span>
      <span className="mk-id">
        <span className="mk-name">{r.label}</span>
        <span className="mk-tags">
          {r.discipline && <span className="mk-tag">{r.discipline}</span>}
          {BID_MARKETS.has(r.market) && <span className="mk-tag">bid market</span>}
          {r.verified && <span className="mk-tag mk-tag-verified" title={`CI-verified ${r.verified.horizon} move · 95% CI ${Math.round(r.verified.ciLoPct)}% to ${Math.round(r.verified.ciHiPct)}%`}>verified · {r.verified.horizon}</span>}
          {r.thin && <span className="mk-tag">thin history</span>}
        </span>
      </span>
      <span className="mk-cell mk-spark" aria-hidden>{r.spark ? <Spark values={r.spark} /> : <span className="mk-sparkgap" />}</span>
      <span className="mk-cell">{r.median ? formatPrice(r.median) : '—'}</span>
      <span className="mk-cell mk-delta" data-dir={r.verified ? r.verified.dir : undefined}>
        {r.verified ? `${r.verified.changePct >= 0 ? '+' : '−'}${Math.abs(Math.round(r.verified.changePct))}%` : '—'}
      </span>
      <span className="mk-cell" data-live={r.live > 0 || undefined}>{r.live > 0 ? r.live.toLocaleString() : '—'}</span>
      <span className="mk-cell mk-faint">{r.sold != null ? r.sold.toLocaleString() : '—'}</span>
      <span className="mk-go" aria-hidden><Flick size={10} /></span>
      {/* mobile right stack */}
      <span className="mk-mob">
        <span className="mk-mob-median">{r.median ? formatPrice(r.median) : r.live > 0 ? `${r.live} live` : '—'}</span>
        <span className="mk-mob-sub" data-dir={r.verified ? r.verified.dir : undefined}>
          {r.verified ? `${r.verified.changePct >= 0 ? '+' : '−'}${Math.abs(Math.round(r.verified.changePct))}% · ${r.verified.horizon}` : r.sold != null ? `${r.sold.toLocaleString()} sold` : ''}
        </span>
      </span>
    </Link>
  );

  return (
    <div className="terminal-shell" style={{ minHeight: '100vh', fontFamily: 'var(--font-sans), sans-serif' }}>
      <style dangerouslySetInnerHTML={{ __html: MAKERS_CSS }} />
      <ArtistNav activeSlug="artists" savedCount={savedIds.length} upcomingCounts={upcomingCounts} lastCrawl={lastCrawl ? formatDate(lastCrawl) : undefined} />

      {loading ? (
        <RayLoading />
      ) : (
        <RayEntrance animate={!fromCache}>
          <section className="rail ray-enter" style={{ paddingTop: 24, paddingBottom: 4 }}>
            <div style={{ marginBottom: 22 }}><MarketSwitch compact /></div>
            <Masthead
              kicker={`The roster · ${activeLabel} market`}
              datum={<CountUp to={rosterCount} format={n => `${Math.round(n)} ${noun}`} duration={900} animate={!fromCache} />}
              title={<>Every maker, one <Accent>ledger</Accent>.</>}
              sub={
                <>
                  <b style={{ color: 'var(--color-fg)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{totalLive.toLocaleString()} live lots</b> on the block
                  {verifiedCount > 0 && <> · {verifiedCount} CI-verified indexes</>}
                  {' '}· medians, never means
                </>
              }
            />
          </section>

          {/* ── THE FILTER BAR — the directory's controls, pinned under the nav ── */}
          <div className="mk-bar-wrap">
            <div className="rail mk-bar">
              <label className="mk-search">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                  <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.5-4.5" />
                </svg>
                <input
                  type="search" value={q} onChange={e => setQ(e.target.value)}
                  placeholder="Filter makers…" aria-label="Filter makers"
                />
                {q && <button type="button" className="mk-clear" onClick={() => setQ('')} aria-label="Clear filter">×</button>}
              </label>
              <button type="button" className="mk-chip" data-on={fLive || undefined} onClick={() => setFLive(v => !v)} aria-pressed={fLive}>
                On the block
              </button>
              <button type="button" className="mk-chip" data-on={fVerified || undefined} onClick={() => setFVerified(v => !v)} aria-pressed={fVerified}>
                Verified index
              </button>
              <span className="mk-bar-rule" aria-hidden />
              <span className="mk-count">{visible.length} of {rosterCount}</span>
              <div className="ray-seg mk-seg" role="tablist" aria-label="Sort the directory">
                {SORTS.map(s => (
                  <button key={s.k} type="button" role="tab" className="ray-seg-btn" data-active={sort === s.k}
                    aria-selected={sort === s.k} onClick={() => setSort(s.k)}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ── THE DIRECTORY — grouped by top-level category ── */}
          <section className="rail ray-enter" style={{ '--enter-delay': '40ms', paddingTop: 6, paddingBottom: 30 } as React.CSSProperties}>
            <div className="mk-cols" aria-hidden>
              <span /><span className="kicker">Maker</span>
              <span className="kicker" style={{ textAlign: 'right' }}>12q curve</span>
              <span className="kicker" style={{ textAlign: 'right' }}>Median · 12mo</span>
              <span className="kicker" style={{ textAlign: 'right' }}>Verified Δ</span>
              <span className="kicker" style={{ textAlign: 'right' }}>Live</span>
              <span className="kicker" style={{ textAlign: 'right' }}>Sold</span>
              <span />
            </div>

            {groups.length === 0 ? (
              <p className="mk-empty">
                No maker matches{q ? <> &ldquo;{q}&rdquo;</> : null}{fLive ? ' with lots on the block' : ''}{fVerified ? ' carrying a verified index' : ''} in the {activeLabel} market.
                {' '}<button type="button" className="mk-reset" onClick={() => { setQ(''); setFLive(false); setFVerified(false); }}>Clear the filters</button>
              </p>
            ) : groups.map(g => (
              <div key={g.key} className="mk-group">
                <div className="mk-group-head">
                  <span className="mk-group-mark" aria-hidden><MarketIcon market={g.key} size={15} /></span>
                  <h2 className="mk-group-name">{g.label}</h2>
                  <span className="mk-group-count">{g.rows.length}</span>
                  <span className="mk-group-rule" aria-hidden />
                  <span className="mk-group-read">
                    {g.live > 0 && <>{g.live.toLocaleString()} on the block</>}
                    {/* the served demand map is the gate — the build only
                        publishes an index where the book honestly carries one */}
                    {g.demandNow !== null && (
                      <>{g.live > 0 ? ' · ' : ''}demand <b data-dir={g.demandNow >= 0 ? 'up' : 'down'}>{formatDemand(g.demandNow)}</b></>
                    )}
                  </span>
                </div>
                <div className="mk-list">
                  {g.rows.map(row)}
                </div>
              </div>
            ))}
          </section>
        </RayEntrance>
      )}

      <Colophon record={null} />
    </div>
  );
}

const MAKERS_CSS = `
/* ════ THE MAKERS DIRECTORY (Aug 2026 rebuild) ════ */

/* ── the filter bar — pinned under the sticky nav ── */
.mk-bar-wrap{position:sticky;top:54px;z-index:30;background:color-mix(in srgb,#0b0c0e 88%,transparent);backdrop-filter:blur(14px);border-bottom:1px solid var(--color-border)}
.mk-bar{display:flex;align-items:center;gap:8px;padding-top:9px;padding-bottom:9px;flex-wrap:wrap}
.mk-search{display:inline-flex;align-items:center;gap:7px;flex:0 1 240px;min-width:150px;padding:0 10px;height:30px;background:var(--color-bg-elevated);border:1px solid var(--color-border);border-radius:8px;color:var(--color-text-faint)}
.mk-search input{flex:1;min-width:0;background:none;border:none;outline:none;font-family:var(--font-sans),sans-serif;font-size:12.5px;color:var(--color-fg)}
.mk-search input::placeholder{color:var(--color-text-faint)}
.mk-search:focus-within{border-color:var(--color-border-mid)}
.mk-clear{background:none;border:none;color:var(--color-text-faint);cursor:pointer;font-size:14px;padding:0 2px}
.mk-chip{font-family:var(--font-mono),monospace;font-size:10.5px;letter-spacing:0.08em;padding:0 12px;height:28px;background:none;color:var(--color-text-muted);border:1px solid var(--color-border);border-radius:100px;cursor:pointer;transition:color var(--duration-fast) var(--ease-signature),border-color var(--duration-fast) var(--ease-signature),background var(--duration-fast) var(--ease-signature)}
.mk-chip:hover{color:var(--color-fg)}
.mk-chip[data-on]{background:var(--color-fg);color:var(--color-bg);border-color:var(--color-fg)}
.mk-bar-rule{flex:1}
.mk-count{font-family:var(--font-mono),monospace;font-size:10.5px;color:var(--color-text-faint);font-variant-numeric:tabular-nums;white-space:nowrap}
.mk-seg .ray-seg-btn{font-size:11.5px;padding:5px 11px}
@media(max-width:700px){.mk-seg{order:5;flex-basis:100%;overflow-x:auto}.mk-bar-rule{display:none}}

/* ── column kickers (desktop) ── */
.mk-cols{display:none}
@media(min-width:940px){
  .mk-cols{display:grid;grid-template-columns:30px minmax(0,1fr) 96px 104px 84px 64px 70px 18px;gap:14px;align-items:baseline;padding:12px 14px 8px}
  .mk-cols .kicker{font-size:10px;letter-spacing:0.14em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
}

/* ── group heads — sticky under the bar, one glyph per category ── */
.mk-group{margin-bottom:6px}
.mk-group-head{position:sticky;top:103px;z-index:20;display:flex;align-items:center;gap:10px;padding:12px 0 9px;background:color-mix(in srgb,#08090a 90%,transparent);backdrop-filter:blur(14px);border-bottom:1px solid var(--color-border)}
.mk-group-mark{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;flex:none;border:1px solid var(--color-border);border-radius:8px;color:var(--color-text-secondary);background:var(--color-bg-elevated)}
.mk-group-name{margin:0;font-size:14px;font-weight:650;letter-spacing:-0.01em;white-space:nowrap}
.mk-group-count{font-family:var(--font-mono),monospace;font-size:10.5px;font-weight:600;font-variant-numeric:tabular-nums;color:var(--color-text-secondary);border:1px solid var(--color-border);border-radius:100px;padding:1px 8px;flex:none}
.mk-group-rule{flex:1;border-top:1px solid var(--color-border)}
.mk-group-read{font-size:11.5px;color:var(--color-text-faint);white-space:nowrap;font-variant-numeric:tabular-nums}
.mk-group-read b{font-weight:700;font-family:var(--font-mono),monospace}
.mk-group-read b[data-dir="up"]{color:var(--color-up)}
.mk-group-read b[data-dir="down"]{color:var(--color-down-text)}

/* ── rows — the dense ledger ── */
.mk-row{display:grid;grid-template-columns:30px minmax(0,1fr) auto;gap:12px;align-items:center;padding:9px 14px;min-height:52px;border-bottom:1px solid var(--color-hair,rgba(255,255,255,0.06));color:inherit;text-decoration:none;transition:background var(--duration-fast) var(--ease-signature)}
.mk-list .mk-row:last-child{border-bottom:none}
.mk-row:hover{background:var(--color-hover-item)}
.mk-row:focus-visible{outline:1.5px solid color-mix(in srgb,var(--color-fg) 70%,transparent);outline-offset:-1.5px;background:var(--color-hover-item)}
.mk-mono{width:30px;height:30px;display:flex;align-items:center;justify-content:center;flex:none;border-radius:8px;background:var(--color-bg-elevated);border:1px solid var(--color-hair,rgba(255,255,255,0.06));font-size:13px;font-weight:650;color:var(--color-text-secondary)}
.mk-id{min-width:0;display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.mk-name{font-size:13.5px;font-weight:600;color:var(--color-fg);white-space:nowrap}
.mk-tags{display:inline-flex;gap:5px;flex-wrap:wrap}
.mk-tag{display:inline-block;padding:1px 7px;font-family:var(--font-mono),monospace;font-size:10px;letter-spacing:0.05em;color:var(--color-text-muted);border:1px solid var(--color-border);border-radius:100px;white-space:nowrap}
.mk-tag-verified{color:var(--color-text-secondary);border-color:var(--color-border-mid)}
.mk-cell{display:none}
.mk-go{display:none}
.mk-mob{text-align:right;flex:none}
.mk-mob-median{display:block;font-family:var(--font-mono),monospace;font-size:12.5px;font-weight:600;font-variant-numeric:tabular-nums;color:var(--color-fg)}
.mk-mob-sub{display:block;font-family:var(--font-mono),monospace;font-size:10.5px;color:var(--color-text-faint);font-variant-numeric:tabular-nums}
.mk-mob-sub[data-dir="up"]{color:var(--color-up)}
.mk-mob-sub[data-dir="down"]{color:var(--color-down-text)}
@media(min-width:940px){
  .mk-row{grid-template-columns:30px minmax(0,1fr) 96px 104px 84px 64px 70px 18px;gap:14px}
  .mk-mob{display:none}
  .mk-cell{display:block;font-family:var(--font-mono),monospace;font-size:12.5px;letter-spacing:-0.01em;font-variant-numeric:tabular-nums;color:var(--color-fg);text-align:right;white-space:nowrap;overflow:hidden}
  .mk-faint{color:var(--color-text-faint)}
  .mk-cell[data-live]{font-weight:700}
  .mk-delta{color:var(--color-text-faint)}
  .mk-delta[data-dir="up"]{color:var(--color-up);font-weight:700}
  .mk-delta[data-dir="down"]{color:var(--color-down-text);font-weight:700}
  .mk-spark{display:flex;justify-content:flex-end;align-items:center}
  .mk-sparkgap{display:inline-block;width:90px}
  .mk-go{display:flex;justify-content:flex-end;color:var(--color-text-faint)}
}

/* ── empty state — the frame stays, the door stays open ── */
.mk-empty{font-size:13.5px;color:var(--color-text-muted);padding:34px 14px;margin:0}
.mk-reset{background:none;border:none;padding:0;font:inherit;color:var(--color-fg);cursor:pointer;text-decoration:underline dotted}
`;
