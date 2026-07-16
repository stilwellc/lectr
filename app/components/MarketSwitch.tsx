'use client';

import { MARKETS } from '../constants';
import { useMarket } from '../lib/market';
import { formatDemand, DemandPoint } from '../lib/demand';
import MarketIcon from './MarketIcon';

/**
 * MarketSwitch — the verticals as the lander's focal shelf. Each market is a
 * card: its glyph, its name, and for live markets its own demand reading with
 * a micro-sparkline (the same TTM series the hero draws). Coming markets show
 * their tagline under a muted "soon" chip. The compact variant is THE one
 * market switcher product-wide — a pill row with glyphs; on home its active
 * pill carries the lit treatment (the view's single lit element). The choice
 * persists across every page.
 */

function Spark({ series }: { series: DemandPoint[] }) {
  const pts = series.slice(-14);
  if (pts.length < 2) return null;
  const vals = pts.map(p => p.value);
  const min = Math.min(...vals);
  const span = Math.max(...vals) - min || 1;
  const W = 58;
  const H = 20;
  const d = pts
    .map((p, i) => `${((i / (pts.length - 1)) * W).toFixed(1)},${(H - 2 - ((p.value - min) / span) * (H - 4)).toFixed(1)}`)
    .join(' ');
  return (
    <svg className="ray-mkt-spark" width={W} height={H} viewBox={`0 0 ${W} ${H}`} fill="none" aria-hidden="true">
      <polyline points={d} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Each market's object, Airbnb-style: dimensional, instantly readable at
// pill size. Apple's emoji renders ARE the reference aesthetic — crisper at
// 18px than any photo cutout, zero asset pipeline. The pills themselves stay
// uniform; the objects carry the color.
export default function MarketSwitch({
  compact = false,
  lit = false,
  demand,
}: {
  compact?: boolean;
  /** the active pill wears the view's single lit treatment — ONLY pass true
      where the switch is that view's lit element (home). /value's lit element
      is the call plate; two lit per view violates the marquee rule. */
  lit?: boolean;
  demand?: Record<string, DemandPoint[]>;
}) {
  const { market, setMarket } = useMarket();

  if (compact) {
    return (
      <div className="ray-markets ray-markets-compact" role="tablist" aria-label="Markets">
        {MARKETS.map(m => (
          <button
            key={m.key}
            role="tab"
            aria-selected={market === m.key}
            className={`ray-market-tab${market === m.key && lit ? ' lit' : ''}`}
            data-market={m.key}
            data-active={market === m.key}
            data-live={m.live}
            onClick={() => setMarket(m.key)}
          >
            <span className="ray-pill-obj" aria-hidden="true"><MarketIcon market={m.key} size={15} /></span>
            {m.label}
            {!m.live && <span className="ray-market-soon">soon</span>}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="ray-mkt-cards" role="tablist" aria-label="Markets">
      {MARKETS.map(m => {
        const series = demand?.[m.key] || [];
        const now = m.live && series.length ? series[series.length - 1].value : null;
        const tone = now == null ? undefined : now >= 0 ? 'up' : 'down';
        return (
          <button
            key={m.key}
            role="tab"
            aria-selected={market === m.key}
            className="ray-mkt-card"
            data-active={market === m.key}
            data-live={m.live}
            data-tone={tone}
            onClick={() => setMarket(m.key)}
          >
            <div className="ray-mkt-card-top">
              <span className="ray-mkt-ic"><MarketIcon market={m.key} /></span>
              {now != null ? <Spark series={series} /> : !m.live && <span className="ray-market-soon">soon</span>}
            </div>
            <div className="ray-mkt-card-label">{m.label}</div>
            {now != null ? (
              <div className="ray-mkt-card-stat">
                {formatDemand(now)} <span>demand</span>
              </div>
            ) : (
              <div className="ray-mkt-card-tag">{m.tagline}</div>
            )}
          </button>
        );
      })}
    </div>
  );
}
