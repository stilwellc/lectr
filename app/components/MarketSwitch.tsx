'use client';

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { MARKETS, type Market } from '../constants';
import { useMarket } from '../lib/market';
import { formatDemand } from '../lib/demand';
import MarketIcon from './MarketIcon';

/**
 * MarketSwitch — THE EXCHANGE RAIL (Aug 2026 redesign; "the door to the app").
 *
 * Not a row of floating pills: one hairline-framed band, eight markets as
 * fused CELLS on shared hairlines — the index rail of a trading floor. Every
 * cell carries a live micro-read (a real demand % where one exists, an honest
 * live-lot count where it doesn't), so the floor hums before you choose. The
 * active cell is the room's one lamp: a 2px butter filament on its top edge,
 * the --glow-lit halo when this switch is the view's lit element.
 *
 * Total market is the ANCHOR — first cell, wider, sealed off by a double-
 * hairline spine: everything left of the spine is the index, everything right
 * its components. It carries the index last-move plus the total live count.
 *
 * ≤899px this is NOT a squeezed rail — it becomes THE KEYPAD: a 2×4 board of
 * keys (short labels) over THE FLAP LINE, a split-flap readout printing the
 * active market's read. Pick a key, the line flips.
 *
 * `compact` (inner pages) is the same chassis with the data stripped: one
 * 40px row, no reads, no flap, filament-only active (each inner view's lit
 * element is its own — the marquee rule).
 */

export interface RailRead {
  /** last value of a REAL demand-%-vs-estimate series — art/design/watches
   *  only; never fabricated for realized/bid-basis markets */
  demandPct?: number | null;
  /** live lots on the block — the universal honest read */
  liveCount?: number | null;
}

const READ_MARKETS = new Set<Market>(['art', 'design', 'watches']);

function fmtCount(n: number): string {
  return n.toLocaleString('en-US');
}

export default function MarketSwitch({
  compact = false,
  lit = false,
  open = false,
  reads,
  indexMove,
}: {
  /** inner-page variant: the rail dimmed to navigation duty — no reads, no
   *  flap, no halo. Home omits it and gets the full door. */
  compact?: boolean;
  /** the active cell wears the view's single lit treatment — ONLY pass true
   *  where the switch is that view's lit element (home). */
  lit?: boolean;
  /** arms the once-per-session "board energizes" entrance (motion-gated). */
  open?: boolean;
  /** per-market micro-reads (door only) — demand % where real, live counts
   *  everywhere. Missing key → the cell simply prints no read. */
  reads?: Partial<Record<Market, RailRead>>;
  /** the aggregate index's last move, % (market.json) — the anchor's read. */
  indexMove?: number | null;
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

  /** the cell's micro-read: [text, tone] — or null (no data, print nothing) */
  const readOf = (key: Market): { text: string; tone?: 'up' | 'down' } | null => {
    if (!door) return null;
    if (key === 'all') {
      const parts: string[] = [];
      if (indexMove != null) parts.push(formatDemand(indexMove));
      const total = reads?.all?.liveCount;
      if (total != null) parts.push(`${fmtCount(total)} live`);
      if (!parts.length) return null;
      return { text: parts.join('  '), tone: indexMove != null ? (indexMove >= 0 ? 'up' : 'down') : undefined };
    }
    const r = reads?.[key];
    if (READ_MARKETS.has(key) && r?.demandPct != null) {
      return { text: formatDemand(r.demandPct), tone: r.demandPct >= 0 ? 'up' : 'down' };
    }
    if (r?.liveCount != null) return { text: `${fmtCount(r.liveCount)} live` };
    return null;
  };

  // THE FLAP LINE (mobile door) — the split-flap destination row for the
  // active market. Uppercase mono tokens; % toned, everything else quiet.
  const flap = (() => {
    if (!door) return null;
    const tokens: { t: string; tone?: 'up' | 'down' | 'name' }[] = [
      { t: active.label.toUpperCase(), tone: 'name' },
    ];
    if (active.key === 'all') {
      if (indexMove != null) tokens.push({ t: `INDEX ${formatDemand(indexMove)}`, tone: indexMove >= 0 ? 'up' : 'down' });
      const total = reads?.all?.liveCount;
      if (total != null) tokens.push({ t: `${fmtCount(total)} LIVE` });
    } else {
      const r = reads?.[active.key];
      if (READ_MARKETS.has(active.key) && r?.demandPct != null) {
        tokens.push({ t: `DEMAND ${formatDemand(r.demandPct)}`, tone: r.demandPct >= 0 ? 'up' : 'down' });
      }
      if (r?.liveCount != null) tokens.push({ t: `${fmtCount(r.liveCount)} LIVE` });
    }
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
        const read = readOf(m.key);
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
            aria-label={read ? `${m.label} — ${read.text}` : m.label}
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
            {read && (
              <span className="ray-rail-read" data-tone={read.tone} aria-hidden="true">
                {read.text}
              </span>
            )}
          </button>
        );
      })}
      {flap && (
        <div className="ray-rail-flap" aria-live="polite">
          {flap.map((tok, i) => (
            <span key={i} data-tone={tok.tone}>
              {i > 0 && <span className="ray-rail-flap-dot" aria-hidden="true">·</span>}
              {tok.t}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
