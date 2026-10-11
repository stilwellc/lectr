/**
 * THE DESK CARD — a 1200×630 PNG of the desk's headline numbers, rendered on
 * this device (canvas), downloaded by the reader, never uploaded. Brand ink
 * on eggshell in both modes: the card is a print, not a screen.
 *
 * Numbers and their sources (cardNumbersOf):
 *   watching   Σ estimate midpoint over the live watched lots that carry an
 *              estimate (the masthead's "to the hammer" sum) · lots = every
 *              live watch · priced = how many of them carry an estimate
 *   record     the Record section's median realized vs estimate over every
 *              settled save with an estimate (edge.ts record), with its n
 *   graded     calls graded against the hammer (edge.ts n)
 *   names      the three makers / subjects the reader saves most (ties: the
 *              most recent save first); a desk with no saved names falls
 *              back to the names it follows
 * The record line prints only at EDGE_MIN_N graded calls — a desk under it
 * carries the card without the line (cardLines).
 */
import type { AuctionLot } from '../../types';
import type { SavedMeta } from '../../lib/account';
import type { Follow } from '../../lib/follows';
import { displayMakerOf } from '../../lib/maker-subjects';
import { isOnBlock } from '../../utils';
import { fmtFace } from '../../lib/lot-face';
import { fmtSignedPct } from '../../utils';
import { EDGE_MIN_N, dayOf } from './edge';

export const CARD_W = 1200;
export const CARD_H = 630;

/** the brand sheet (docs/NORTHSTAR_UI.md §1.4 / §2.1): eggshell ground,
 *  warm ink, warm-gray 500, hairline, the lamp's print green and brick —
 *  fixed, so the card is the same print in dark mode */
export const CARD_INK = {
  ground: '#FDFCFC',
  ink: '#1C1917',
  muted: '#6B655D',
  hairline: '#EBE8E4',
  up: '#0F7C43',
  down: '#A5341F',
} as const;

export interface CardNumbers {
  watchingUsd: number;
  watchingLots: number;
  watchingPriced: number;
  record: { n: number; med: number | null };
  graded: number;
  names: string[];
  /** "Oct 11, 2026" — the desk's clock */
  dateLabel: string;
}

export interface CardInputs {
  now: number;
  saved: readonly AuctionLot[];
  metaFor: (lotId: string) => SavedMeta | null;
  follows: readonly Follow[];
  record: { n: number; med: number | null };
  graded: number;
}

export function cardNumbersOf(input: CardInputs): CardNumbers {
  const today = dayOf(input.now);
  const live = input.saved.filter(l => isOnBlock(l, today, input.now));
  let watchingUsd = 0, priced = 0;
  for (const l of live) {
    const lo = l.estimateLow || l.estimateHigh || 0;
    const hi = l.estimateHigh || l.estimateLow || 0;
    if (lo > 0 || hi > 0) { watchingUsd += (lo + hi) / 2; priced++; }
  }
  // the names: most-saved first, then most recently saved
  const tally = new Map<string, { n: number; last: string }>();
  for (const l of input.saved) {
    const name = displayMakerOf(l)?.name;
    if (!name) continue;
    const at = input.metaFor(l.id)?.savedAt ?? '';
    const t = tally.get(name) ?? { n: 0, last: '' };
    t.n++; if (at > t.last) t.last = at;
    tally.set(name, t);
  }
  let names = Array.from(tally.entries())
    .sort((a, b) => b[1].n - a[1].n || (b[1].last > a[1].last ? 1 : b[1].last < a[1].last ? -1 : 0) || a[0].localeCompare(b[0]))
    .slice(0, 3).map(([name]) => name);
  if (!names.length) names = input.follows.filter(f => f.kind !== 'house').slice(0, 3).map(f => f.label);
  const d = new Date(input.now);
  const dateLabel = `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  return { watchingUsd, watchingLots: live.length, watchingPriced: priced, record: input.record, graded: input.graded, names, dateLabel };
}

export interface CardLines {
  /** "Watching $412K" split: the word and the figure */
  headline: { word: string; figure: string };
  sub: string;
  /** null under EDGE_MIN_N graded calls — the card says so instead */
  record: { figure: string; tone: 'up' | 'down' | 'ink'; rest: string } | null;
  recordNote: string | null;
  names: string[];
  foot: string;
}

/** every string the card prints — the drawing is a thin layer over this */
export function cardLines(n: CardNumbers): CardLines {
  const lots = `${n.watchingLots} ${n.watchingLots === 1 ? 'lot' : 'lots'} to the hammer`;
  const sub = n.watchingLots === 0
    ? 'nothing on the block'
    : n.watchingPriced > 0
      ? `${lots} · ${n.watchingPriced} of ${n.watchingLots} priced, at estimate midpoint`
      : `${lots} · none priced yet`;
  const recordOk = n.graded >= EDGE_MIN_N && n.record.med != null;
  const med = n.record.med == null ? 0 : Math.round(n.record.med);
  return {
    headline: { word: 'Watching', figure: n.watchingLots === 0 || n.watchingUsd <= 0 ? '—' : fmtFace(n.watchingUsd) },
    sub,
    record: recordOk ? {
      figure: fmtSignedPct(med),
      tone: med > 0 ? 'up' : med < 0 ? 'down' : 'ink',
      rest: `vs estimate · ${n.record.n} judged · ${n.graded} ${n.graded === 1 ? 'call' : 'calls'} graded`,
    } : null,
    recordNote: recordOk ? null
      : n.graded === 0 ? 'no calls graded yet'
        : `${n.graded} ${n.graded === 1 ? 'call' : 'calls'} graded · the record prints at ${EDGE_MIN_N}`,
    names: n.names,
    foot: `lectr.bid · ${n.dateLabel} · rendered on this device`,
  };
}

export interface DrawOpts {
  /** the page's Inter family string (from --font-inter), e.g. "'__Inter_x', …" */
  fontFamily: string;
  wordmark: CanvasImageSource | null;
}

/** paint the card onto a 1200×630 canvas context (no state; call again to
 *  redraw). Fonts must already be loaded (document.fonts.load) by the caller. */
export function drawDeskCard(ctx: CanvasRenderingContext2D, lines: CardLines, opts: DrawOpts): void {
  const W = CARD_W, H = CARD_H, X = 72;
  const font = (weight: number, px: number) => `${weight} ${px}px ${opts.fontFamily}`;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = CARD_INK.ground;
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'alphabetic';

  // wordmark top-left (lectr ink script, /brand/lectr-ink-lg.png 411×264)
  if (opts.wordmark) {
    const h = 58, w = Math.round(h * 411 / 264);
    ctx.drawImage(opts.wordmark, X, 54, w, h);
  } else {
    ctx.fillStyle = CARD_INK.ink; ctx.font = font(500, 34); ctx.textAlign = 'left';
    ctx.fillText('lectr', X, 98);
  }
  // the desk's date, top-right
  ctx.fillStyle = CARD_INK.muted; ctx.font = font(400, 22); ctx.textAlign = 'right';
  ctx.fillText('The desk', W - X, 82);
  ctx.textAlign = 'left';

  // the headline: a quiet word, then the figure — impact through lightness
  ctx.fillStyle = CARD_INK.muted; ctx.font = font(400, 28);
  ctx.fillText(lines.headline.word, X, 214);
  ctx.fillStyle = CARD_INK.ink; ctx.font = font(300, 124);
  ctx.fillText(lines.headline.figure, X - 4, 328);
  ctx.fillStyle = CARD_INK.muted; ctx.font = font(400, 24);
  ctx.fillText(lines.sub, X, 372);

  // the record line, gated — or why it is absent
  const y = 444;
  if (lines.record) {
    ctx.fillStyle = CARD_INK.muted; ctx.font = font(400, 22);
    ctx.fillText('Record', X, y - 32);
    ctx.font = font(400, 44);
    ctx.fillStyle = lines.record.tone === 'up' ? CARD_INK.up : lines.record.tone === 'down' ? CARD_INK.down : CARD_INK.ink;
    ctx.fillText(lines.record.figure, X, y + 10);
    const w = ctx.measureText(lines.record.figure).width;
    ctx.fillStyle = CARD_INK.ink; ctx.font = font(400, 24);
    ctx.fillText(lines.record.rest, X + w + 18, y + 10);
  } else if (lines.recordNote) {
    ctx.fillStyle = CARD_INK.muted; ctx.font = font(400, 22);
    ctx.fillText('Record', X, y - 32);
    ctx.font = font(400, 24);
    ctx.fillText(lines.recordNote, X, y + 10);
  }

  // the names — a column beside the headline figure (the figure runs to
  // ~480px at its widest; the column starts at 720)
  if (lines.names.length) {
    const nx = 720;
    ctx.fillStyle = CARD_INK.muted; ctx.font = font(400, 22);
    ctx.fillText('Your names', nx, 214);
    ctx.fillStyle = CARD_INK.ink; ctx.font = font(400, 30);
    let ty = 256;
    for (const name of lines.names) {
      let s = name;
      while (s.length > 2 && ctx.measureText(s).width > W - X - nx) s = s.slice(0, -2).trimEnd() + '…';
      ctx.fillText(s, nx, ty);
      ty += 40;
    }
  }

  // the foot: hairline + provenance
  ctx.strokeStyle = CARD_INK.hairline; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(X, H - 72); ctx.lineTo(W - X, H - 72); ctx.stroke();
  ctx.fillStyle = CARD_INK.muted; ctx.font = font(400, 18);
  ctx.fillText(lines.foot, X, H - 40);
  ctx.restore();
}
