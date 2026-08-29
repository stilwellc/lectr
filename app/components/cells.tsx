'use client';

/**
 * THE CELLS — taken directly from the middle of elevenlabs.io (Collin: "I love
 * the way they use cells (take that directly)"). Four instruments:
 *
 *  <Cell>       the quiet well: cream plate, icon chip top-left, a tall
 *               breath of air, then GRAY label over INK body (inverted
 *               hierarchy — the category whispers, the content speaks).
 *  <ColorCell>  the one cell in a grid that forces color (their "Omnichannel
 *               agents" move): a full-bleed grained gradient with white text.
 *               On lectr color = the market, so its hue is LAWFUL BY
 *               CONSTRUCTION: dir="up" green / dir="down" red (the lamp),
 *               dir="ink" for neutral drama.
 *  <FigureCell> the "Safety, built in" move: a hand-drawn patent-figure
 *               line drawing (solid + dotted 1px construction lines) on a
 *               cream well, label + body beneath.
 *  <StatRow>    their dashboard-chart header: stat tabs (small gray label
 *               over tabular value), the active one underlined in ink.
 *
 * All colors ride tokens; dark mode inherits automatically. CSS lives in
 * globals.css under "THE CELL SYSTEM". Figures draw in currentColor.
 */

import React from 'react';

/* the grain tile lives as --ns-grain in globals.css (single source) */

export function CellGrid({ children, min = 240, className = '' }: {
  children: React.ReactNode;
  /** min cell width before the grid wraps */
  min?: number;
  className?: string;
}) {
  return (
    <div className={`ns-cellgrid ${className}`} style={{ ['--cell-min' as string]: `${min}px` }}>
      {children}
    </div>
  );
}

export function Cell({ icon, label, body, span, href }: {
  icon?: React.ReactNode;
  label: string;
  body: React.ReactNode;
  /** grid-column span (e.g. 2 for a wide cell) */
  span?: number;
  href?: string;
}) {
  const inner = (
    <>
      {icon != null && <span className="ns-cell-chip" aria-hidden>{icon}</span>}
      <span className="ns-cell-air" aria-hidden />
      <span className="ns-cell-label">{label}</span>
      <span className="ns-cell-body">{body}</span>
    </>
  );
  const style = span ? { gridColumn: `span ${span}` } : undefined;
  return href
    ? <a className="ns-cell" href={href} style={style}>{inner}</a>
    : <div className="ns-cell" style={style}>{inner}</div>;
}

/** The forced-color cell. dir maps to the lamp: up=green, down=red, ink=neutral. */
export function ColorCell({ dir = 'ink', label, body, stat, span, href }: {
  dir?: 'up' | 'down' | 'ink';
  label: string;
  body: React.ReactNode;
  /** optional big numeral printed above the label (e.g. the call's ×) */
  stat?: React.ReactNode;
  span?: number;
  href?: string;
}) {
  const inner = (
    <>
      <span className="ns-cell-air" aria-hidden />
      {stat != null && <span className="ns-ccell-stat">{stat}</span>}
      <span className="ns-cell-label">{label}</span>
      <span className="ns-cell-body">{body}</span>
    </>
  );
  const style = span ? { gridColumn: `span ${span}` } : undefined;
  return href
    ? <a className="ns-cell ns-cell-color" data-dir={dir} href={href} style={style}>{inner}</a>
    : <div className="ns-cell ns-cell-color" data-dir={dir} style={style}>{inner}</div>;
}

export function FigureCell({ figure, label, body, span }: {
  figure: React.ReactNode;
  label: string;
  body: React.ReactNode;
  span?: number;
}) {
  return (
    <div className="ns-cell ns-cell-figure" style={span ? { gridColumn: `span ${span}` } : undefined}>
      <span className="ns-fig-stage" aria-hidden>{figure}</span>
      <span className="ns-cell-label">{label}</span>
      <span className="ns-cell-body">{body}</span>
    </div>
  );
}

/** Chart-header stat tabs. Pass active index; onSelect makes them buttons. */
export function StatRow({ stats, active, onSelect }: {
  stats: { label: string; value: React.ReactNode }[];
  active?: number;
  onSelect?: (i: number) => void;
}) {
  return (
    <div className="ns-statrow" role={onSelect ? 'tablist' : undefined}>
      {stats.map((s, i) => {
        const cls = `ns-stat${i === active ? ' is-active' : ''}`;
        const inner = (
          <>
            <span className="ns-stat-k">{s.label}</span>
            <span className="ns-stat-v">{s.value}</span>
          </>
        );
        return onSelect ? (
          <button key={s.label} type="button" role="tab" aria-selected={i === active} className={cls} onClick={() => onSelect(i)}>
            {inner}
          </button>
        ) : (
          <span key={s.label} className={cls}>{inner}</span>
        );
      })}
    </div>
  );
}

/** The white annotation chip that sits on a chart (their "Aug 29 · 7.11k"). */
export function AnnoChip({ k, v, dir }: { k: string; v: React.ReactNode; dir?: 'up' | 'down' }) {
  return (
    <span className="ns-anno">
      <span className="ns-anno-k">{k}</span>
      <span className="ns-anno-v">
        {dir && <i className="ns-anno-dot" data-dir={dir} aria-hidden />}
        {v}
      </span>
    </span>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   THE FIGURES — patent-drawing line art, 1px solid ink + dotted
   construction lines, drawn for lectr's own concepts. All currentColor;
   default size 132; strokes non-scaling.
   ══════════════════════════════════════════════════════════════════════ */

const S = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1,
  vectorEffect: 'non-scaling-stroke' as const,
};
const DOT = { ...S, strokeDasharray: '1.5 3.5' };

/** The replay — a hammer curve rising past its estimate; dotted baseline,
    hollow start, filled close (their Good→Great grammar, our story). */
export function FigReplay({ size = 132 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 132 132" aria-hidden>
      <line x1="10" y1="96" x2="122" y2="96" {...DOT} />
      <line x1="10" y1="40" x2="122" y2="40" {...DOT} />
      <path d="M14 96 C 44 92, 62 78, 78 58 S 106 30, 118 26" {...S} />
      <circle cx="34" cy="89" r="3.2" {...S} />
      <circle cx="98" cy="38" r="3.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** The comp pool — nested circles, one lot ringed (their nested-moons). */
export function FigPools({ size = 132 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 132 132" aria-hidden>
      <circle cx="66" cy="66" r="52" {...DOT} />
      <circle cx="62" cy="68" r="38" {...S} />
      <circle cx="58" cy="70" r="25" {...S} />
      <circle cx="54" cy="72" r="13" {...S} />
      <circle cx="52" cy="73" r="3.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** The corpus — a wireframe archive cube with hidden edges dotted. */
export function FigCorpus({ size = 132 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 132 132" aria-hidden>
      <path d="M36 46 L82 34 L108 50 L62 64 Z" {...S} />
      <path d="M36 46 L36 88 L62 106 L62 64" {...S} />
      <path d="M108 50 L108 90 L62 106" {...S} />
      <path d="M36 88 L82 76 L108 90" {...DOT} />
      <path d="M82 34 L82 76" {...DOT} />
      <line x1="49" y1="52" x2="49" y2="94" {...DOT} />
      <line x1="95" y1="55" x2="95" y2="97" {...DOT} />
    </svg>
  );
}

/** The gate — many candidates fan in, one call leaves; the rest end dotted. */
export function FigGate({ size = 132 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 132 132" aria-hidden>
      <line x1="14" y1="30" x2="62" y2="66" {...DOT} />
      <line x1="14" y1="66" x2="62" y2="66" {...DOT} />
      <line x1="14" y1="102" x2="62" y2="66" {...DOT} />
      <circle cx="14" cy="30" r="3" {...S} />
      <circle cx="14" cy="66" r="3" {...S} />
      <circle cx="14" cy="102" r="3" {...S} />
      <circle cx="66" cy="66" r="5" {...S} />
      <line x1="71" y1="66" x2="116" y2="66" {...S} />
      <circle cx="118" cy="66" r="3.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Calibration — the dotted promise, the solid measure, the needle. */
export function FigCalib({ size = 132 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 132 132" aria-hidden>
      <path d="M22 96 A 48 48 0 0 1 110 96" {...DOT} />
      <path d="M30 96 A 40 40 0 0 1 92 62" {...S} />
      <line x1="66" y1="96" x2="92" y2="62" {...S} />
      <circle cx="66" cy="96" r="3.2" fill="currentColor" stroke="none" />
      <circle cx="92" cy="62" r="3" {...S} />
    </svg>
  );
}

/** The tape — a settled ledger line; ticks print, one result steps up. */
export function FigTape({ size = 132 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 132 132" aria-hidden>
      <line x1="12" y1="84" x2="120" y2="84" {...S} />
      {[24, 40, 56, 88, 104].map(x => (
        <line key={x} x1={x} y1="84" x2={x} y2="76" {...S} />
      ))}
      <path d="M64 84 L64 52 L80 52 L80 84" {...S} />
      <line x1="64" y1="52" x2="80" y2="52" {...S} />
      <line x1="12" y1="52" x2="120" y2="52" {...DOT} />
      <circle cx="72" cy="44" r="3" {...S} />
    </svg>
  );
}
