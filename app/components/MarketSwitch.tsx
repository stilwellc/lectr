'use client';

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { MARKETS, type Market } from '../constants';
import { useMarket } from '../lib/market';
import MarketIcon from './MarketIcon';

/**
 * MarketSwitch — THE EXCHANGE RAIL (Aug 2026 redesign; "the door to the app").
 *
 * Not a row of floating pills: one hairline-framed band, eight markets as
 * fused CELLS on shared hairlines — the index rail of a trading floor. Every
 * cell carries ONE standardized micro-read — the live-lot count (Collin,
 * Aug 22 2026: no % in the rail; one grammar, eight cells) — so the floor
 * hums before you choose. The active cell is the room's one lamp: a 2px
 * butter filament on its top edge, the --glow-lit halo when this switch is
 * the view's lit element.
 *
 * Total market is the ANCHOR — first cell, wider, sealed off by a double-
 * hairline spine: everything left of the spine is the index, everything right
 * its components. Its read is the total live count.
 *
 * ≤899px this is NOT a squeezed rail — it becomes THE KEYPAD: a 2×4 board of
 * keys (short labels) over THE FLAP LINE, a split-flap readout printing the
 * active market's read. Pick a key, the line flips.
 *
 * `compact` (inner pages) is the same chassis with the data stripped: one
 * 40px row, no reads, no flap, filament-only active (each inner view's lit
 * element is its own — the marquee rule).
 */

function fmtCount(n: number): string {
  return n.toLocaleString('en-US');
}

export default function MarketSwitch({
  compact = false,
  lit = false,
  open = false,
  reads,
}: {
  /** inner-page variant: the rail dimmed to navigation duty — no reads, no
   *  flap, no halo. Home omits it and gets the full door. */
  compact?: boolean;
  /** the active cell wears the view's single lit treatment — ONLY pass true
   *  where the switch is that view's lit element (home). */
  lit?: boolean;
  /** arms the once-per-session "board energizes" entrance (motion-gated). */
  open?: boolean;
  /** per-market live-lot counts (door only) — the one standardized read.
   *  Missing key → the cell simply prints no read. */
  reads?: Partial<Record<Market, number>>;
}) {
  const { market, setMarket } = useMarket();
  const railRef = useRef<HTMLDivElement>(null);

  // The energize beat is a pure enhancement over the already-correct resting
  // rail. Armed once per session (same key the pill ripple used), motion
  // allowed, first non-cached paint only. The filament + halo are CSS on
  // [data-active] from first paint — a skipped beat still shows one lamp.
  const [energize, setEnergize] = useState(false);
  useEffect(() => {
    if (!open) return;
    try {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      if (sessionStorage.getItem('lectr-marketopen')) return;
      sessionStorage.setItem('lectr-marketopen', '1');
    } catch {
      return;
    }
    setEnergize(true);
    const t = setTimeout(() => setEnergize(false), 1900);
    return () => clearTimeout(t);
    // decided once at mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Roving tabindex — a tablist owes arrow keys. Arrows move focus (manual
  // activation: Enter/Space press the button natively).
  const onKeys = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const delta =
      e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 :
      e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const cells = railRef.current?.querySelectorAll<HTMLButtonElement>('.ray-rail-cell');
    if (!cells?.length) return;
    cells[(i + delta + cells.length) % cells.length].focus();
  };

  const door = !compact;
  const active = MARKETS.find(m => m.key === market) ?? MARKETS[0];

  /** the cell's micro-read — one grammar for all eight: "N live" */
  const readOf = (key: Market): string | null => {
    if (!door) return null;
    const n = reads?.[key];
    return n != null ? `${fmtCount(n)} live` : null;
  };

  // THE FLAP LINE (mobile door) — the split-flap destination row for the
  // active market. Uppercase mono tokens, one quiet register.
  const flap = (() => {
    if (!door) return null;
    const tokens: string[] = [active.label.toUpperCase()];
    const n = reads?.[active.key];
    if (n != null) tokens.push(`${fmtCount(n)} LIVE ${n === 1 ? 'LOT' : 'LOTS'}`);
    return tokens;
  })();

  return (
    <div
      ref={railRef}
      className={`ray-rail${energize ? ' is-open' : ''}`}
      data-variant={door ? 'door' : 'compact'}
      data-lit={door && lit ? 'true' : undefined}
      role="tablist"
      aria-label="Markets"
    >
      {MARKETS.map((m, i) => {
        const readText = readOf(m.key);
        const isActive = market === m.key;
        return (
          <button
            key={m.key}
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            className={`ray-rail-cell${m.key === 'all' ? ' ray-rail-anchor' : ''}`}
            data-market={m.key}
            data-active={isActive}
            style={{ '--cell-i': i } as CSSProperties}
            aria-label={readText ? `${m.label} — ${readText}` : m.label}
            onClick={() => setMarket(m.key)}
            onKeyDown={e => onKeys(e, i)}
          >
            <span className="ray-rail-top" aria-hidden="true">
              <MarketIcon market={m.key} size={14} />
              <span className="ray-rail-name">
                <span className="ray-rail-name-full">{m.label}</span>
                <span className="ray-rail-name-short">{m.short}</span>
              </span>
            </span>
            {readText && (
              <span className="ray-rail-read" aria-hidden="true">
                {readText}
              </span>
            )}
          </button>
        );
      })}
      {flap && (
        <div className="ray-rail-flap" aria-live="polite">
          {flap.map((tok, i) => (
            <span key={i}>
              {i > 0 && <span className="ray-rail-flap-dot" aria-hidden="true">·</span>}
              {tok}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
