'use client';

import React from 'react';

/**
 * ExchangeTicker — a quietly-running tape of realized auction hammers.
 * Old exchange / auction-results board heritage: brass-butter MAKER labels +
 * white PRICE facts, hairline ticks between, edge-faded at the rails.
 *
 * Ambient chrome, ~32px tall. No green/red fills (prices are facts); `tone`
 * only adds a tiny direction caret. Static-export / SSR safe: markup renders
 * server-side; motion is pure CSS @keyframes translateX. Reduced-motion → static.
 */

type Item = { label: string; price: string; tone?: 'up' | 'down' | null };

// class prefix: xtk-
const CSS = `
.xtk-root{
  --xtk-h: 32px;
  --xtk-fade: 40px;
  position: relative;
  height: var(--xtk-h);
  overflow: hidden;
  background: var(--color-bg);
  border-top: 1px solid var(--color-border);
  border-bottom: 1px solid var(--color-border);
  /* a fine baseline rule sits under the tape */
  font-family: var(--font-mono, var(--font-sans)), monospace;
  contain: content;
}
/* edge-fade masks: entries dissolve into the rails, never hard-cut */
.xtk-mask{
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 var(--xtk-fade), #000 calc(100% - var(--xtk-fade)), transparent);
  mask-image: linear-gradient(90deg, transparent, #000 var(--xtk-fade), #000 calc(100% - var(--xtk-fade)), transparent);
}
/* the moving lane. width is intrinsic (nowrap); we translate by -50% of the
   full track so the SECOND (duplicate) copy lands exactly where the first began
   → seamless, gapless wrap. */
.xtk-lane{
  display: flex;
  align-items: center;
  flex: none;
  white-space: nowrap;
  will-change: transform;
  animation: xtk-scroll var(--xtk-dur, 40s) linear infinite;
}
@keyframes xtk-scroll{
  from{ transform: translate3d(0,0,0); }
  to{ transform: translate3d(-50%,0,0); }
}
/* one copy of the entries */
.xtk-copy{ display: flex; align-items: center; flex: none; }

.xtk-entry{
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  padding: 0 4px;
  font-size: 12px;
  line-height: 1;
}
.xtk-label{
  color: var(--color-butter);
  text-transform: uppercase;
  letter-spacing: 0.14em;
  font-weight: 600;
  font-feature-settings: "tnum" 1;
}
.xtk-price{
  color: var(--color-fg);
  letter-spacing: 0.01em;
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum" 1;
}
.xtk-caret{
  font-size: 9px;
  line-height: 1;
  opacity: 0.85;
  margin-left: 2px;
}
.xtk-caret.up{ color: var(--color-up, #2FBF71); }
.xtk-caret.down{ color: var(--color-down, #CC6A5C); }
/* a thin brass hairline tick separates entries */
.xtk-tick{
  display: inline-block;
  width: 1px;
  height: 12px;
  margin: 0 16px;
  background: var(--color-border);
  flex: none;
  transform: translateY(1px);
}

/* IGNITION: one-time reveal on mount — the lane fades/slides in, settling
   into the steady marquee. Runs alongside the infinite scroll (separate
   property so it composes cleanly and only fires once). */
.xtk-root.play .xtk-mask{
  animation: xtk-ignite 720ms cubic-bezier(0.22,0.61,0.36,1) both;
}
@keyframes xtk-ignite{
  from{ opacity: 0; transform: translateX(10px); }
  to{ opacity: 1; transform: translateX(0); }
}
/* the leading few entries tick in during ignition */
.xtk-root.play .xtk-copy:first-child .xtk-entry:nth-child(-n+6){
  animation: xtk-tickin 520ms cubic-bezier(0.22,0.61,0.36,1) both;
}
.xtk-root.play .xtk-copy:first-child .xtk-entry:nth-child(2){ animation-delay: 60ms; }
.xtk-root.play .xtk-copy:first-child .xtk-entry:nth-child(3){ animation-delay: 120ms; }
.xtk-root.play .xtk-copy:first-child .xtk-entry:nth-child(4){ animation-delay: 180ms; }
.xtk-root.play .xtk-copy:first-child .xtk-entry:nth-child(5){ animation-delay: 240ms; }
.xtk-root.play .xtk-copy:first-child .xtk-entry:nth-child(6){ animation-delay: 300ms; }
@keyframes xtk-tickin{
  from{ opacity: 0; transform: translateY(3px); }
  to{ opacity: 1; transform: translateY(0); }
}

/* DEGRADATION: no scroll, no ignition — a static row that still reads.
   overflow already clips; the mask keeps the trailing edge soft. */
@media (prefers-reduced-motion: reduce){
  .xtk-lane{ animation: none !important; }
  .xtk-root.play .xtk-mask,
  .xtk-root.play .xtk-copy:first-child .xtk-entry{ animation: none !important; opacity: 1; transform: none; }
}
`;

function Entry({ item }: { item: Item }) {
  return (
    <span className="xtk-entry">
      <span className="xtk-label">{item.label}</span>
      <span className="xtk-price">
        {item.price}
        {item.tone === 'up' && <span className="xtk-caret up" aria-hidden>▲</span>}
        {item.tone === 'down' && <span className="xtk-caret down" aria-hidden>▼</span>}
      </span>
    </span>
  );
}

// one full pass of the entries, hairline-ticked. keyed with a copy id so the
// two duplicated tracks don't collide.
function Copy({ items, cid }: { items: Item[]; cid: string }) {
  return (
    <div className="xtk-copy" aria-hidden={cid !== 'a'}>
      {items.map((it, i) => (
        <React.Fragment key={`${cid}-${i}`}>
          <Entry item={it} />
          <span className="xtk-tick" aria-hidden />
        </React.Fragment>
      ))}
    </div>
  );
}

export default function ExchangeTicker({
  items,
  play = false,
  speed = 60,
  className,
  style,
}: {
  items: Item[];
  play?: boolean;
  speed?: number;
  className?: string;
  style?: React.CSSProperties;
}): JSX.Element {
  const list = items ?? [];

  // Short/empty lists: pad by repeating so the track is wide enough to fill
  // the rail and wrap without a visible gap. We aim for a comfortable minimum
  // entry count; the loop math (-50%) holds regardless of count.
  const MIN = 8;
  const base = list.length === 0 ? [] : list;
  const padded: Item[] =
    base.length === 0
      ? []
      : base.length >= MIN
      ? base
      : Array.from({ length: Math.ceil(MIN / base.length) }, () => base).flat();

  // duration from speed: the animation moves the lane by 50% of its full width
  // (== one copy's width) per cycle. We approximate copy width from entry count
  // so px/sec stays roughly honest across list sizes without measuring in JS
  // (keeps it SSR/static-safe). ~150px per entry is the mono average here.
  const perEntryPx = 150;
  const copyWidth = Math.max(padded.length, 1) * perEntryPx;
  const durSec = copyWidth / Math.max(speed, 1);

  if (padded.length === 0) {
    // never blank: render the shell so it's not a layout hole.
    return (
      <div
        className={`xtk-root${className ? ` ${className}` : ''}`}
        style={style}
        role="marquee"
        aria-label="Realized hammers"
      >
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
      </div>
    );
  }

  return (
    <div
      className={`xtk-root${play ? ' play' : ''}${className ? ` ${className}` : ''}`}
      style={{ ['--xtk-dur' as string]: `${durSec}s`, ...style }}
      role="marquee"
      aria-label="Recent realized auction hammers"
    >
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="xtk-mask">
        <div className="xtk-lane">
          {/* two identical copies → the keyframe translates by exactly one copy,
              so copy B is mid-rail when copy A exits: seamless, no jump. */}
          <Copy items={padded} cid="a" />
          <Copy items={padded} cid="b" />
        </div>
      </div>
    </div>
  );
}

/*
 * USAGE (integrator):
 *   const tape = [{label:'PICASSO', price:'$195,040,000', tone:'up'}, ...];
 *   <ExchangeTicker items={tape} play={firstPaint} speed={60} />
 *   // play={true} does the one-time ignition on mount, then steady marquee.
 */
