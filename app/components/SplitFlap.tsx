'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * SplitFlap — a Solari / train-station split-flap board primitive.
 *
 * A value (number or short word) renders as a row of fixed-width flap CELLS.
 * When `play` fires, each cell mechanically rolls through a plausible glyph set
 * and DECELERATES onto its target character; columns land left→right in a
 * per-column stagger so the row settles like a real departure board. Each cell
 * carries the classic center-seam fold hairline and a top/bottom shade so it
 * reads dimensional yet flat. Brass-butter glyphs on slightly-raised vellum.
 *
 * The flip is a true split-flap fold: a hinged top leaf rotates down over the
 * seam (rotateX, transform/opacity only — no layout thrash), swapping the glyph
 * at the fold's midpoint the way a physical flap reveals the next card. Many
 * cells animate at once; each drives ONE transform, so it stays cheap at 60fps.
 *
 * SSR / static-export safe: state initialises to the FINAL glyphs, so the
 * server render and first client paint both show the real `value`. Animation
 * only ever starts inside a client effect, and only when `play` is true and
 * motion is allowed. So no blank, no "0", no mid-flip can hydrate — a
 * JS-disabled or reduced-motion reader always sees the correct final figure.
 */

// Mechanical glyph roll-sets. A cell only rolls through characters of its own
// kind (a digit rolls digits, a letter rolls letters) so the cascade reads like
// a real board's card stack rather than random noise.
const DIGITS = '0123456789';
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const PUNCT = ' .,+-%$';

/** The roll sequence a cell steps through before landing on `target`. */
function rollSet(target: string): string {
  const c = target.toUpperCase();
  if (c >= '0' && c <= '9') return DIGITS;
  if (c >= 'A' && c <= 'Z') return LETTERS;
  return PUNCT; // punctuation/space flaps through a tiny mechanical set
}

/** Number of flap steps a column takes before it lands — a short decelerating
 *  roll. Farther-right columns take a couple extra steps so they trail. */
function stepsFor(colIndex: number): number {
  return 5 + Math.min(colIndex, 6); // 5..11 flaps; enough to read mechanical
}

type Size = 'hero' | 'ledger' | 'tape';

interface CellState {
  glyph: string; // currently-shown character
  flipping: boolean; // is the top leaf mid-fold this step
  next: string; // glyph revealed when this fold completes
}

/** One split-flap cell. Renders four faces of a fold:
 *  - top-static:   top half of the CURRENT glyph (upper card, at rest)
 *  - bottom-static:bottom half of the NEXT glyph (lower card already showing)
 *  - leaf:         hinged upper card that rotates down 0→90° to reveal `next`,
 *                  front = top of current glyph, back(=under) = handled by swap.
 *  The seam sits at the fold line; a shade darkens the lower half so the crease
 *  reads. On land, `flipping` is false and both halves show the target. */
function Cell({
  state,
  landMs,
  reduce,
}: {
  state: CellState;
  landMs: number;
  reduce: boolean;
}) {
  const { glyph, flipping, next } = state;
  // Per-flap duration: one leaf fold takes a slice of the land budget, but is
  // clamped so a fast roll never smears. The reel of steps sums toward landMs.
  const foldMs = reduce ? 0 : Math.max(70, Math.min(150, landMs / 6));

  return (
    <span className="sflap-cell" aria-hidden="true">
      {/* upper half — shows the top of the current glyph at rest */}
      <span className="sflap-half sflap-top">
        <span className="sflap-glyph">{glyph}</span>
      </span>
      {/* lower half — shows the bottom of the glyph that will remain after the
          fold; while flipping this is already `next`, so the fold uncovers it */}
      <span className="sflap-half sflap-bottom">
        <span className="sflap-glyph">{flipping ? next : glyph}</span>
      </span>
      {/* the hinged leaf: the current glyph's top, folding down to reveal next */}
      {flipping && !reduce ? (
        <span
          className="sflap-leaf"
          style={{ animationDuration: `${foldMs}ms` }}
        >
          <span className="sflap-half sflap-top sflap-leaf-face">
            <span className="sflap-glyph">{glyph}</span>
          </span>
        </span>
      ) : null}
      <span className="sflap-seam" />
    </span>
  );
}

/**
 * @param value    final text to display, e.g. "+14.2%" | "195,040,000" | "PICASSO"
 * @param play     when true, flip-animate to `value` on mount; when false render
 *                 the final glyphs statically at once (no roll)
 * @param stagger  ms between adjacent columns' land times (left→right cascade)
 * @param landMs   ms for a single cell's full roll to settle
 * @param size     'hero' | 'ledger' | 'tape' — three scales
 * @param startDelay ms to hold before this whole board begins rolling — lets a
 *                 ROW of SplitFlaps ignite in a left→right cascade (figure 1
 *                 before figure 2 …) while each still settles on its own budget.
 */
export default function SplitFlap({
  value,
  play = false,
  stagger = 55,
  landMs = 620,
  size = 'hero',
  startDelay = 0,
  className,
  style,
}: {
  value: string;
  play?: boolean;
  stagger?: number;
  landMs?: number;
  size?: Size;
  startDelay?: number;
  className?: string;
  style?: React.CSSProperties;
}): JSX.Element {
  // Split the target into per-cell glyphs. Uppercased so word-cells roll the
  // letter set and land legibly (Solari boards are caps).
  const targets = useMemo(() => value.toUpperCase().split(''), [value]);

  // SSR / first-paint: seed every cell ALREADY on its final glyph. Nothing else
  // can render — no "0", no blank, no half-fold — so hydration matches and a
  // no-JS reader sees the real value. Animation only mutates this in an effect.
  const [cells, setCells] = useState<CellState[]>(() =>
    targets.map((g) => ({ glyph: g, flipping: false, next: g }))
  );

  const timers = useRef<number[]>([]);
  const raf = useRef(0);

  useEffect(() => {
    // Clear any in-flight roll (value or play changed mid-flight).
    timers.current.forEach(clearTimeout);
    timers.current = [];
    if (raf.current) cancelAnimationFrame(raf.current);

    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Not playing OR reduced motion: land on the final glyphs instantly. The
    // roll is pure entrance craft, never a gate on reading the number.
    if (!play || reduce) {
      setCells(targets.map((g) => ({ glyph: g, flipping: false, next: g })));
      return;
    }

    // Arm the roll: start every cell on a scrambled glyph, then step each column
    // through its roll-set, decelerating, and land it after its stagger offset.
    // `startDelay` holds the board on its FINAL glyphs first (no early scramble
    // flash), so a row of boards can ignite in a left→right cascade.
    const start: CellState[] = targets.map((t) => {
      const set = rollSet(t);
      const g = set[0] === t ? set[1 % set.length] : set[0];
      return { glyph: g, flipping: false, next: g };
    });
    const hold = Math.max(0, startDelay);
    if (hold > 0) {
      // stay on the true value until the cascade reaches this board
      timers.current.push(window.setTimeout(() => setCells(start), hold));
    } else {
      setCells(start);
    }

    targets.forEach((target, col) => {
      const set = rollSet(target);
      const steps = stepsFor(col);
      // land time for THIS column: startDelay + base roll + left→right stagger
      const landAt = hold + col * stagger;
      // step interval accelerates the reel then eases into the final flap;
      // sum of intervals ≈ landMs so the whole cell settles on budget.
      const seq: string[] = [];
      // Choose the glyphs this column flaps through: a walk of its roll-set that
      // ends on `target`, so the last visible fold reveals the answer.
      const startIdx = set.indexOf(start[col].glyph);
      const targetIdx = set.indexOf(target < ' ' ? ' ' : target) === -1
        ? 0
        : set.indexOf(target);
      for (let s = 1; s <= steps; s++) {
        // ease the index from start→target so it decelerates onto the answer
        const t = s / steps;
        const eased = 1 - Math.pow(1 - t, 2); // easeOutQuad
        const span = ((targetIdx - startIdx + set.length * 3) % set.length) + set.length * 2;
        const idx = Math.round(startIdx + span * eased) % set.length;
        seq.push(s === steps ? target : set[idx]);
      }

      let acc = landAt;
      seq.forEach((g, i) => {
        // decelerating cadence: early flaps fast, final flaps slower (the card
        // "catching"). Interval grows toward the last step.
        const t = (i + 1) / seq.length;
        const interval = (landMs / seq.length) * (0.6 + 0.8 * t);
        acc += interval;
        const isLast = i === seq.length - 1;
        const at = acc;
        // begin fold: leaf drops, next glyph queued
        timers.current.push(
          window.setTimeout(() => {
            setCells((prev) => {
              const nx = prev.slice();
              const cur = nx[col];
              if (!cur) return prev;
              nx[col] = { glyph: cur.glyph, flipping: true, next: g };
              return nx;
            });
          }, at)
        );
        // complete fold: settle onto the revealed glyph
        const foldMs = Math.max(70, Math.min(150, landMs / 6));
        timers.current.push(
          window.setTimeout(() => {
            setCells((prev) => {
              const nx = prev.slice();
              const cur = nx[col];
              if (!cur) return prev;
              nx[col] = { glyph: g, flipping: false, next: g };
              return nx;
            });
          }, at + (isLast ? foldMs : foldMs * 0.92))
        );
      });
    });

    return () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
      if (raf.current) cancelAnimationFrame(raf.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, play, stagger, landMs, startDelay]);

  const reduce =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  return (
    <span
      className={`sflap sflap-${size}${className ? ` ${className}` : ''}`}
      style={style}
      // real value for AT / copy / no-JS — the visual cells are aria-hidden
      role="text"
      aria-label={value}
    >
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      {cells.map((c, i) => (
        <Cell key={i} state={c} landMs={landMs} reduce={reduce} />
      ))}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * CSS — scoped to `.sflap*`. Transform/opacity only; the leaf fold is
 * the only animated property so a full row of cells stays 60fps-cheap.
 * ------------------------------------------------------------------ */
const CSS = `
.sflap {
  display: inline-flex;
  align-items: stretch;
  gap: var(--sflap-gap, 0.06em);
  font-family: var(--font-sans), sans-serif;
  font-variant-numeric: tabular-nums;
  font-feature-settings: 'tnum' 1, 'lnum' 1;
  line-height: 1;
  white-space: nowrap;
  -webkit-user-select: none;
  user-select: none;
}

/* --- three scales: font-size + cell metrics --------------------- */
.sflap-hero {
  --sflap-fs: clamp(44px, 6.5vw, 68px);
  --sflap-cw: 0.72em;   /* cell width relative to font-size (tabular) */
  --sflap-ch: 1.16em;   /* cell height */
  --sflap-rad: 5px;
  --sflap-gap: 0.07em;
  --sflap-seam: 1.4px;
  font-size: var(--sflap-fs);
  font-weight: 600;
  letter-spacing: -0.01em;
}
.sflap-ledger {
  --sflap-fs: clamp(24px, 3.4vw, 28px);
  --sflap-cw: 0.70em;
  --sflap-ch: 1.18em;
  --sflap-rad: 3px;
  --sflap-gap: 0.06em;
  --sflap-seam: 1px;
  font-size: var(--sflap-fs);
  font-weight: 600;
  letter-spacing: 0;
}
.sflap-tape {
  --sflap-fs: clamp(13px, 1.4vw, 15px);
  --sflap-cw: 0.72em;
  --sflap-ch: 1.24em;
  --sflap-rad: 2px;
  --sflap-gap: 0.05em;
  --sflap-seam: 0.75px;
  font-size: var(--sflap-fs);
  font-weight: 600;
  letter-spacing: 0.01em;
}

/* --- the cell: a raised vellum plate, top/bottom halves + seam --- */
.sflap-cell {
  position: relative;
  display: inline-block;
  width: var(--sflap-cw);
  height: var(--sflap-ch);
  border-radius: var(--sflap-rad);
  /* slightly-raised vellum: a hair lighter than --color-bg, warm brass rim */
  background:
    linear-gradient(180deg,
      color-mix(in srgb, var(--color-bg-elevated) 92%, #E8DAB6 8%) 0%,
      color-mix(in srgb, var(--color-bg-elevated) 96%, #E8DAB6 4%) 49.6%,
      color-mix(in srgb, var(--color-bg) 94%, #000 6%) 50.4%,
      color-mix(in srgb, var(--color-bg) 90%, #000 10%) 100%);
  box-shadow:
    inset 0 1px 0 rgba(232, 218, 182, 0.06),
    inset 0 -1px 0 rgba(0, 0, 0, 0.35),
    0 1px 2px rgba(0, 0, 0, 0.30);
  overflow: hidden;
  isolation: isolate;
}

/* each half clips to 50% and positions the glyph so the two halves compose one
   character split exactly at the seam. */
.sflap-half {
  position: absolute;
  left: 0;
  right: 0;
  height: 50%;
  overflow: hidden;
}
.sflap-top { top: 0; }
.sflap-bottom {
  bottom: 0;
  /* subtle lower-half shade so the fold reads dimensional but flat */
  box-shadow: inset 0 1px 4px rgba(0, 0, 0, 0.28);
}

/* the glyph itself: one span per half, absolutely centred to the FULL cell so
   .top clips its lower portion and .bottom clips its upper portion → seamless
   character. Brass-butter is the only warm colour. */
.sflap-glyph {
  position: absolute;
  left: 0;
  right: 0;
  height: var(--sflap-ch);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #E8DAB6;
  color: var(--color-butter, #E8DAB6);
  text-shadow: 0 1px 0 rgba(0, 0, 0, 0.45);
  will-change: auto;
}
.sflap-top .sflap-glyph { top: 0; }
.sflap-bottom .sflap-glyph { bottom: 0; }

/* --- the hinged leaf: current glyph's top, folding down over the seam --- */
.sflap-leaf {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 50%;
  transform-origin: 50% 100%;   /* hinge at the seam (bottom of the top half) */
  transform: rotateX(0deg);
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
  z-index: 2;
  border-radius: var(--sflap-rad) var(--sflap-rad) 0 0;
  animation-name: sflap-fold;
  animation-timing-function: cubic-bezier(0.42, 0, 0.62, 1);
  animation-fill-mode: forwards;
}
.sflap-leaf-face {
  /* the leaf carries a full plate face so it matches the resting top half */
  background:
    linear-gradient(180deg,
      color-mix(in srgb, var(--color-bg-elevated) 92%, #E8DAB6 8%) 0%,
      color-mix(in srgb, var(--color-bg-elevated) 96%, #E8DAB6 4%) 100%);
  box-shadow: inset 0 1px 0 rgba(232, 218, 182, 0.06);
}

/* the fold: leaf rotates down 0→90°, dimming as it turns edge-on. The lower
   half underneath already shows "next", so at 90deg the new glyph is revealed. */
@keyframes sflap-fold {
  0%   { transform: rotateX(0deg);   filter: brightness(1); }
  100% { transform: rotateX(-90deg); filter: brightness(0.55); }
}

/* --- the center seam: a hairline crease at the fold line ---------- */
.sflap-seam {
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  height: var(--sflap-seam);
  transform: translateY(-50%);
  z-index: 3;
  pointer-events: none;
  background: linear-gradient(90deg,
    rgba(0,0,0,0) 0%,
    rgba(0,0,0,0.55) 12%,
    rgba(0,0,0,0.6) 88%,
    rgba(0,0,0,0) 100%);
  box-shadow: 0 0.5px 0 rgba(232, 218, 182, 0.05);
}

@media (prefers-reduced-motion: reduce) {
  .sflap-leaf { animation: none !important; display: none !important; }
}
`;

/* ------------------------------------------------------------------ *
 * USAGE (integrator):
 *   <SplitFlap value="195,040,000" size="hero" play={armed} />
 *   <SplitFlap value="+14.2%" size="ledger" play={armed} stagger={45} />
 *   <SplitFlap value="PICASSO" size="tape" />           // static, no roll
 * ------------------------------------------------------------------ */
