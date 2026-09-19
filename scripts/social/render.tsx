/**
 * The cards — composed on the site's north-star grammar (docs/NORTHSTAR_UI.md)
 * and the feed's own physics:
 *
 *   SURVIVES AT ¼   a card is 300px wide in the grid: one picture, one
 *                   number, one line. Everything else lives in the caption.
 *   AN ITEM, ALWAYS the photograph leads on a lot post; the market posts carry
 *                   a strip of the pieces they describe. Never a text-only
 *                   card when an object exists.
 *   FOUR SHAPES     call = photo over cell · receipt = cell over photo, a
 *                   ledger slip · index = full-bleed line, strip beneath ·
 *                   record = ink cell, strip beneath. A follower tells them
 *                   apart without reading.
 *   DRAWN, NOT SAID the gap is two bars to scale; the receipt is two marks on
 *                   a rail with the ±30% band actually drawn; the index line
 *                   is labelled at both ends.
 *   THE FRAME       hairlines, rules to the edge, crop marks — a plate in a
 *                   catalogue, with a gold folio number: the one sanctioned
 *                   use of the accent.
 *   LIGHTNESS       Inter 300 for every large figure, never bold; kickers in
 *                   sentence case.
 *
 *   ig 1080 × 1350   x 1200 × 675   → public/social/<date>-<type>-{ig,x}.jpg
 */

import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { ImageResponse } from 'next/og';
// @ts-expect-error pngjs ships no types; only sync.read is used
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';
import { loadData, pickTonight, rememberFlags, imageDataUri, money, signed, whenLabel, marketLabel, marketPhotos, recordPhotos, OUT, Post, PostType, FlagMemory, Thumb } from './lib';
import { getJson, putJson } from './r2';
import { writeCopy, headline } from './copy';

// ── palette ─────────────────────────────────────────────────────────────────
const EGG = '#FDFCFC', CREAM = '#F5F3F1', INK = '#1C1917', INK2 = '#59544F', MUTED = '#777169', GOLD = '#8F6B1E';
const HAIR = 'rgba(28,25,23,0.18)';
const CELL = { up: ['#1F4A2C', '#08170D'], down: ['#4E2016', '#170705'], ink: ['#34302B', '#0F0D0B'] } as const;
const ON = '#FDFCFC', ON2 = 'rgba(253,252,252,0.72)', ON3 = 'rgba(253,252,252,0.42)', ON_HAIR = 'rgba(253,252,252,0.16)', ON_BAND = 'rgba(253,252,252,0.10)';
const BRICK = '#E07A63', LEAF = '#7CCB9A';

const FONT_DIR = path.join(__dirname, 'fonts');
const woff = (f: string) => fs.readFileSync(path.join(FONT_DIR, f));
const fonts = [
  { name: 'Inter', data: woff('Inter-300.woff'), weight: 300 as const, style: 'normal' as const },
  { name: 'Inter', data: woff('Inter-400.woff'), weight: 400 as const, style: 'normal' as const },
  { name: 'Inter', data: woff('Inter-500.woff'), weight: 500 as const, style: 'normal' as const },
  { name: 'Plex', data: woff('IBMPlexMono-400.woff'), weight: 400 as const, style: 'normal' as const },
  { name: 'Plex', data: woff('IBMPlexMono-500.woff'), weight: 500 as const, style: 'normal' as const },
];
const MARK_INK = 'data:image/png;base64,' + fs.readFileSync(path.join(process.cwd(), 'public', 'brand', 'lectr-ink-lg.png')).toString('base64');

type Size = { w: number; h: number; pad: number; tall: boolean };
const SIZES: Record<'ig' | 'x', Size> = { ig: { w: 1080, h: 1350, pad: 72, tall: true }, x: { w: 1200, h: 675, pad: 60, tall: false } };

const F = { display: 'flex' } as const;
const mono = (size: number, weight: 400 | 500 = 400, color = INK): React.CSSProperties => ({ ...F, fontFamily: 'Plex', fontSize: size, fontWeight: weight, color, letterSpacing: -0.3 });
const sans = (size: number, weight: 300 | 400 | 500 = 400, color = INK): React.CSSProperties => ({ ...F, fontFamily: 'Inter', fontSize: size, fontWeight: weight, color, letterSpacing: size >= 60 ? size * -0.035 : size >= 28 ? -0.9 : -0.1, lineHeight: 1.08 });

// ── the chrome ──────────────────────────────────────────────────────────────
function Frame({ s, rules, dark = [] }: { s: Size; rules: number[]; dark?: [number, number][] }) {
  const onDark = (y: number) => dark.some(([a, b]) => y > a && y < b);
  return (
    <>
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: s.pad, width: 1, background: HAIR }} />
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: s.w - s.pad, width: 1, background: HAIR }} />
      {rules.map((y, i) => <div key={`r${i}`} style={{ position: 'absolute', top: y, left: 0, right: 0, height: 1, background: onDark(y) ? ON_HAIR : HAIR }} />)}
      {rules.flatMap((y, i) => [s.pad, s.w - s.pad].map((x, j) => (
        <div key={`d${i}${j}`} style={{ position: 'absolute', top: y - 3, left: x - 3, width: 7, height: 7, background: onDark(y) ? ON : INK, opacity: 0.55 }} />
      )))}
    </>
  );
}
const HEAD = (s: Size) => (s.tall ? 124 : 96);
const FOOT = (s: Size) => (s.tall ? 64 : 54);
function Head({ s, kicker }: { s: Size; kicker: string }) {
  return (
    <div style={{ position: 'absolute', top: 0, left: s.pad, width: s.w - s.pad * 2, height: HEAD(s), ...F, alignItems: 'center', justifyContent: 'space-between', padding: `0 ${s.tall ? 28 : 24}px` }}>
      <img src={MARK_INK} width={s.tall ? 100 : 84} height={s.tall ? 64 : 54} alt="" />
      <div style={sans(s.tall ? 20 : 17, 400, INK2)}>{kicker}</div>
    </div>
  );
}
function Foot({ s, folio }: { s: Size; folio: string }) {
  return (
    <div style={{ position: 'absolute', bottom: 0, left: s.pad, width: s.w - s.pad * 2, height: FOOT(s), ...F, alignItems: 'center', justifyContent: 'space-between', padding: `0 ${s.tall ? 28 : 24}px` }}>
      <div style={mono(s.tall ? 18 : 15, 400, MUTED)}>lectr.bid</div>
      <div style={mono(s.tall ? 16 : 14, 500, GOLD)}>{folio}</div>
    </div>
  );
}
function Plate({ src, x, y, w, h, inset = 26 }: { src: string; x: number; y: number; w: number; h: number; inset?: number }) {
  return (
    <div style={{ position: 'absolute', top: y, left: x, width: w, height: h, background: CREAM, ...F, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      <img src={src} style={{ objectFit: 'contain', maxWidth: w - inset * 2, maxHeight: h - inset * 2 }} alt="" />
    </div>
  );
}
function Cell({ dir, x, y, w, h, children }: { dir: keyof typeof CELL; x: number; y: number; w: number; h: number; children: React.ReactNode }) {
  const [a, b] = CELL[dir];
  return <div style={{ position: 'absolute', top: y, left: x, width: w, height: h, background: `linear-gradient(180deg, ${a} 0%, ${b} 100%)`, ...F, flexDirection: 'column' }}>{children}</div>;
}

/** the strip: four pieces on cream plates, maker + one fact beneath each */
function Strip({ thumbs, x, y, w, h, s }: { thumbs: { t: Thumb; src: string | null }[]; x: number; y: number; w: number; h: number; s: Size }) {
  const n = Math.max(1, thumbs.length), gap = 1;
  const cw = Math.floor((w - gap * (n - 1)) / n);
  const capH = s.tall ? 62 : 48;
  return (
    <div style={{ position: 'absolute', top: y, left: x, width: w, height: h, ...F, gap }}>
      {thumbs.map(({ t, src }, i) => (
        <div key={t.id} style={{ ...F, flexDirection: 'column', width: i === n - 1 ? w - (cw + gap) * (n - 1) : cw, height: h }}>
          <div style={{ ...F, flexGrow: 1, background: CREAM, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            {src && <img src={src} style={{ objectFit: 'contain', maxWidth: cw - 28, maxHeight: h - capH - 28 }} alt="" />}
          </div>
          <div style={{ ...F, flexDirection: 'column', height: capH, justifyContent: 'center', padding: '0 14px', borderLeft: i ? `1px solid ${HAIR}` : 'none' }}>
            <div style={{ ...sans(s.tall ? 16 : 13, 400, INK), whiteSpace: 'nowrap', overflow: 'hidden' }}>{t.maker}</div>
            <div style={{ ...mono(s.tall ? 14 : 12, 400, MUTED), marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden' }}>{t.line}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** the gap, drawn: two bars to scale, ask against the comps median */
function GapBars({ ask, med, w, s }: { ask: number; med: number; w: number; s: Size }) {
  const askW = Math.max(6, Math.round((w * ask) / Math.max(ask, med)));
  const hh = s.tall ? 14 : 10, lab = s.tall ? 15 : 12;
  return (
    <div style={{ ...F, flexDirection: 'column', width: w }}>
      <div style={{ ...F, alignItems: 'center', gap: 14 }}>
        <div style={{ ...F, width: askW, height: hh, background: ON3 }} />
        <div style={mono(lab, 400, ON2)}>{`ask ${money(ask)}`}</div>
      </div>
      <div style={{ ...F, alignItems: 'center', gap: 14, marginTop: 10 }}>
        <div style={{ ...F, width: w - 200, height: hh, background: ON }} />
        <div style={mono(lab, 500, ON)}>{`comps ${money(med)}`}</div>
      </div>
    </div>
  );
}

/** the receipt, drawn: the call and the hammer as two marks on a rail, with
 *  the ±30% band the record grades by actually painted */
function Rail({ call, hammer, w, s }: { call: number; hammer: number; w: number; s: Size }) {
  const lo = call * 0.7, hi = call * 1.3;
  const min = Math.min(lo, hammer) * 0.9, max = Math.max(hi, hammer) * 1.1;
  const X = (v: number) => Math.round(((v - min) / (max - min)) * w);
  const within = hammer >= lo && hammer <= hi;
  const h = s.tall ? 92 : 70, lab = s.tall ? 15 : 12;
  return (
    <div style={{ position: 'relative', width: w, height: h, ...F }}>
      <div style={{ position: 'absolute', left: X(lo), top: 0, width: X(hi) - X(lo), height: h - 30, background: ON_BAND }} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: (h - 30) / 2, height: 1, background: ON_HAIR }} />
      <div style={{ position: 'absolute', left: X(call) - 7, top: (h - 30) / 2 - 7, width: 14, height: 14, borderRadius: 7, background: ON }} />
      <div style={{ position: 'absolute', left: X(hammer) - 7, top: (h - 30) / 2 - 7, width: 14, height: 14, borderRadius: 7, background: within ? LEAF : BRICK }} />
      <div style={{ position: 'absolute', left: Math.max(0, X(call) - 40), top: h - 22, ...mono(lab, 400, ON2) }}>called</div>
      <div style={{ position: 'absolute', left: Math.min(w - 80, Math.max(X(hammer) - 44, X(call) + 60)), top: h - 22, ...mono(lab, 500, within ? LEAF : BRICK) }}>hammered</div>
      <div style={{ position: 'absolute', left: X(hi) + 10, top: 4, ...mono(lab - 2, 400, ON3) }}>±30%</div>
    </div>
  );
}

/** the index line: eggshell stroke, a faint area, both ends labelled */
function Line({ series, periods, w, h, s }: { series: number[]; periods: [string, string]; w: number; h: number; s: Size }) {
  const pts = series.filter(Number.isFinite);
  if (pts.length < 2) return null;
  const lab = s.tall ? 15 : 12, top = 30, bottom = 26;
  const min = Math.min(...pts), max = Math.max(...pts), span = max - min || 1;
  const xy = pts.map((v, i) => [(i / (pts.length - 1)) * w, top + (h - top - bottom) - ((v - min) / span) * (h - top - bottom)] as const);
  const d = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const [ex, ey] = xy[xy.length - 1];
  return (
    <div style={{ position: 'relative', width: w, height: h, ...F }}>
      <svg width={w} height={h} style={{ position: 'absolute', top: 0, left: 0 }}>
        <polygon points={`0,${h - bottom} ${d} ${w},${h - bottom}`} fill="rgba(253,252,252,0.08)" />
        <polyline points={d} fill="none" stroke={ON} strokeWidth={s.tall ? 3.5 : 3} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={ex} cy={ey} r={s.tall ? 8 : 6} fill={ON} />
      </svg>
      <div style={{ position: 'absolute', left: 0, top: h - 18, ...mono(lab, 400, ON3) }}>{periods[0]}</div>
      <div style={{ position: 'absolute', right: 0, top: h - 18, ...mono(lab, 400, ON3) }}>{periods[1]}</div>
      {/* the endpoint's value sits in the plot's top-left gutter — the line
          climbs to the right, so the left is the one reliably empty corner */}
      <div style={{ position: 'absolute', left: 0, top: 0, ...mono(lab, 400, ON3) }}>{`index ${Math.round(pts[pts.length - 1])} · base 100 at ${periods[0]}`}</div>
    </div>
  );
}

/** The abstention's picture: a zero axis with the unresolved interval laid
 *  across it. When the reason carries a CI, the bar is drawn to those bounds
 *  and you can see it straddle zero — the whole argument, in one mark. */
function NullPlot({ reason, w, h, s }: { reason: string; w: number; h: number; s: Size }) {
  const m = reason.match(/\(?(-?\d+(?:\.\d+)?)%\s*(?:…|\.\.\.|to)\s*(-?\d+(?:\.\d+)?)%/);
  const lab = s.tall ? 15 : 12;
  const mid = Math.round(h / 2);
  if (!m) {
    return (
      <div style={{ position: 'relative', width: w, height: h, ...F }}>
        <div style={{ position: 'absolute', left: 0, top: mid, width: w, height: 1, background: ON_HAIR }} />
        <div style={{ position: 'absolute', left: 0, top: mid + 12, ...mono(lab, 400, ON3) }}>no publishable estimate</div>
      </div>
    );
  }
  const lo = parseFloat(m[1]), hi = parseFloat(m[2]);
  const span = Math.max(Math.abs(lo), Math.abs(hi)) * 1.25 || 1;
  const X = (v: number) => Math.round(((v + span) / (span * 2)) * w);
  const zero = X(0), x0 = Math.min(X(lo), zero), x1 = Math.max(X(hi), zero);
  return (
    <div style={{ position: 'relative', width: w, height: h, ...F }}>
      <div style={{ position: 'absolute', left: x0, top: mid - 9, width: x1 - x0, height: 18, background: ON_BAND }} />
      <div style={{ position: 'absolute', left: x0, top: mid - 1, width: x1 - x0, height: 2, background: ON2 }} />
      <div style={{ position: 'absolute', left: zero - 1, top: 0, width: 2, height: h - 22, background: ON }} />
      <div style={{ position: 'absolute', left: Math.max(0, zero - 14), top: h - 20, ...mono(lab, 500, ON) }}>zero</div>
      <div style={{ position: 'absolute', left: x0, top: mid - 34, ...mono(lab, 400, ON3) }}>{`${lo}%`}</div>
      <div style={{ position: 'absolute', left: Math.max(0, x1 - 50), top: mid - 34, ...mono(lab, 400, ON3) }}>{`+${hi}%`}</div>
    </div>
  );
}

// ── the four shapes ─────────────────────────────────────────────────────────
interface Assets { photo: string | null; strip: { t: Thumb; src: string | null }[]; periods: [string, string]; folio: string; date: string }

function Card({ p, s, a }: { p: Post; s: Size; a: Assets }) {
  const W = s.w, H = s.h, pad = s.pad, inner = W - pad * 2, headH = HEAD(s), footH = FOOT(s);
  const ground = { ...F, width: W, height: H, background: EGG, position: 'relative' as const, fontFamily: 'Inter' };
  const px = 28;
  const head = headline(p);

  // ── CALL: photograph over the cell ──────────────────────────────────────
  if (p.type === 'call') {
    const kicker = `Tonight's call · ${a.date}`;
    const sub = `${p.maker} · ${p.title}`;
    if (s.tall) {
      const plateY = headH, plateH = a.photo ? 590 : 0;
      const titleY = plateY + plateH, titleH = 160;
      const cellY = titleY + titleH, cellH = H - footH - cellY;
      return (
        <div style={ground}>
          {a.photo && <Plate src={a.photo} x={pad + 1} y={plateY + 1} w={inner - 1} h={plateH - 1} />}
          <div style={{ position: 'absolute', top: titleY, left: pad, width: inner, height: titleH, ...F, flexDirection: 'column', justifyContent: 'center', padding: `0 ${px}px` }}>
            <div style={sans(40, 300, INK)}>{head}</div>
            <div style={{ ...sans(20, 400, INK2), marginTop: 12, whiteSpace: 'nowrap', overflow: 'hidden' }}>{sub}</div>
          </div>
          <Cell dir="up" x={pad + 1} y={cellY + 1} w={inner - 1} h={cellH - 1}>
            <div style={{ ...F, alignItems: 'flex-end', justifyContent: 'space-between', padding: `24px ${px}px 0` }}>
              <div style={{ ...sans(176, 300, ON), lineHeight: 0.9, marginLeft: -6 }}>{p.multiple}</div>
              <div style={{ ...sans(19, 400, ON2), paddingBottom: 14 }}>{`the ask, at the comps · ${p.basis} sales`}</div>
            </div>
            <div style={{ ...F, flexDirection: 'column', padding: `18px ${px}px 0`, flexGrow: 1, justifyContent: 'center' }}>
              <GapBars ask={p.askUsd} med={p.med} w={inner - px * 2 - 2} s={s} />
            </div>
            <div style={{ ...F, justifyContent: 'space-between', padding: `0 ${px}px 20px` }}>
              <div style={mono(17, 400, ON3)}>hammers</div>
              <div style={mono(20, 500, ON)}>{`${whenLabel(p.closes)} · ${p.lot.auctionHouse}`}</div>
            </div>
          </Cell>
          <Head s={s} kicker={kicker} /><Foot s={s} folio={a.folio} />
          <Frame s={s} rules={[headH, ...(a.photo ? [titleY] : []), cellY, H - footH]} dark={[[cellY, H - footH]]} />
        </div>
      );
    }
    const bodyY = headH, bodyH = H - footH - headH, plateW = a.photo ? Math.round(inner * 0.46) : 0;
    return (
      <div style={ground}>
        {a.photo && <Plate src={a.photo} x={pad + 1} y={bodyY + 1} w={plateW - 1} h={bodyH - 1} />}
        <Cell dir="up" x={pad + plateW + 1} y={bodyY + 1} w={inner - plateW - 1} h={bodyH - 1}>
          <div style={{ ...F, flexDirection: 'column', padding: `22px ${px}px 0` }}>
            <div style={sans(27, 300, ON)}>{head}</div>
            <div style={{ ...sans(15, 400, ON2), marginTop: 8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: inner - plateW - px * 2 }}>{sub}</div>
          </div>
          <div style={{ ...F, flexDirection: 'column', padding: `8px ${px}px 0`, flexGrow: 1, justifyContent: 'center' }}>
            <div style={{ ...sans(132, 300, ON), lineHeight: 0.9, marginLeft: -5 }}>{p.multiple}</div>
            <div style={{ ...F, marginTop: 16 }}><GapBars ask={p.askUsd} med={p.med} w={inner - plateW - px * 2 - 2} s={s} /></div>
          </div>
          <div style={{ ...F, justifyContent: 'space-between', padding: `0 ${px}px 16px` }}>
            <div style={mono(13, 400, ON3)}>hammers</div>
            <div style={mono(16, 500, ON)}>{`${whenLabel(p.closes)} · ${p.lot.auctionHouse}`}</div>
          </div>
        </Cell>
        <Head s={s} kicker={kicker} /><Foot s={s} folio={a.folio} />
        <Frame s={s} rules={[headH, H - footH]} />
      </div>
    );
  }

  // ── RECEIPT: the ledger slip — cell on top, photograph beneath ──────────
  if (p.type === 'receipt') {
    const dir: keyof typeof CELL = p.hit ? 'up' : 'down';
    const kicker = `The receipt · ${a.date}`;
    const verdict = p.hit ? 'within the ±30% band the record grades by' : 'outside the ±30% band · missed';
    const sub = `${p.maker} · ${p.title}`;
    if (s.tall) {
      const cellY = headH;
      const titleH = 110;
      // with a photograph the slip is cell → plate → caption; without one the
      // cell simply runs down to the caption rather than leaving a hole
      const cellH = a.photo ? 560 : H - footH - titleH - cellY;
      const plateY = cellY + cellH, plateH = a.photo ? 450 : 0;
      const titleY = plateY + plateH;
      return (
        <div style={ground}>
          <Cell dir={dir} x={pad + 1} y={cellY + 1} w={inner - 1} h={cellH - 1}>
            <div style={{ ...F, flexDirection: 'column', padding: `26px ${px}px 0` }}>
              <div style={sans(40, 300, ON)}>{head}</div>
              <div style={{ ...sans(19, 400, ON2), marginTop: 10 }}>{verdict}</div>
            </div>
            {/* with a plate below, the figure hangs from the cell's floor;
                without one it centres, so the slip never opens a hole */}
            <div style={{ ...F, flexDirection: 'column', justifyContent: a.photo ? 'flex-end' : 'center', flexGrow: 1, padding: `10px ${px}px 0` }}>
              <div style={{ ...F, alignItems: 'flex-end', justifyContent: 'space-between' }}>
                <div style={{ ...sans(176, 300, ON), lineHeight: 0.9, marginLeft: -6 }}>{signed(p.deltaPct)}</div>
                <div style={{ ...sans(18, 400, ON2), paddingBottom: 14 }}>{`hammer vs the call · ${whenLabel(p.row.sd || p.row.d)}`}</div>
              </div>
            </div>
            <div style={{ ...F, padding: `10px ${px}px 22px` }}>
              <Rail call={p.row.p} hammer={p.row.r} w={inner - px * 2 - 2} s={s} />
            </div>
          </Cell>
          {a.photo && <Plate src={a.photo} x={pad + 1} y={plateY + 1} w={inner - 1} h={plateH - 1} inset={20} />}
          <div style={{ position: 'absolute', top: titleY, left: pad, width: inner, height: titleH, ...F, alignItems: 'center', justifyContent: 'space-between', padding: `0 ${px}px` }}>
            <div style={{ ...sans(19, 400, INK), whiteSpace: 'nowrap', overflow: 'hidden', maxWidth: inner - 300, textOverflow: 'ellipsis' }}>{sub}</div>
            <div style={{ ...mono(17, 500, INK), flexShrink: 0 }}>{p.row.h || p.lot?.auctionHouse || ''}</div>
          </div>
          <Head s={s} kicker={kicker} /><Foot s={s} folio={a.folio} />
          <Frame s={s} rules={[headH, plateY, ...(a.photo ? [titleY] : []), H - footH]} dark={[[cellY, plateY]]} />
        </div>
      );
    }
    const bodyY = headH, bodyH = H - footH - headH, plateW = a.photo ? Math.round(inner * 0.40) : 0;
    return (
      <div style={ground}>
        <Cell dir={dir} x={pad + 1} y={bodyY + 1} w={inner - plateW - 1} h={bodyH - 1}>
          <div style={{ ...F, flexDirection: 'column', padding: `22px ${px}px 0` }}>
            <div style={sans(27, 300, ON)}>{head}</div>
            <div style={{ ...sans(15, 400, ON2), marginTop: 8 }}>{verdict}</div>
          </div>
          <div style={{ ...F, flexDirection: 'column', padding: `6px ${px}px 0`, flexGrow: 1, justifyContent: 'center' }}>
            <div style={{ ...sans(132, 300, ON), lineHeight: 0.9, marginLeft: -5 }}>{signed(p.deltaPct)}</div>
            <div style={{ ...F, marginTop: 14 }}><Rail call={p.row.p} hammer={p.row.r} w={inner - plateW - px * 2 - 2} s={s} /></div>
          </div>
          <div style={{ ...F, justifyContent: 'space-between', padding: `0 ${px}px 16px` }}>
            <div style={{ ...sans(14, 400, ON2), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: inner - plateW - px * 2 - 130 }}>{sub}</div>
            <div style={{ ...mono(14, 500, ON), flexShrink: 0 }}>{p.row.h || ''}</div>
          </div>
        </Cell>
        {a.photo && <Plate src={a.photo} x={pad + inner - plateW + 1} y={bodyY + 1} w={plateW - 1} h={bodyH - 1} inset={20} />}
        <Head s={s} kicker={kicker} /><Foot s={s} folio={a.folio} />
        <Frame s={s} rules={[headH, H - footH]} />
      </div>
    );
  }

  // ── INDEX / RECORD: the cell is the picture, the strip is the proof ─────
  const isIndex = p.type === 'index';
  if (p.type === 'board' || p.type === 'abstain') return <Wide p={p} s={s} a={a} />;
  const dir: keyof typeof CELL = isIndex ? (p.changePct >= 0 ? 'up' : 'down') : 'ink';
  const kicker = `${isIndex ? 'The index' : 'The record, replayed'} · ${a.date}`;
  const hasStrip = a.strip.length > 0;
  const cellY = headH;
  const cellH = s.tall ? (hasStrip ? (isIndex ? 760 : 620) : H - footH - headH) : H - footH - headH;
  const stripY = cellY + cellH, stripH = s.tall && hasStrip ? H - footH - stripY : 0;
  const rules = s.tall && hasStrip ? [headH, stripY, H - footH] : [headH, H - footH];
  const bigPx = s.tall ? 150 : 104;
  const sub = isIndex
    ? `${p.method === 'repeat-sale' ? 'repeat-sale index' : 'hedonic index'} · ${p.basis} · 95% interval ${signed(p.ciLo)} to ${signed(p.ciHi)} · ${p.n.toLocaleString()} ${p.nLabel}`
    : `median over estimate, flagged vs not · ${p.beatHighPct}% beat the high estimate · ${p.failToSellPct}% failed to sell · as of ${p.asOf}`;

  return (
    <div style={ground}>
      <Cell dir={dir} x={pad + 1} y={cellY + 1} w={inner - 1} h={cellH - 1}>
        <div style={{ ...F, flexDirection: 'column', padding: `${s.tall ? 26 : 18}px ${px}px 0` }}>
          <div style={sans(s.tall ? 40 : 27, 300, ON)}>{head}</div>
          <div style={{ ...sans(s.tall ? 17 : 13, 400, ON2), marginTop: 10, lineHeight: 1.35 }}>{sub}</div>
        </div>
        {isIndex ? (
          <div style={{ ...F, flexDirection: 'column', padding: `${s.tall ? 26 : 10}px ${px}px ${s.tall ? 24 : 12}px`, flexGrow: 1, justifyContent: 'flex-end' }}>
            <Line series={p.series} periods={a.periods} w={inner - px * 2 - 2} h={s.tall ? 360 : 200} s={s} />
          </div>
        ) : (
          <div style={{ ...F, flexDirection: 'column', justifyContent: 'center', flexGrow: 1, padding: `0 ${px}px ${s.tall ? 20 : 12}px` }}>
            <div style={{ ...F, alignItems: 'flex-end', gap: s.tall ? 44 : 34 }}>
              <div style={{ ...F, flexDirection: 'column' }}>
                <div style={{ ...sans(s.tall ? 200 : bigPx, 300, ON), lineHeight: 0.9, marginLeft: -6 }}>{signed(p.flaggedMedianPct)}</div>
                <div style={{ ...sans(s.tall ? 19 : 14, 400, ON2), marginTop: 12 }}>flagged</div>
              </div>
              <div style={{ ...F, flexDirection: 'column' }}>
                <div style={{ ...sans(s.tall ? 104 : 64, 300, ON2), lineHeight: 0.9 }}>{signed(p.unflaggedMedianPct)}</div>
                <div style={{ ...sans(s.tall ? 19 : 14, 400, ON3), marginTop: 12 }}>not flagged</div>
              </div>
            </div>
          </div>
        )}
      </Cell>
      {s.tall && hasStrip && <Strip thumbs={a.strip} x={pad + 1} y={stripY + 1} w={inner - 1} h={stripH - 1} s={s} />}
      <Head s={s} kicker={kicker} /><Foot s={s} folio={a.folio} />
      <Frame s={s} rules={rules} dark={[[cellY, stripY || H - footH]]} />
    </div>
  );
}

/** THE BOARD — the desk in one frame. Six photographed flags in a grid, each
 *  with its multiple; the whole market's flag count on the cell above. This is
 *  the most feed-native thing the desk makes: every tile is an object.
 *  THE ABSTENTION — what the desk refuses to publish, in the engine's own
 *  words. The empty plot IS the picture. */
function Wide({ p, s, a }: { p: Extract<Post, { type: 'board' | 'abstain' }>; s: Size; a: Assets }) {
  const W = s.w, H = s.h, pad = s.pad, inner = W - pad * 2, headH = HEAD(s), footH = FOOT(s);
  const ground = { ...F, width: W, height: H, background: EGG, position: 'relative' as const, fontFamily: 'Inter' };
  const px = 28;

  if (p.type === 'abstain') {
    // the abstention still shows the market it is refusing to price — an item
    // always, even when the post is about the absence of a number
    const hasStrip = s.tall && a.strip.length > 0;
    const cellY = headH, cellH = hasStrip ? 720 : H - footH - cellY;
    const stripY = cellY + cellH, stripH = hasStrip ? H - footH - stripY : 0;
    return (
      <div style={ground}>
        <Cell dir="ink" x={pad + 1} y={cellY + 1} w={inner - 1} h={cellH - 1}>
          <div style={{ ...F, flexDirection: 'column', padding: `${s.tall ? 28 : 20}px ${px}px 0` }}>
            <div style={sans(s.tall ? 38 : 26, 300, ON)}>{headline(p)}</div>
            <div style={{ ...sans(s.tall ? 17 : 13, 400, ON2), marginTop: 10 }}>{`hedonic index · ${marketLabel(p.market)} · ${p.horizon}`}</div>
          </div>
          {/* the empty plot IS the picture: the axis the number would have sat
              on, the interval that failed to resolve drawn across zero, and
              the engine's own sentence beneath it */}
          <div style={{ ...F, flexDirection: 'column', justifyContent: 'center', flexGrow: 1, padding: `0 ${px}px` }}>
            <NullPlot reason={p.reason} w={inner - px * 2 - 2} h={s.tall ? 150 : 96} s={s} />
            <div style={{ ...sans(s.tall ? 32 : 20, 300, ON), marginTop: s.tall ? 30 : 18, lineHeight: 1.3 }}>{p.reason}</div>
          </div>
          <div style={{ ...F, justifyContent: 'space-between', alignItems: 'flex-end', padding: `0 ${px}px ${s.tall ? 24 : 16}px` }}>
            <div style={{ ...sans(s.tall ? 18 : 14, 400, ON3), maxWidth: inner - px * 2 - 220 }}>
              {p.published ? `${marketLabel(p.market)} does publish at ${p.published.horizon}` : 'no horizon clears the bar today'}
            </div>
            {p.published && <div style={mono(s.tall ? 30 : 22, 500, ON)}>{signed(p.published.changePct, 1)}</div>}
          </div>
        </Cell>
        {hasStrip && <Strip thumbs={a.strip} x={pad + 1} y={stripY + 1} w={inner - 1} h={stripH - 1} s={s} />}
        <Head s={s} kicker={`What we won't publish · ${a.date}`} /><Foot s={s} folio={a.folio} />
        <Frame s={s} rules={hasStrip ? [headH, stripY, H - footH] : [headH, H - footH]} dark={[[cellY, stripY || H - footH]]} />
      </div>
    );
  }

  // the board
  const cols = s.tall ? 2 : 3, rows = Math.ceil(Math.min(p.lots.length, s.tall ? 6 : 3) / cols);
  const cellY = headH, cellH = s.tall ? 230 : 150;
  const gridY = cellY + cellH, gridH = H - footH - gridY;
  const tileW = Math.floor((inner - (cols - 1)) / cols), tileH = Math.floor((gridH - (rows - 1)) / rows);
  const capH = s.tall ? 92 : 74;
  const shown = p.lots.slice(0, cols * rows);
  return (
    <div style={ground}>
      <Cell dir="up" x={pad + 1} y={cellY + 1} w={inner - 1} h={cellH - 1}>
        <div style={{ ...F, flexDirection: 'column', justifyContent: 'center', flexGrow: 1, padding: `0 ${px}px` }}>
          <div style={{ ...F, alignItems: 'baseline', justifyContent: 'space-between' }}>
            <div style={{ ...sans(s.tall ? 92 : 62, 300, ON), lineHeight: 0.92, marginLeft: -4 }}>{p.liveCount.toLocaleString()}</div>
            <div style={{ ...sans(s.tall ? 19 : 15, 400, ON2), textAlign: 'right' }}>{`one per maker · ${shown.length} shown`}</div>
          </div>
          <div style={{ ...sans(s.tall ? 21 : 16, 400, ON2), marginTop: 10 }}>lots on the block priced under their comparable sales</div>
        </div>
      </Cell>
      {shown.map((it, i) => {
        const cx = pad + 1 + (i % cols) * (tileW + 1), cy = gridY + 1 + Math.floor(i / cols) * (tileH + 1);
        const src = a.strip[i]?.src || null;
        return (
          <div key={it.lot.id} style={{ position: 'absolute', top: cy, left: cx, width: tileW - 1, height: tileH - 1, ...F, flexDirection: 'column' }}>
            <div style={{ ...F, flexGrow: 1, background: CREAM, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              {src && <img src={src} style={{ objectFit: 'contain', maxWidth: tileW - 44, maxHeight: tileH - capH - 36 }} alt="" />}
            </div>
            <div style={{ ...F, height: capH, alignItems: 'center', justifyContent: 'space-between', padding: `0 ${s.tall ? 20 : 14}px` }}>
              <div style={{ ...F, flexDirection: 'column', minWidth: 0 }}>
                <div style={{ ...sans(s.tall ? 19 : 15, 400, INK), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: tileW - 150 }}>{it.maker}</div>
                <div style={{ ...mono(s.tall ? 14 : 12, 400, MUTED), marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: tileW - 150 }}>{`${it.lot.auctionHouse} · ${whenLabel(it.closes)}`}</div>
              </div>
              <div style={{ ...sans(s.tall ? 34 : 26, 300, INK), flexShrink: 0 }}>{it.multiple}</div>
            </div>
          </div>
        );
      })}
      <Head s={s} kicker={`The board · ${a.date}`} /><Foot s={s} folio={a.folio} />
      <Frame s={s} rules={[headH, gridY, H - footH]} dark={[[cellY, gridY]]} />
    </div>
  );
}

// ── render + grain + encode ─────────────────────────────────────────────────
function grain(png: { data: Buffer; width: number; height: number }) {
  const d = png.data; let seed = 0x9e3779b9;
  const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return ((seed >>> 0) % 1000) / 1000; };
  for (let i = 0; i < d.length; i += 4) {
    const luma = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    const amp = luma < 90 ? 15 : luma > 235 ? 4 : 6;
    const n = Math.round((rnd() - 0.5) * 2 * amp);
    d[i] = Math.max(0, Math.min(255, d[i] + n)); d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n)); d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
}
async function renderJpeg(node: React.ReactElement, s: Size): Promise<Buffer> {
  const res = new ImageResponse(node, { width: s.w, height: s.h, fonts });
  const png = PNG.sync.read(Buffer.from(await res.arrayBuffer()));
  grain(png);
  return jpeg.encode({ data: png.data, width: png.width, height: png.height }, 92).data;
}

export async function renderTonight(opts: { force?: PostType; exclude?: Set<string> } = {}) {
  const d = loadData();
  const memory = rememberFlags(d, await getJson<FlagMemory>('flags', {}));
  await putJson('flags', memory);
  const exclude = opts.exclude || new Set<string>();
  const ledger = await getJson<{ posted: { date: string; key: string }[] }>('ledger', { posted: [] });
  const cut = new Date(Date.now() - 21 * 864e5).toISOString().slice(0, 10);
  for (const e of ledger.posted) if (e.date >= cut) exclude.add(e.key);
  const post = pickTonight(d, exclude, opts.force, memory);
  if (!post) { console.log('[social] nothing honest to post tonight — no candidate for any type'); return null; }

  const date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
  const stamp = new Date().toISOString().slice(0, 10);
  const folio = `No. ${String(ledger.posted.length + 1).padStart(3, '0')}`;

  // the pictures — an item wherever one exists, even on the market posts
  const photo = post.type === 'call' ? await imageDataUri(post.lot.imageUrl) : post.type === 'receipt' ? await imageDataUri(post.lot?.imageUrl) : null;
  const thumbs: Thumb[] = post.type === 'index' ? marketPhotos(d, post.market)
    : post.type === 'record' ? recordPhotos(d, memory)
    : post.type === 'board' ? post.lots.map(l => ({ image: l.lot.imageUrl!, maker: l.maker, line: `${l.multiple} the ask`, id: l.lot.id }))
    : post.type === 'abstain' ? marketPhotos(d, post.market)
    : [];
  const strip = (await Promise.all(thumbs.map(async t => ({ t, src: await imageDataUri(t.image, post.type === 'board' ? 800 : 600) })))).filter(x => x.src);
  let periods: [string, string] = ['', ''];
  if (post.type === 'index') {
    const src = d.market?.[post.method === 'repeat-sale' ? 'repeatSale' : 'hedonic']?.[post.market]?.series || [];
    if (src.length) periods = [src[0].period, src[src.length - 1].period];
  }
  if ((post.type === 'call' || post.type === 'receipt') && !photo) console.warn('[social] photograph unavailable — card renders without a plate');
  if ((post.type === 'index' || post.type === 'record' || post.type === 'board' || post.type === 'abstain') && !strip.length) console.warn('[social] no photographs for the strip — card renders cell-only');

  fs.mkdirSync(OUT, { recursive: true });
  const files: Record<string, string> = {};
  for (const k of ['ig', 'x'] as const) {
    const s = SIZES[k];
    const buf = await renderJpeg(<Card p={post} s={s} a={{ photo, strip, periods, folio, date }} />, s);
    const name = `${stamp}-${post.type}-${k}.jpg`;
    fs.writeFileSync(path.join(OUT, name), buf); files[k] = name;
    console.log(`[social] ${name} ${(buf.length / 1024).toFixed(0)} KB`);
  }
  const copy = writeCopy(post);
  const plan = { date: stamp, type: post.type, key: post.key, url: post.url, folio, files, publicUrls: { ig: `https://lectr.bid/social/${files.ig}`, x: `https://lectr.bid/social/${files.x}` }, copy, dataAsOf: d.meta?.lastCrawl || null };
  fs.writeFileSync(path.join(OUT, 'today.json'), JSON.stringify(plan, null, 2));
  console.log(`[social] plan → ${post.type} · ${post.key} · ${folio}`);
  console.log('\n— X —\n' + copy.x + '\n\n↳ ' + copy.xReply + '\n\n— IG —\n' + copy.ig + '\n');
  return plan;
}

if (require.main === module) {
  const force = process.argv.find(a => a.startsWith('--type='))?.slice(7) as PostType | undefined;
  renderTonight({ force }).catch(e => { console.error(e); process.exit(1); });
}
