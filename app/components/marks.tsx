/**
 * marks.tsx — THE MARK SYSTEM. Every room in the app carries a constructed
 * monoline glyph: the room's name and its analytics fused into one small
 * instrument (the NavMark / CHAPTER_GLYPHS lineage, promoted app-wide).
 *
 * Grammar laws:
 *  · 24-unit viewBox, stroke 1.7, round caps/joins, currentColor, fill none
 *  · instrument vocabulary ONLY — lines, bars, curves, calipers, witnesses,
 *    dots. No clip-art, no filled shapes, never a second color.
 *  · every path carries pathLength={1} so the one-time draw-in can animate
 *    stroke-dashoffset 1→0 uniformly regardless of true path length.
 */
import React from 'react';

function M({ size = 22, children, className }: { size?: number; children: React.ReactNode; className?: string }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden className={className}
    >
      {children}
    </svg>
  );
}
type MarkProps = { size?: number; className?: string };

/* ── the three lanes ────────────────────────────────────────────────────── */

/** The Flags — a flagpole whose pennant is a rising bar chart */
export function FlagsMark(p: MarkProps) {
  return (
    <M {...p}>
      <path d="M5.5 21V3.5" pathLength={1} />
      <path d="M5.5 11.5H16.5" pathLength={1} />
      <path d="M9 11.5V8.5" pathLength={1} />
      <path d="M12.5 11.5V6.5" pathLength={1} />
      <path d="M16 11.5V4.5" pathLength={1} />
    </M>
  );
}

/** The Gap — two price rails with the CI-beam caliper between them */
export function GapMark(p: MarkProps) {
  return (
    <M {...p}>
      <path d="M4 5.5H20" pathLength={1} />
      <path d="M4 18.5H20" pathLength={1} />
      <path d="M12 8.5V15.5" pathLength={1} />
      <path d="M9.5 8.5H14.5" pathLength={1} />
      <path d="M9.5 15.5H14.5" pathLength={1} />
    </M>
  );
}

/** The Sleepers — a flat pulse running into the clock */
export function SleeperMark(p: MarkProps) {
  return (
    <M {...p}>
      <path d="M2.5 12H9" pathLength={1} />
      <circle cx="15.5" cy="12" r="5.5" pathLength={1} />
      <path d="M15.5 9.5V12L17.5 13.5" pathLength={1} />
    </M>
  );
}

/* ── /value sub-rooms ───────────────────────────────────────────────────── */

/** Market pulse — the index line itself */
export function PulseMark(p: MarkProps) {
  return (
    <M {...p}>
      <path d="M2.5 13.5H6.5L9.5 7L13.5 17.5L16.5 11H21.5" pathLength={1} />
    </M>
  );
}

/** The record — a rosette seal: the replayed call, certified */
export function RecordMark(p: MarkProps) {
  return (
    <M {...p}>
      <circle cx="12" cy="9.5" r="5.5" pathLength={1} />
      <path d="M9.8 9.5l1.7 1.7 3-3.2" pathLength={1} />
      <path d="M9.2 14.2L7.5 20.5l4.5-2.6 4.5 2.6-1.7-6.3" pathLength={1} />
    </M>
  );
}

/** The odds ladder — axis, the calibration curve, the read point */
export function OddsMark(p: MarkProps) {
  return (
    <M {...p}>
      <path d="M4.5 3.5v16h16" pathLength={1} />
      <path d="M7 16.5C11 15.5 14.5 11.5 17.5 6.5" pathLength={1} />
      <circle cx="17.5" cy="6.5" r="1.5" pathLength={1} />
    </M>
  );
}

/** Where they landed — the outcome histogram */
export function DistMark(p: MarkProps) {
  return (
    <M {...p}>
      <path d="M3.5 19.5h17" pathLength={1} />
      <path d="M6.5 19.5V13" pathLength={1} />
      <path d="M10.5 19.5V7.5" pathLength={1} />
      <path d="M14.5 19.5V10.5" pathLength={1} />
      <path d="M18.5 19.5V15.5" pathLength={1} />
    </M>
  );
}

/** The conditions — a calendar whose cells carry the month bars */
export function ConditionsMark(p: MarkProps) {
  return (
    <M {...p}>
      <rect x="4" y="6" width="16" height="13.5" rx="2" pathLength={1} />
      <path d="M8.5 3.5v4M15.5 3.5v4" pathLength={1} />
      <path d="M8 16v-3.5M12 16v-6M16 16v-2" pathLength={1} />
    </M>
  );
}

/** Settled calls — the tape: a receipt, torn at the foot */
export function TapeMark(p: MarkProps) {
  return (
    <M {...p}>
      <path d="M6.5 3.5H17.5V19.5L15.7 18L13.9 19.5L12.1 18L10.3 19.5L8.5 18L6.5 19.5Z" pathLength={1} />
      <path d="M9.5 8h5" pathLength={1} />
      <path d="M9.5 11.5h5" pathLength={1} />
    </M>
  );
}

/** The engine — three medians and the witness diamond */
export function EngineMark(p: MarkProps) {
  return (
    <M {...p}>
      <path d="M4.5 7h15" pathLength={1} />
      <path d="M4.5 12h15" pathLength={1} />
      <path d="M4.5 17h15" pathLength={1} />
      <rect x="10.6" y="10.6" width="2.8" height="2.8" transform="rotate(45 12 12)" pathLength={1} />
    </M>
  );
}

/* ── analytics rooms ────────────────────────────────────────────────────── */

/** The index laboratory — two fitted lines, one read point */
export function IndexLabMark(p: MarkProps) {
  return (
    <M {...p}>
      <path d="M3.5 16.5C8.5 15.5 12 9.5 20.5 7" pathLength={1} />
      <path d="M3.5 11.5C9 11 13.5 14.5 20.5 13.5" pathLength={1} />
      <circle cx="20.5" cy="7" r="1.4" pathLength={1} />
    </M>
  );
}

/** Relative strength — two lines leaving one origin, spreading */
export function StrengthMark(p: MarkProps) {
  return (
    <M {...p}>
      <path d="M4 18.5C10 16.5 14.5 12 20 5.5" pathLength={1} />
      <path d="M4 18.5C11 18 16 17 20 15.5" pathLength={1} />
    </M>
  );
}

/** Verified movers — the rise, then its proof tick */
export function MoversMark(p: MarkProps) {
  return (
    <M {...p}>
      <path d="M3.5 17L9 11.5l3.5 3L20.5 6" pathLength={1} />
      <path d="M15.5 6h5v5" pathLength={1} />
    </M>
  );
}

/** Sell-through — the funnel: read in, cleared out */
export function SellMark(p: MarkProps) {
  return (
    <M {...p}>
      <path d="M4 5h16l-6 7v6.5l-4 2V12z" pathLength={1} />
    </M>
  );
}

/** Market depth — descending depth bars */
export function DepthMark(p: MarkProps) {
  return (
    <M {...p}>
      <path d="M4 7h16" pathLength={1} />
      <path d="M4 12h11" pathLength={1} />
      <path d="M4 17h6" pathLength={1} />
    </M>
  );
}

/** House calibration — the rail, its witness, the end stops */
export function CalibrationMark(p: MarkProps) {
  return (
    <M {...p}>
      <path d="M4 12h16" pathLength={1} />
      <path d="M6 9.5v5" pathLength={1} />
      <path d="M18 9.5v5" pathLength={1} />
      <rect x="10.7" y="10.7" width="2.6" height="2.6" transform="rotate(45 12 12)" pathLength={1} />
    </M>
  );
}

/** The grade curve — a staircase of grades */
export function GradeMark(p: MarkProps) {
  return (
    <M {...p}>
      <path d="M4 19h4v-4h4v-4h4V7h4" pathLength={1} />
    </M>
  );
}

/** Long horizon — the line runs to the horizon point */
export function HorizonMark(p: MarkProps) {
  return (
    <M {...p}>
      <path d="M3.5 16.5h17" pathLength={1} />
      <path d="M8 16.5a4 4 0 0 1 8 0" pathLength={1} />
      <path d="M12 9.5V7" pathLength={1} />
    </M>
  );
}

/** The full book / deep pools — the open ledger */
export function BookMark(p: MarkProps) {
  return (
    <M {...p}>
      <path d="M12 7v12" pathLength={1} />
      <path d="M12 7C10.5 5.5 7.5 5 4.5 5.5v12C7.5 17 10.5 17.5 12 19c1.5-1.5 4.5-2 7.5-1.5v-12C16.5 5 13.5 5.5 12 7z" pathLength={1} />
    </M>
  );
}

/** Maker rankings — the podium bars, the leader dotted */
export function RankMark(p: MarkProps) {
  return (
    <M {...p}>
      <path d="M3.5 19.5h17" pathLength={1} />
      <path d="M7 19.5V12" pathLength={1} />
      <path d="M12 19.5V6.5" pathLength={1} />
      <path d="M17 19.5V15" pathLength={1} />
      <circle cx="12" cy="3.8" r="0.9" pathLength={1} />
    </M>
  );
}

/** Top sales — the tag */
export function SalesMark(p: MarkProps) {
  return (
    <M {...p}>
      <path d="M12.5 3.5h7v7L11 19l-7-7z" pathLength={1} />
      <circle cx="16.5" cy="6.5" r="1.2" pathLength={1} />
    </M>
  );
}

/* ── profile rooms ──────────────────────────────────────────────────────── */

/** Watching — the eye on the block */
export function WatchMark(p: MarkProps) {
  return (
    <M {...p}>
      <path d="M2.5 12c2.5-4.5 5.8-6.8 9.5-6.8s7 2.3 9.5 6.8c-2.5 4.5-5.8 6.8-9.5 6.8S5 16.5 2.5 12z" pathLength={1} />
      <circle cx="12" cy="12" r="2.6" pathLength={1} />
    </M>
  );
}

/** Your collection — two frames, one behind the other */
export function CollectionMark(p: MarkProps) {
  return (
    <M {...p}>
      <path d="M8.5 7.5V5.5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-2" pathLength={1} />
      <rect x="4.5" y="8.5" width="11" height="11" rx="1" pathLength={1} />
    </M>
  );
}

/** While you were away — the inbox tray */
/** Today's reads — the desk note: ruled lines with the unread marker */
export function ReadsMark(p: MarkProps) {
  return (
    <M {...p}>
      <path d="M4 6.5h12" pathLength={1} />
      <path d="M4 12h16" pathLength={1} />
      <path d="M4 17.5h9" pathLength={1} />
      <circle cx="19.5" cy="6.5" r="1" pathLength={1} />
    </M>
  );
}

export function AwayMark(p: MarkProps) {
  return (
    <M {...p}>
      <path d="M4 13.5l2.6-7.5h10.8L20 13.5V19H4z" pathLength={1} />
      <path d="M4 13.5h4.5l1.5 2.5h4l1.5-2.5H20" pathLength={1} />
    </M>
  );
}

/** Concluded & archived — the box with its lid */
export function ArchiveMark(p: MarkProps) {
  return (
    <M {...p}>
      <rect x="3.5" y="4.5" width="17" height="4.5" rx="1" pathLength={1} />
      <path d="M5.5 9v9.5a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V9" pathLength={1} />
      <path d="M10 13h4" pathLength={1} />
    </M>
  );
}

/** Today's call — the plate under the lamp */
export function CallMark(p: MarkProps) {
  return (
    <M {...p}>
      <path d="M12 3.5V6" pathLength={1} />
      <path d="M7.5 11.5a4.5 4.5 0 0 1 9 0" pathLength={1} />
      <path d="M6 14.5l-1.6 1.2M18 14.5l1.6 1.2" pathLength={1} />
      <path d="M5 19.5h14" pathLength={1} />
    </M>
  );
}
