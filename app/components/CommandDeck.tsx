'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { AuctionLot } from '../types';
import { ARTIST_LABEL, ARTISTS, marketArtists, Market } from '../constants';
import { craftTitle, formatPrice } from '../utils';
import { demandSeries, formatDemand } from '../lib/demand';
import { lotSignal, confidenceMeter } from './LotCard';

/**
 * The command deck — the lander's right rail. The demand hero owns the left;
 * these modules make the first screen read like an instrument someone trades
 * from: the strongest call on the block (with its photograph), and the lots
 * hammering next, counted down. Below the deck, the movers row gives every
 * maker a pulse.
 */

function daysWord(dateStr: string): string {
  const days = Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

export function TodaysCallCard({ lots, allLots }: { lots: AuctionLot[]; allLots: AuctionLot[] }) {
  const call = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    const deals = lots
      .filter(l => l.status === 'upcoming' && l.saleDate && l.saleDate >= today)
      .map(l => ({ lot: l, signal: lotSignal(l, allLots) }))
      .filter(d => d.signal && d.signal.label === 'Below Market')
      .sort((a, b) => b.signal!.pct - a.signal!.pct);
    return deals.slice(0, 5).find(d => d.lot.imageUrl) || deals[0] || null;
  }, [lots, allLots]);

  if (!call) return null;
  const { lot, signal } = call;
  const meter = confidenceMeter(signal!.confidence);

  return (
    <Link href="/value" className="ray-deckcard ray-deckcall" aria-label="Today's call — see all below-market lots">
      <div className="ray-deckcard-k">Today&rsquo;s call</div>
      {lot.imageUrl && (
        <div className="ray-deckcall-img">
          <img
            src={lot.imageUrl}
            alt=""
            loading="lazy"
            onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = 'none'; }}
            ref={(el) => {
              if (el && el.complete && el.naturalWidth === 0) {
                (el.parentElement as HTMLElement).style.display = 'none';
              }
            }}
          />
        </div>
      )}
      <div className="ray-deckcall-maker">{ARTIST_LABEL[lot.artist] || lot.artist}</div>
      <div className="ray-deckcall-title">{craftTitle(lot.title)}</div>
      <div className="ray-sigrow" data-tone="up" style={{ marginTop: 8 }}>
        <span className="ray-sigrow-pct">+{signal!.pct}%</span>
        <span className="ray-sigrow-ctx">
          comps over ask · {signal!.basis} sales
          <span className="ray-sigrow-dots" title={`${meter.word} confidence`}>{meter.dots}</span>
        </span>
      </div>
      <div className="ray-deckcall-cta">the full value tape →</div>
    </Link>
  );
}

export function NextHammers({ lots, allLots }: { lots: AuctionLot[]; allLots: AuctionLot[] }) {
  const next = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    return lots
      .filter(l => l.status === 'upcoming' && l.saleDate && l.saleDate >= today && (l.estimateLow || l.estimateHigh))
      .sort((a, b) => new Date(a.saleDate).getTime() - new Date(b.saleDate).getTime())
      .slice(0, 4);
  }, [lots]);

  if (next.length === 0) return null;
  return (
    <div className="ray-deckcard">
      <div className="ray-deckcard-k">Hammering next</div>
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

export function MarketMovers({ lots, market, ready }: { lots: AuctionLot[]; market: Market; ready: boolean }) {
  const movers = useMemo(() => {
    if (!ready) return [];
    const roster = ARTISTS.filter(a => marketArtists(market).has(a.slug));
    const out: { slug: string; label: string; now: number; delta: number; spark: number[] }[] = [];
    for (const a of roster) {
      const mine = lots.filter(l => l.artist === a.slug);
      const series = demandSeries(mine);
      if (series.length < 6) continue;
      const now = series[series.length - 1].value;
      const yearAgo = series[series.length - 5]?.value ?? series[0].value;
      out.push({
        slug: a.slug,
        label: a.label,
        now,
        delta: now - yearAgo,
        spark: series.slice(-12).map(p => p.value),
      });
    }
    return out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 10);
  }, [lots, market, ready]);

  if (movers.length < 3) return null;
  return (
    <section className="rail" style={{ paddingTop: 30 }}>
      <div className="ray-movers-head">
        <h2 className="ray-h2">The movers</h2>
        <span className="ray-movers-sub">demand vs a year ago, by maker</span>
      </div>
      <div className="ray-movers">
        {movers.map(m => {
          const min = Math.min(...m.spark);
          const span = Math.max(...m.spark) - min || 1;
          const W = 72, H = 24;
          const pts = m.spark.map((v, i) => `${((i / (m.spark.length - 1)) * W).toFixed(1)},${(H - 2 - ((v - min) / span) * (H - 4)).toFixed(1)}`).join(' ');
          const up = m.delta >= 0;
          return (
            <Link key={m.slug} href={`/${m.slug}`} className="ray-mover" data-tone={up ? 'up' : 'down'}>
              <div className="ray-mover-name">{m.label}</div>
              <svg className="ray-mover-spark" width={W} height={H} viewBox={`0 0 ${W} ${H}`} fill="none" aria-hidden="true">
                <polyline points={pts} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <div className="ray-mover-figures">
                <span className="ray-mover-now">{formatDemand(m.now)}</span>
                <span className="ray-mover-delta">{up ? '▲' : '▼'} {Math.abs(Math.round(m.delta))} pts</span>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
