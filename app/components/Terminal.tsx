'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { AuctionLot } from '../types';
import { ARTIST_LABEL, ARTISTS, MARKETS, marketArtists, Market } from '../constants';
import { craftTitle, formatPrice, formatDate } from '../utils';
import { demandSeries, formatDemand } from '../lib/demand';
import type { DemandPoint } from '../hooks/useRayData';
import { lotSignal, confidenceMeter } from './LotCard';
import MarketIcon from './MarketIcon';

/**
 * Ray Terminal — the trading floor, settled. The committee's merged build:
 * index rail (the only market switch), the board's right rail (matted call
 * plate + the next hammers), the desk (maker matrix as tables), the film
 * strip (the eye), the record's backtest monument, and the colophon.
 * One seam grammar: 1px hairlines, no radii inside the terminal bands.
 */

function daysWord(dateStr: string): string {
  const days = Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days}d`;
}

/* ── THE STAR: the market tiles — big, clickable, first ─────────────── */
export function MarketTiles({
  demand,
  active,
  onPick,
  lots = [],
}: {
  demand: Record<string, DemandPoint[]>;
  active: Market;
  onPick: (m: Market) => void;
  /** live lots — each tile wears its market's own photography */
  lots?: AuctionLot[];
}) {
  // one deterministic hero image per market: the highest-estimate upcoming
  // lot with house photography (stable across renders — no hydration drift)
  const tileArt = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    const withImg = lots.filter(l => l.status === 'upcoming' && l.imageUrl && l.saleDate && l.saleDate >= today);
    const best = (pool: AuctionLot[], preferCategory?: string) => {
      const ranked = [...pool].sort((a, b) => (b.estimateHigh || b.estimateLow || 0) - (a.estimateHigh || a.estimateLow || 0));
      if (preferCategory) {
        const preferred = ranked.find(l => l.category === preferCategory);
        if (preferred) return preferred.imageUrl;
      }
      return ranked[0]?.imageUrl || null;
    };
    const out: Record<string, string | null> = {};
    const used = new Set<string>();
    // verticals pick first so each shows its own object; 'all' takes the
    // best image nobody else claimed
    const order = [...MARKETS.filter(m => m.key !== 'all'), ...MARKETS.filter(m => m.key === 'all')];
    for (const m of order) {
      if (!m.live) { out[m.key] = null; continue; }
      const set = marketArtists(m.key);
      const pool = withImg.filter(l => set.has(l.artist) && !used.has(l.imageUrl!));
      // art wears a painting, not whatever edition happens to be priciest
      const pick = best(pool, m.key === 'art' ? 'original' : undefined);
      out[m.key] = pick;
      if (pick) used.add(pick);
    }
    return out;
  }, [lots]);

  return (
    <div className="ray-mkttiles" role="tablist" aria-label="Markets">
      {MARKETS.map(m => {
        const series = demand[m.key] || [];
        const now = m.live && series.length ? series[series.length - 1].value : null;
        const yearAgo = series.length >= 5 ? series[series.length - 5].value : null;
        const delta = now !== null && yearAgo !== null ? Math.round(now - yearAgo) : null;
        const spark = series.slice(-12).map(p => p.value);
        const min = Math.min(...spark);
        const span = Math.max(...spark) - min || 1;
        const W = 56, H = 18;
        const pts = spark.length > 1
          ? spark.map((v, i) => `${((i / (spark.length - 1)) * W).toFixed(1)},${(H - 2 - ((v - min) / span) * (H - 4)).toFixed(1)}`).join(' ')
          : '';
        const tone = delta === null ? undefined : delta >= 0 ? 'up' : 'down';
        return (
          <button
            key={m.key}
            role="tab"
            aria-selected={active === m.key}
            className="ray-mkttile"
            data-active={active === m.key}
            data-live={m.live}
            data-tone={tone}
            data-market={m.key}
            onClick={() => m.live && onPick(m.key)}
          >
            {tileArt[m.key] && (
              <img
                className="ray-mkttile-bg"
                src={tileArt[m.key]!}
                alt=""
                loading="lazy"
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                ref={(el) => { if (el && el.complete && el.naturalWidth === 0) el.style.display = 'none'; }}
              />
            )}
            <span className="ray-mkttile-scrim" aria-hidden="true" />
            <span className="ray-mkttile-top">
              <span className="ray-mkttile-ident">
                <span className="ray-mkttile-glyph"><MarketIcon market={m.key} size={17} /></span>
                <span className="ray-mkttile-name">{m.label}</span>
              </span>
            </span>
            {m.live && now !== null ? (
              <span className="ray-mkttile-figs">
                <span className="ray-mkttile-val">{formatDemand(now)}</span>
                {delta !== null && delta !== 0 && (
                  <span className="ray-mkttile-delta">{delta > 0 ? '▲' : '▼'} {Math.abs(delta)}</span>
                )}
                {pts && (
                  <svg className="ray-mkttile-spark" width={W} height={H} viewBox={`0 0 ${W} ${H}`} fill="none" aria-hidden="true">
                    <polyline points={pts} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
            ) : (
              <span className="ray-mkttile-soon">soon</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ── R3 · the index rail ────────────────────────────────────────────── */
export function IndexRail({
  demand,
  active,
  onPick,
}: {
  demand: Record<string, DemandPoint[]>;
  active: Market;
  onPick: (m: Market) => void;
}) {
  return (
    <div className="ray-idxrail" role="tablist" aria-label="Markets">
      <div className="ray-idxrail-in">
        {MARKETS.map(m => {
          const series = demand[m.key] || [];
          const now = m.live && series.length ? series[series.length - 1].value : null;
          const yearAgo = series.length >= 5 ? series[series.length - 5].value : null;
          const delta = now !== null && yearAgo !== null ? Math.round(now - yearAgo) : null;
          return (
            <button
              key={m.key}
              role="tab"
              aria-selected={active === m.key}
              className="ray-idxcell"
              data-active={active === m.key}
              data-live={m.live}
              onClick={() => m.live && onPick(m.key)}
            >
              <span className="ray-idxcell-name">{m.label}</span>
              {m.live && now !== null ? (
                <>
                  <span className="ray-idxcell-val">{Math.round(now)}</span>
                  {delta !== null && delta !== 0 && (
                    <span className="ray-idxcell-delta" data-tone={delta > 0 ? 'up' : 'down'}>
                      {delta > 0 ? '▲' : '▼'} {Math.abs(delta)}
                    </span>
                  )}
                </>
              ) : (
                <span className="ray-idxcell-soon">soon</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── R4b · today's call, as a matted catalogue plate ────────────────── */
const CONF_RANK: Record<string, number> = { 'very-high': 3, high: 2, medium: 1, low: 0 };

/** The call the product stands behind: highest-confidence tier first, never
    low — a headline pick backed by one thin comp would burn trust. */
export function pickCall(lots: AuctionLot[], allLots: AuctionLot[]) {
  const today = new Date().toISOString().split('T')[0];
  const deals = lots
    .filter(l => l.status === 'upcoming' && l.saleDate && l.saleDate >= today)
    .map(l => ({ lot: l, signal: lotSignal(l, allLots) }))
    .filter(d => d.signal && d.signal.label === 'Below Market' && CONF_RANK[d.signal.confidence || 'low'] >= 1)
    .sort((a, b) =>
      (CONF_RANK[b.signal!.confidence || 'low'] - CONF_RANK[a.signal!.confidence || 'low'])
      || (b.signal!.pct - a.signal!.pct));
  // stay within the top confidence tier when choosing for the photograph
  const topRank = deals.length ? CONF_RANK[deals[0].signal!.confidence || 'low'] : 0;
  const tier = deals.filter(d => CONF_RANK[d.signal!.confidence || 'low'] === topRank);
  return tier.slice(0, 8).find(d => d.lot.imageUrl) || tier[0] || null;
}

export function CallPlate({ lots, allLots }: { lots: AuctionLot[]; allLots: AuctionLot[] }) {
  const call = useMemo(() => pickCall(lots, allLots), [lots, allLots]);

  if (!call) return null;
  const { lot, signal } = call;
  const meter = confidenceMeter(signal!.confidence);

  return (
    <Link href="/value" className="ray-board-panel ray-deckcall" aria-label="Today's call — open the value tape">
      <div className="ray-panel-k">Today&rsquo;s call · ranked by comps gap</div>
      {lot.imageUrl && (
        <div className="ray-plate-mat">
          <div className="ray-plate-img">
            <img
              src={lot.imageUrl}
              alt=""
              loading="lazy"
              onError={(e) => { (e.currentTarget.closest('.ray-plate-mat') as HTMLElement).style.display = 'none'; }}
              ref={(el) => {
                if (el && el.complete && el.naturalWidth === 0) {
                  (el.closest('.ray-plate-mat') as HTMLElement).style.display = 'none';
                }
              }}
            />
          </div>
          <div className="ray-plate-cap">
            {lot.lotNumber ? `Lot ${lot.lotNumber} · ` : ''}{lot.auctionHouse} · {formatDate(lot.saleDate)}
          </div>
        </div>
      )}
      <div className="ray-deckcall-maker">{ARTIST_LABEL[lot.artist] || lot.artist}</div>
      <div className="ray-deckcall-title">{craftTitle(lot.title)}</div>
      <div className="ray-sigrow" data-tone="up" style={{ marginTop: 9 }}>
        <span className="ray-sigrow-pct" style={{ fontSize: 26 }}>+{signal!.pct}%</span>
        <span className="ray-sigrow-ctx">
          comps over ask · {signal!.basis} sales
          <span className="ray-sigrow-dots" title={`${meter.word} confidence`}>{meter.dots}</span>
        </span>
      </div>
      <div className="ray-deckcall-cta">Open the value tape →</div>
    </Link>
  );
}

/* ── R4b · hammering next ───────────────────────────────────────────── */
export function HammersPanel({ lots, allLots, count = 5 }: { lots: AuctionLot[]; allLots: AuctionLot[]; count?: number }) {
  const next = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    return lots
      .filter(l => l.status === 'upcoming' && l.saleDate && l.saleDate >= today && (l.estimateLow || l.estimateHigh))
      .sort((a, b) => new Date(a.saleDate).getTime() - new Date(b.saleDate).getTime())
      .slice(0, count);
  }, [lots, count]);

  if (next.length === 0) return null;
  return (
    <div className="ray-board-panel">
      <div className="ray-panel-k">Hammering next</div>
      <div className="ray-hammers">
        {next.map(l => {
          const sig = lotSignal(l, allLots);
          return (
            <a key={l.id} href={l.url} target="_blank" rel="noopener noreferrer" className="ray-hammer-row">
              <span className="ray-hammer-when">{daysWord(l.saleDate)}</span>
              <span className="ray-hammer-body">
                <span className="ray-hammer-title">{ARTIST_LABEL[l.artist] || l.artist} — {craftTitle(l.title)}</span>
                <span className="ray-hammer-meta">
                  {l.auctionHouse} · {formatPrice(l.estimateLow || l.estimateHigh || 0)} est.
                  {sig && sig.label === 'Below Market' && <b className="up"> · +{sig.pct}% comps</b>}
                </span>
              </span>
            </a>
          );
        })}
      </div>
    </div>
  );
}

/* ── R5 · the desk — maker matrix ───────────────────────────────────── */
export function DeskMatrix({ lots, market, ready }: { lots: AuctionLot[]; market: Market; ready: boolean }) {
  const rows = useMemo(() => {
    if (!ready) return [];
    const roster = ARTISTS.filter(a => marketArtists(market).has(a.slug));
    const today = new Date().toISOString().split('T')[0];
    const out: { slug: string; label: string; now: number; delta: number; spark: number[]; live: number; next: string | null }[] = [];
    for (const a of roster) {
      const mine = lots.filter(l => l.artist === a.slug);
      const series = demandSeries(mine);
      if (series.length < 6) continue;
      const now = series[series.length - 1].value;
      const yearAgo = series[series.length - 5]?.value ?? series[0].value;
      const up = mine.filter(l => l.status === 'upcoming' && l.saleDate >= today);
      const next = up.length ? up.reduce((min, l) => (l.saleDate < min ? l.saleDate : min), up[0].saleDate) : null;
      out.push({
        slug: a.slug,
        label: a.label,
        now,
        delta: now - yearAgo,
        spark: series.slice(-12).map(p => p.value),
        live: up.length,
        next,
      });
    }
    return out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 10);
  }, [lots, market, ready]);

  if (rows.length < 3) return null;
  const half = Math.ceil(rows.length / 2);
  const cols = [rows.slice(0, half), rows.slice(half)];

  return (
    <section className="rail" style={{ paddingTop: 40 }}>
      <div className="ray-desk-head">
        <span className="ray-desk-title">The desk</span>
        <span className="ray-desk-sub">demand vs a year ago · every maker live</span>
      </div>
      <div className="ray-desk-tables">
        {cols.map((col, ci) => (
          <div key={ci}>
            {col.map(m => {
              const min = Math.min(...m.spark);
              const span = Math.max(...m.spark) - min || 1;
              const W = 72, H = 20;
              const pts = m.spark.map((v, i) => `${((i / (m.spark.length - 1)) * W).toFixed(1)},${(H - 2 - ((v - min) / span) * (H - 4)).toFixed(1)}`).join(' ');
              const up = m.delta >= 0;
              return (
                <Link key={m.slug} href={`/${m.slug}`} className="ray-deskrow" data-tone={up ? 'up' : 'down'}>
                  <span className="ray-deskrow-name">{m.label}</span>
                  <svg className="ray-deskrow-spark" width={W} height={H} viewBox={`0 0 ${W} ${H}`} fill="none" aria-hidden="true">
                    <polyline points={pts} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span className="ray-deskrow-idx">{formatDemand(m.now)}</span>
                  <span className="ray-deskrow-delta">{up ? '▲' : '▼'} {Math.abs(Math.round(m.delta))}</span>
                  <span className="ray-deskrow-lots">{m.live || '—'}</span>
                  <span className="ray-deskrow-next">{m.next ? formatDate(m.next, { month: 'short', day: 'numeric' }) : '—'}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}

/* ── R6 · the film strip — the eye ──────────────────────────────────── */
export function FilmStrip({ lots, allLots }: { lots: AuctionLot[]; allLots: AuctionLot[] }) {
  const flagged = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    return lots
      .filter(l => l.status === 'upcoming' && l.saleDate && l.saleDate >= today && l.imageUrl)
      .map(l => ({ lot: l, signal: lotSignal(l, allLots) }))
      .filter(d => d.signal && d.signal.label === 'Below Market')
      .sort((a, b) => b.signal!.pct - a.signal!.pct)
      .slice(0, 12);
  }, [lots, allLots]);

  if (flagged.length < 3) return null;
  return (
    <div className="ray-filmstrip" aria-label="Flagged lots, photographed by the houses">
      {flagged.map(({ lot, signal }) => (
        <a key={lot.id} href={lot.url} target="_blank" rel="noopener noreferrer" className="ray-film">
          <img
            src={lot.imageUrl!}
            alt={craftTitle(lot.title)}
            loading="lazy"
            onError={(e) => { (e.currentTarget.closest('.ray-film') as HTMLElement).style.display = 'none'; }}
            ref={(el) => {
              if (el && el.complete && el.naturalWidth === 0) {
                (el.closest('.ray-film') as HTMLElement).style.display = 'none';
              }
            }}
          />
          <span className="ray-film-scrim">
            <span className="ray-film-l1">{ARTIST_LABEL[lot.artist] || lot.artist} · <b>+{signal!.pct}%</b></span>
            <span className="ray-film-l2">{lot.lotNumber ? `Lot ${lot.lotNumber} · ` : ''}{lot.auctionHouse}</span>
          </span>
        </a>
      ))}
    </div>
  );
}

/* ── R7 · the backtest monument ─────────────────────────────────────── */
export function Monument({ backtest }: { backtest: { flagged: { n: number; medianPerfPct: number }; unflagged: { medianPerfPct: number } } }) {
  return (
    <aside className="ray-monument">
      <div className="ray-monu-in">
      <div className="ray-panel-k">The backtest</div>
      <div className="ray-monu-fig">
        <div className="ray-monu-v up">+{backtest.flagged.medianPerfPct}%</div>
        <div className="ray-monu-k">flagged calls · median vs estimate</div>
      </div>
      <div className="ray-monu-fig">
        <div className="ray-monu-v">+{backtest.unflagged.medianPerfPct}%</div>
        <div className="ray-monu-k">unflagged</div>
      </div>
      <div className="ray-monu-fig">
        <div className="ray-monu-v">{backtest.flagged.n.toLocaleString()}</div>
        <div className="ray-monu-k">sales replayed, 2000→2026</div>
      </div>
      <p className="ray-monu-body">Every call scored against the hammer it predicted — with only the data Ray had that day.</p>
      <Link href="/value" className="ray-monu-cta">How the backtest works →</Link>
      </div>
    </aside>
  );
}

/* ── R8 · the colophon ──────────────────────────────────────────────── */
export function Colophon({ lotCount, houseCount, lastCrawl }: { lotCount: number; houseCount: number; lastCrawl?: string }) {
  return (
    <footer className="ray-colophon">
      <div className="rail ray-colophon-in">
        <span>Ray reads every estimate against every hammer. {lotCount.toLocaleString()} lots · {houseCount} houses · since 2000.</span>
        <span>Comps: same-maker, same-form, size-banded. Medians, never means.</span>
        <span>{lastCrawl ? `Data crawled ${lastCrawl}` : 'Crawled daily'}</span>
      </div>
    </footer>
  );
}
