'use client';

import { useEffect, useMemo, useState } from 'react';
import { AuctionLot } from '../types';
import { ARTIST_LABEL } from '../constants';
import { formatPrice, categoryLabels } from '../utils';
import { lotSignal } from './LotCard';
import CountUp from './CountUp';

/**
 * MarketBlock — "what the block looks like." A dynamic island (inspired by the
 * Soirée scene strip): a Week/Month toggle recomputes the whole read, a serif
 * intel line auto-rotates through several derived facts for the period, and the
 * biggest lot coming up is spotlit on the right. Every figure is live from the
 * crawl; nothing here is hardcoded.
 */
export default function MarketBlock({
  upcoming,
  allLots,
}: {
  upcoming: AuctionLot[];
  allLots: AuctionLot[];
}) {
  const [period, setPeriod] = useState<'week' | 'month'>('week');
  const [idx, setIdx] = useState(0);

  const data = useMemo(() => {
    const now = Date.now();
    const horizon = now + (period === 'week' ? 7 : 30) * 86_400_000;
    const lots = upcoming.filter((l) => {
      const d = new Date(l.saleDate).getTime();
      return !isNaN(d) && d >= now && d <= horizon;
    });
    if (!lots.length) return null;

    const totalLow = lots.reduce((s, l) => s + (l.estimateLow || 0), 0);
    const est = (l: AuctionLot) => l.estimateHigh || l.estimateLow || 0;
    const biggest = lots.reduce((b, l) => (est(l) > est(b) ? l : b), lots[0]);

    const houseCount: Record<string, number> = {};
    lots.forEach((l) => (houseCount[l.auctionHouse] = (houseCount[l.auctionHouse] || 0) + 1));
    const topHouse = Object.entries(houseCount).sort((a, b) => b[1] - a[1])[0];

    const catCount: Record<string, number> = {};
    lots.forEach((l) => (catCount[l.category] = (catCount[l.category] || 0) + 1));
    const topCat = Object.entries(catCount)
      .filter(([k]) => k !== 'unknown')
      .sort((a, b) => b[1] - a[1])[0];

    const deals = lots.filter((l) => {
      const s = lotSignal(l, allLots);
      return s && s.label === 'Below Market';
    }).length;

    const artistCount: Record<string, number> = {};
    lots.forEach((l) => (artistCount[l.artist] = (artistCount[l.artist] || 0) + 1));
    const topArtist = Object.entries(artistCount).sort((a, b) => b[1] - a[1])[0];

    return { lots, totalLow, biggest, topHouse, topCat, deals, topArtist };
  }, [upcoming, allLots, period]);

  const intel = useMemo(() => {
    if (!data) return [];
    const a = (s: React.ReactNode) => s;
    const lines: React.ReactNode[] = [
      a(<><b>{formatPrice(data.totalLow)}+</b> in low estimates goes under the hammer.</>),
      a(<>The headline lot: <em>{data.biggest.title}</em> — est. <b>{formatPrice(data.biggest.estimateHigh || data.biggest.estimateLow || 0)}</b> at {data.biggest.auctionHouse}.</>),
    ];
    if (data.topHouse) lines.push(a(<><b>{data.topHouse[0]}</b> leads the sale calendar with <b>{data.topHouse[1]}</b> {data.topHouse[1] === 1 ? 'lot' : 'lots'}.</>));
    if (data.deals > 0) lines.push(a(<><b>{data.deals}</b> {data.deals === 1 ? 'lot is' : 'lots are'} flagged below estimate against comps.</>));
    if (data.topCat) lines.push(a(<><b>{categoryLabels[data.topCat[0] as keyof typeof categoryLabels] || data.topCat[0]}</b> dominates — <b>{data.topCat[1]}</b> of {data.lots.length} lots.</>));
    return lines;
  }, [data]);

  useEffect(() => setIdx(0), [period]);
  useEffect(() => {
    if (intel.length < 2) return;
    const id = setInterval(() => setIdx((i) => (i + 1) % intel.length), 4600);
    return () => clearInterval(id);
  }, [intel.length]);

  if (!data) return null;
  const b = data.biggest;
  const bEst = b.estimateHigh || b.estimateLow || 0;

  return (
    <section className="ray-block rail" aria-label="Market intel">
      <div className="ray-block-card glass glass-quiet">
        <div className="ray-block-copy">
          <div className="ray-block-eyebrow">
            <span className="ray-block-rule" aria-hidden="true" />
            <span>On the Block</span>
            <div className="ray-block-toggle" role="tablist" aria-label="Period">
              {(['week', 'month'] as const).map((p) => (
                <button
                  key={p}
                  role="tab"
                  aria-selected={period === p}
                  className="ray-block-toggle-btn"
                  data-active={period === p}
                  onClick={() => setPeriod(p)}
                >
                  {p === 'week' ? 'This week' : 'This month'}
                </button>
              ))}
            </div>
          </div>

          <h2 className="ray-block-head">
            What the market looks like <em>this {period}</em>.
          </h2>

          <p className="ray-block-intel" key={`${period}-${idx}`}>
            {intel[idx]}
          </p>

          {intel.length > 1 && (
            <div className="ray-block-dots" aria-hidden="true">
              {intel.map((_, i) => (
                <span key={i} className="ray-block-dot" data-active={i === idx} />
              ))}
            </div>
          )}

          <div className="ray-block-stats">
            <span><b><CountUp to={data.lots.length} format={n => `${Math.round(n)}`} duration={1100} /></b>lots</span>
            <span><b><CountUp to={data.totalLow} format={formatPrice} duration={1100} /></b>on the block</span>
            <span><b><CountUp to={data.deals} format={n => `${Math.round(n)}`} duration={1100} /></b>below estimate</span>
          </div>
        </div>

        <a className="ray-block-spot" href={b.url} target="_blank" rel="noopener noreferrer">
          <div className="ray-block-spot-img">
            <span className="ray-block-spot-initial" aria-hidden="true">{b.title.charAt(0)}</span>
            {b.imageUrl && (
              <img
                src={b.imageUrl}
                alt={b.title}
                loading="lazy"
                referrerPolicy="no-referrer"
                onLoad={(e) => e.currentTarget.setAttribute('data-loaded', 'true')}
                onError={(e) => e.currentTarget.remove()}
              />
            )}
            <span className="ray-block-spot-tag">Headline lot</span>
          </div>
          <div className="ray-block-spot-meta">
            <span className="ray-block-spot-artist">{ARTIST_LABEL[b.artist] || b.artist}</span>
            <span className="ray-block-spot-title">{b.title}</span>
            <span className="ray-block-spot-est">est. {formatPrice(bEst)} · {b.auctionHouse}</span>
          </div>
        </a>
      </div>
    </section>
  );
}
