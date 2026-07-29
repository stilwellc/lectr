'use client';

import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { MARKETS } from '../constants';
import { useMarket } from '../lib/market';
import { formatDemand, DemandPoint } from '../lib/demand';
import MarketIcon from './MarketIcon';
import TerminalEmblem from '../preview/terminal/emblems';
import { GhostGlyph } from '../preview/terminal/VerticalGhost';
import Flick from './Flick';

/**
 * MarketSwitch — the verticals as the lander's focal shelf. Each market is a
 * card: its glyph, its name, and for live markets its own demand reading with
 * a micro-sparkline (the same TTM series the hero draws). Coming markets show
 * their tagline under a muted "soon" chip. The compact variant is THE one
 * market switcher on the INNER pages — a pill row with glyphs. The choice
 * persists across every page.
 *
 * The `lander` variant replaces home's six-pill row with a category dropdown:
 * on the total market a single lit "Choose a category" control opens a compact
 * certificate-styled menu of the verticals; with a category chosen the row
 * collapses to a butter-lit chip + a quiet "Change category" ghost, ceding the
 * visual lead to the feed toolbar's filters. Picking an option calls the same
 * setMarket the pills used — the pushState tape-print switch is untouched.
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

export default function MarketSwitch({
  compact = false,
  lit = false,
  demand,
  open = false,
  emblems = false,
}: {
  compact?: boolean;
  /** the active pill wears the view's single lit treatment — ONLY pass true
      where the switch is that view's lit element. /value's lit element
      is the call plate; two lit per view violates the marquee rule. */
  lit?: boolean;
  /** home's variant: category dropdown / chip + "Change category" — the
      lit control replaces the six-pill row. Inner pages keep `compact`. */
  demand?: Record<string, DemandPoint[]>;
  /** MARKET OPEN — on the entrance's first non-cached paint the pills ripple-
      ignite in sequence, then settle dim except the active .lit pill (one sign
      lit). Session-gated (lectr-marketopen) so it never wears thin on revisits;
      reduced-motion / cached readers get the settled row at once. */
  open?: boolean;
  /** TERMINAL-ONLY: swap the plain MarketIcon glyph for the richer
      TerminalEmblem line-illustrations (a framed painting, a chair, a
      wristwatch…). Opt-in so /home and the other inner pages keep the
      original glyph — only the Terminal passes this. */
  emblems?: boolean;
}) {
  const { market, setMarket } = useMarket();

  // The ripple is a pure enhancement layered over the already-correct row.
  // Armed once, after mount, only when: open, motion allowed, and this session
  // hasn't seen it. Never blocks the lit pill — that treatment is CSS on
  // [data-active], present from the first paint regardless.
  const [ripple, setRipple] = useState(false);
  useEffect(() => {
    if (!open || !compact) return;
    try {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      if (sessionStorage.getItem('lectr-marketopen')) return;
      sessionStorage.setItem('lectr-marketopen', '1');
    } catch { return; }
    setRipple(true);
    // drop the class once the whole ripple has finished (T900 + up to 5×60ms
    // stagger + 420ms ignite ≈ 1620ms) so a later re-render can't restart it.
    // The keyframe rests at brightness(1) === the un-animated state, so this
    // removal is invisible.
    const t = setTimeout(() => setRipple(false), 1750);
    return () => clearTimeout(t);
    // decided once at mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (compact) {
    return (
      <div className={`ray-markets ray-markets-compact${ripple ? ' ray-mkt-open' : ''}`} role="tablist" aria-label="Markets">
        {MARKETS.map((m, i) => (
          <button
            key={m.key}
            role="tab"
            aria-selected={market === m.key}
            className={`ray-market-tab${market === m.key && lit ? ' lit' : ''}`}
            data-market={m.key}
            data-active={market === m.key}
            data-live={m.live}
            style={ripple ? ({ '--ripple-i': i } as CSSProperties) : undefined}
            onClick={() => setMarket(m.key)}
          >
            {emblems && m.key !== 'all' && (
              <span className="ray-pill-ghost" aria-hidden="true"><GhostGlyph market={m.key} /></span>
            )}
            <span className={`ray-pill-obj${emblems ? ' ray-pill-emblem' : ''}`} aria-hidden="true">
              {emblems ? <TerminalEmblem market={m.key} size={15} /> : <MarketIcon market={m.key} size={15} />}
            </span>
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
