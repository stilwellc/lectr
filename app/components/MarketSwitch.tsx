'use client';

import { useEffect, useRef, useState } from 'react';
import { MARKETS, Market } from '../constants';
import { useMarket } from '../lib/market';
import { formatDemand, DemandPoint } from '../lib/demand';
import MarketIcon from './MarketIcon';
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

// Component-scoped styles for the lander's category nav. __html, not a text
// child: the attribute selectors + quotes would otherwise be SSR-escaped into
// a hydration mismatch (raw-text <style> never decodes entities).
const CATNAV_CSS = `
.ray-catnav { position: relative; display: flex; justify-content: center; }
.ray-catnav-ic { display: inline-flex; flex: none; }
.ray-catnav-btn {
  display: inline-flex; align-items: center; gap: 9px;
  font-family: var(--font-sans), sans-serif;
  font-size: 14px; font-weight: 600; letter-spacing: -0.01em;
  color: var(--color-fg);
  background: var(--color-bg-elevated);
  border: 1px solid rgba(232, 218, 182, 0.85);
  border-radius: 100px;
  padding: 10px 20px;
  cursor: pointer;
  box-shadow: var(--glow-lit), inset 0 1px 0 rgba(242, 238, 227, 0.08);
  transition: background var(--duration-fast) var(--ease-signature), transform 120ms var(--ease-signature);
}
.ray-catnav-btn:hover { background: var(--glass-bg-hover); }
.ray-catnav-btn:active { transform: scale(0.97); }
.ray-catnav-btn .ray-catnav-ic { color: var(--color-butter-deep); }
.ray-catnav-row { display: inline-flex; align-items: center; gap: 10px; flex-wrap: wrap; justify-content: center; }
.ray-catnav-chip {
  display: inline-flex; align-items: center; gap: 7px;
  font-size: 12.5px; font-weight: 600; letter-spacing: -0.01em;
  background: var(--color-butter); color: var(--color-butter-ink);
  border-radius: 100px; padding: 6px 14px;
  box-shadow: var(--glow-lit);
  white-space: nowrap;
}
.ray-catnav-ghost {
  display: inline-flex; align-items: center; gap: 4px;
  font-family: var(--font-sans), sans-serif;
  font-size: 11.5px; font-weight: 600; letter-spacing: 0.02em;
  color: var(--color-text-muted);
  background: none; border: 1px solid var(--color-border); border-radius: 100px;
  padding: 6px 13px; cursor: pointer; white-space: nowrap;
  transition: color var(--duration-fast) var(--ease-signature), border-color var(--duration-fast) var(--ease-signature);
}
.ray-catnav-ghost:hover { color: var(--color-fg); border-color: var(--color-border-mid); }
.ray-catnav-menu {
  position: absolute; top: calc(100% + 10px); left: 50%; transform: translateX(-50%);
  width: min(340px, calc(100vw - 32px));
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-mid);
  border-radius: 14px;
  padding: 6px;
  box-shadow: var(--shadow-modal, 0 18px 44px rgba(8, 6, 3, 0.55));
  z-index: 120;
  animation: rayCatnavIn 150ms var(--ease-signature, ease) both;
}
@keyframes rayCatnavIn {
  from { opacity: 0; transform: translateX(-50%) translateY(-4px); }
  to { opacity: 1; transform: translateX(-50%) translateY(0); }
}
.ray-catnav-menu-head {
  display: flex; justify-content: space-between; align-items: baseline; gap: 10px;
  padding: 8px 12px 7px;
  border-bottom: 1px solid var(--hairline);
  margin-bottom: 4px;
  font-size: 9.5px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--color-text-muted);
}
.ray-catnav-menu-head b { font-weight: 700; color: var(--color-fg); }
.ray-catnav-menu-no { color: var(--color-text-faint); font-weight: 600; }
.ray-catnav-item {
  display: flex; align-items: center; gap: 11px; width: 100%;
  background: none; border: none; border-radius: 9px;
  padding: 9px 11px; margin: 0; cursor: pointer; text-align: left;
  font-family: var(--font-sans), sans-serif;
}
.ray-catnav-item:hover { background: var(--color-hover-item); }
.ray-catnav-item:focus-visible { background: var(--color-hover-item); outline: none; box-shadow: inset 0 0 0 1px var(--color-border-mid); }
.ray-catnav-item[data-active="true"] { background: var(--color-butter-subtle); }
.ray-catnav-item .ray-catnav-ic { color: var(--color-text-muted); }
.ray-catnav-item[data-active="true"] .ray-catnav-ic { color: var(--color-butter-deep); }
.ray-catnav-item-txt { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.ray-catnav-item-label { font-size: 13.5px; font-weight: 600; letter-spacing: -0.01em; color: var(--color-fg); }
.ray-catnav-item-tag { font-size: 11px; color: var(--color-text-faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ray-catnav-item-now { margin-left: auto; flex: none; font-size: 9px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-butter-text); }
.ray-catnav-scrim { display: none; }
@media (max-width: 680px) {
  .ray-catnav-scrim { display: block; position: fixed; inset: 0; background: rgba(8, 7, 4, 0.55); z-index: 119; }
  .ray-catnav-menu {
    position: fixed; top: auto; left: 0; right: 0; bottom: 0; transform: none;
    width: auto; max-height: 72vh; overflow-y: auto;
    border-radius: 18px 18px 0 0; border-bottom: none;
    padding: 8px 10px calc(14px + env(safe-area-inset-bottom, 0px));
    animation: rayCatnavUp 200ms var(--ease-signature, ease) both;
  }
  @keyframes rayCatnavUp {
    from { opacity: 0; transform: translateY(24px); }
    to { opacity: 1; transform: none; }
  }
}
@media (prefers-reduced-motion: reduce) {
  .ray-catnav-menu { animation: none; }
}
`;

// The lander's category nav — dropdown when no category is chosen, chip +
// "Change category" ghost once one is. One overlay, keyboard-complete:
// arrows walk the menu, Escape closes back to the trigger, Tab leaves.
function LanderNav() {
  const { market, setMarket } = useMarket();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const activeMeta = MARKETS.find(m => m.key === market)!;

  // opening parks focus on the current market's row
  useEffect(() => {
    if (!open) return;
    const idx = Math.max(0, MARKETS.findIndex(m => m.key === market));
    itemRefs.current[idx]?.focus();
  }, [open, market]);

  // click-away closes (the mobile scrim covers the same job by being clickable)
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  const pick = (key: Market) => {
    // the same navigation path the pills used — setMarket pushStates the URL
    // under the mounted board, so the tape prints in place (no remount)
    setMarket(key);
    close();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'Tab') { setOpen(false); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      const n = MARKETS.length;
      const idx = itemRefs.current.findIndex(el => el === document.activeElement);
      const next =
        e.key === 'Home' ? 0 :
        e.key === 'End' ? n - 1 :
        e.key === 'ArrowDown' ? (idx + 1 + n) % n : (idx - 1 + n) % n;
      itemRefs.current[next]?.focus();
    }
  };

  const onTriggerKey = (e: React.KeyboardEvent) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      setOpen(true);
    }
  };

  const flickStyle: React.CSSProperties = {
    transform: open ? 'none' : 'scaleY(-1)',
    transition: 'transform 140ms ease',
  };

  return (
    <div className="ray-catnav" ref={wrapRef} onKeyDown={onKey}>
      <style dangerouslySetInnerHTML={{ __html: CATNAV_CSS }} />
      {market === 'all' ? (
        /* no category chosen — the dropdown IS the control, and it wears the
           view's one lit treatment */
        <button
          ref={triggerRef}
          type="button"
          className="ray-catnav-btn"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen(o => !o)}
          onKeyDown={onTriggerKey}
        >
          <span className="ray-catnav-ic" aria-hidden="true"><MarketIcon market="all" size={16} /></span>
          Choose a category
          <Flick size={12} style={flickStyle} />
        </button>
      ) : (
        /* category chosen — a lit chip states it; the quiet ghost reopens the
           menu. The filters below take the visual lead. */
        <div className="ray-catnav-row">
          <span className="ray-catnav-chip" aria-label={`Category: ${activeMeta.label}`}>
            <span className="ray-catnav-ic" aria-hidden="true"><MarketIcon market={market} size={15} /></span>
            {activeMeta.label}
          </span>
          <button
            ref={triggerRef}
            type="button"
            className="ray-catnav-ghost"
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => setOpen(o => !o)}
            onKeyDown={onTriggerKey}
          >
            Change category <Flick size={11} style={flickStyle} />
          </button>
        </div>
      )}
      {open && <div className="ray-catnav-scrim" onClick={() => close(false)} aria-hidden="true" />}
      {open && (
        <div className="ray-catnav-menu" role="menu" aria-label="Categories">
          <div className="ray-catnav-menu-head">
            <span>The markets</span>
            <span className="ray-catnav-menu-no">pick one</span>
          </div>
          {MARKETS.map((m, i) => (
            <button
              key={m.key}
              ref={el => { itemRefs.current[i] = el; }}
              type="button"
              role="menuitemradio"
              aria-checked={market === m.key}
              className="ray-catnav-item"
              data-active={market === m.key}
              onClick={() => pick(m.key)}
            >
              <span className="ray-catnav-ic" aria-hidden="true"><MarketIcon market={m.key} size={16} /></span>
              <span className="ray-catnav-item-txt">
                <span className="ray-catnav-item-label">{m.key === 'all' ? 'All markets' : m.label}</span>
                <span className="ray-catnav-item-tag">{m.tagline}</span>
              </span>
              {market === m.key && <span className="ray-catnav-item-now">current</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Each market's object, Airbnb-style: dimensional, instantly readable at
// pill size. Apple's emoji renders ARE the reference aesthetic — crisper at
// 18px than any photo cutout, zero asset pipeline. The pills themselves stay
// uniform; the objects carry the color.
export default function MarketSwitch({
  compact = false,
  lit = false,
  lander = false,
  demand,
}: {
  compact?: boolean;
  /** the active pill wears the view's single lit treatment — ONLY pass true
      where the switch is that view's lit element. /value's lit element
      is the call plate; two lit per view violates the marquee rule. */
  lit?: boolean;
  /** home's variant: category dropdown / chip + "Change category" — the
      lit control replaces the six-pill row. Inner pages keep `compact`. */
  lander?: boolean;
  demand?: Record<string, DemandPoint[]>;
}) {
  const { market, setMarket } = useMarket();

  if (lander) return <LanderNav />;

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
