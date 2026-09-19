/**
 * The cards — composed on the site's north-star grammar (docs/NORTHSTAR_UI.md):
 *
 *   THE FRAME    two vertical hairlines bound the sheet; every section rule
 *                runs PAST them to the card edge; a crop-mark sits at each
 *                intersection. Print-sheet grammar — a plate in a catalogue.
 *   THE CELL     one grained color cell per card forces the atmosphere
 *                (the "Omnichannel" move). Its hue is lawful: green = the lamp
 *                says up / within the band, brick = missed, ink = neutral.
 *   LIGHTNESS    the number is enormous and Inter 300, never bold. Kickers
 *                are sentence-case Inter, warm gray — never uppercase mono.
 *   THE PLATE    the photograph runs edge to edge between the hairlines and
 *                takes the top half; the feed is image-first.
 *
 * Pipeline: next/og (satori) in the site's real faces, then a pixel-static
 * grain pass over the PNG (heavier on the dark cell, faint on eggshell — the
 * CSS grain the site paints, applied by hand because satori has no filters),
 * then JPEG for Instagram.
 *
 *   ig 1080 × 1350   x 1200 × 675
 *   → public/social/<date>-<type>-{ig,x}.jpg + today.json
 */

import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { ImageResponse } from 'next/og';
// @ts-expect-error pngjs ships no types; only sync.read is used
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';
import { loadData, pickTonight, rememberFlags, imageDataUri, money, signed, whenLabel, marketLabel, OUT, Post, PostType, FlagMemory } from './lib';
import { getJson, putJson } from './r2';
import { writeCopy } from './copy';

// ── palette: the eggshell ramp, the lamp, the cell gradients ────────────────
const EGG = '#FDFCFC', CREAM = '#F5F3F1', INK = '#1C1917', INK2 = '#59544F', MUTED = '#777169';
const HAIR = 'rgba(28,25,23,0.18)';
const CELL = {
  up: ['#1F4A2C', '#08170D'],
  down: ['#4E2016', '#170705'],
  ink: ['#34302B', '#0F0D0B'],
} as const;
const ON_CELL = '#FDFCFC', ON_CELL_2 = 'rgba(253,252,252,0.72)', ON_CELL_3 = 'rgba(253,252,252,0.42)', CELL_HAIR = 'rgba(253,252,252,0.16)';

const FONT_DIR = path.join(__dirname, 'fonts');
const woff = (f: string) => fs.readFileSync(path.join(FONT_DIR, f));
const fonts = [
  { name: 'Inter', data: woff('Inter-200.woff'), weight: 200 as const, style: 'normal' as const },
  { name: 'Inter', data: woff('Inter-300.woff'), weight: 300 as const, style: 'normal' as const },
  { name: 'Inter', data: woff('Inter-400.woff'), weight: 400 as const, style: 'normal' as const },
  { name: 'Inter', data: woff('Inter-500.woff'), weight: 500 as const, style: 'normal' as const },
  { name: 'Plex', data: woff('IBMPlexMono-400.woff'), weight: 400 as const, style: 'normal' as const },
  { name: 'Plex', data: woff('IBMPlexMono-500.woff'), weight: 500 as const, style: 'normal' as const },
];
const MARK_INK = 'data:image/png;base64,' + fs.readFileSync(path.join(process.cwd(), 'public', 'brand', 'lectr-ink-lg.png')).toString('base64');

type Size = { w: number; h: number; pad: number; tall: boolean };
const SIZES: Record<'ig' | 'x', Size> = {
  ig: { w: 1080, h: 1350, pad: 72, tall: true },
  x: { w: 1200, h: 675, pad: 60, tall: false },
};

const F = { display: 'flex' } as const;
const mono = (size: number, weight: 400 | 500 = 400, color = INK): React.CSSProperties => ({ ...F, fontFamily: 'Plex', fontSize: size, fontWeight: weight, color, letterSpacing: -0.3 });
const sans = (size: number, weight: 200 | 300 | 400 | 500 = 400, color = INK): React.CSSProperties => ({ ...F, fontFamily: 'Inter', fontSize: size, fontWeight: weight, color, letterSpacing: size >= 60 ? size * -0.035 : size >= 28 ? -0.8 : -0.1, lineHeight: 1.05 });

// ── THE FRAME ───────────────────────────────────────────────────────────────
/** Vertical hairlines at the pad; horizontal rules at `rules` (y) that run to
 *  the card edge; a crop-mark at every intersection. Drawn last, above all. */
function Frame({ s, rules, dark = [] }: { s: Size; rules: number[]; dark?: [number, number][] }) {
  const onDark = (y: number) => dark.some(([a, b]) => y > a && y < b);
  return (
    <>
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: s.pad, width: 1, background: HAIR }} />
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: s.w - s.pad, width: 1, background: HAIR }} />
      {rules.map((y, i) => (
        <div key={`r${i}`} style={{ position: 'absolute', top: y, left: 0, right: 0, height: 1, background: onDark(y) ? CELL_HAIR : HAIR }} />
      ))}
      {rules.flatMap((y, i) => [s.pad, s.w - s.pad].map((x, j) => (
        <div key={`d${i}${j}`} style={{ position: 'absolute', top: y - 3, left: x - 3, width: 7, height: 7, background: onDark(y) ? ON_CELL : INK, opacity: 0.55 }} />
      )))}
    </>
  );
}

/** the header band: wordmark left, sentence-case kicker right (Inter 400 warm gray — never uppercase mono) */
function Head({ s, kicker }: { s: Size; kicker: string }) {
  return (
    <div style={{ position: 'absolute', top: 0, left: s.pad, width: s.w - s.pad * 2, height: s.tall ? 132 : 104, ...F, alignItems: 'center', justifyContent: 'space-between', padding: `0 ${s.tall ? 28 : 24}px` }}>
      <img src={MARK_INK} width={s.tall ? 108 : 90} height={s.tall ? 69 : 58} alt="" />
      <div style={sans(s.tall ? 20 : 17, 400, INK2)}>{kicker}</div>
    </div>
  );
}

function Foot({ s, right }: { s: Size; right: string }) {
  const h = s.tall ? 70 : 58;
  return (
    <div style={{ position: 'absolute', bottom: 0, left: s.pad, width: s.w - s.pad * 2, height: h, ...F, alignItems: 'center', justifyContent: 'space-between', padding: `0 ${s.tall ? 28 : 24}px` }}>
      <div style={mono(s.tall ? 17 : 15, 400, MUTED)}>lectr.bid</div>
      <div style={mono(s.tall ? 15 : 13, 400, MUTED)}>{right}</div>
    </div>
  );
}

/** the photograph, edge to edge between the hairlines, on the cream plate */
function Plate({ src, x, y, w, h }: { src: string; x: number; y: number; w: number; h: number }) {
  return (
    <div style={{ position: 'absolute', top: y, left: x, width: w, height: h, background: CREAM, ...F, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      <img src={src} style={{ objectFit: 'contain', maxWidth: w - 48, maxHeight: h - 48 }} alt="" />
    </div>
  );
}

/** THE CELL — the one block that forces color, grained after render */
function Cell({ dir, x, y, w, h, children }: { dir: keyof typeof CELL; x: number; y: number; w: number; h: number; children: React.ReactNode }) {
  const [a, b] = CELL[dir];
  return (
    <div style={{ position: 'absolute', top: y, left: x, width: w, height: h, background: `linear-gradient(180deg, ${a} 0%, ${b} 100%)`, ...F, flexDirection: 'column' }}>
      {children}
    </div>
  );
}

function Row({ k, v, s, last = false }: { k: string; v: string; s: Size; last?: boolean }) {
  return (
    <div style={{ ...F, justifyContent: 'space-between', alignItems: 'baseline', borderBottom: last ? 'none' : `1px solid ${CELL_HAIR}`, padding: s.tall ? '13px 0' : '8px 0' }}>
      <div style={mono(s.tall ? 17 : 14, 400, ON_CELL_3)}>{k}</div>
      <div style={mono(s.tall ? 21 : 17, 500, ON_CELL)}>{v}</div>
    </div>
  );
}

/** the index line on the cell: eggshell stroke, a faint area, an endpoint */
function Line({ series, w, h }: { series: number[]; w: number; h: number }) {
  const pts = series.filter(Number.isFinite);
  if (pts.length < 2) return null;
  const min = Math.min(...pts), max = Math.max(...pts), span = max - min || 1;
  const xy = pts.map((v, i) => [(i / (pts.length - 1)) * w, h - ((v - min) / span) * (h - 10) - 5] as const);
  const d = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const [ex, ey] = xy[xy.length - 1];
  return (
    <svg width={w} height={h}>
      <polygon points={`0,${h} ${d} ${w},${h}`} fill="rgba(253,252,252,0.08)" />
      <polyline points={d} fill="none" stroke={ON_CELL} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={ex} cy={ey} r={7} fill={ON_CELL} />
    </svg>
  );
}

// ── the four compositions ───────────────────────────────────────────────────
function Card({ p, s, photo, date }: { p: Post; s: Size; photo: string | null; date: string }) {
  const W = s.w, H = s.h, pad = s.pad, inner = W - pad * 2;
  const headH = s.tall ? 132 : 104, footH = s.tall ? 70 : 58;
  const ground = { ...F, width: W, height: H, background: EGG, position: 'relative' as const, fontFamily: 'Inter' };

  // ── call / receipt: photograph over the cell ──────────────────────────────
  if (p.type === 'call' || p.type === 'receipt') {
    const isCall = p.type === 'call';
    const dir: keyof typeof CELL = isCall ? 'up' : p.hit ? 'up' : 'down';
    const big = isCall ? p.multiple : signed(p.deltaPct);
    const sub = isCall ? 'the ask, at the comps' : p.hit ? 'hammer within the ±30% band of the call' : 'hammer outside the ±30% band · missed';
    const rows: [string, string][] = isCall
      ? [[p.estimate ? 'estimate' : 'ask, about', p.estimate || money(p.askUsd)], ['comps median', `${money(p.med)} · ${p.basis} sales`], ['hammers', `${whenLabel(p.closes)} · ${p.lot.auctionHouse}`]]
      : [['called', `${money(p.row.p)} · ${whenLabel(p.row.d)}`], ['hammered', `${money(p.row.r)} · ${whenLabel(p.row.sd || p.row.d)}`], ['house', p.row.h || p.lot?.auctionHouse || '—']];
    const kicker = `${isCall ? "Tonight's call" : 'The receipt'} · ${date}`;

    if (s.tall) {
      const plateY = headH, plateH = photo ? 560 : 0;
      const titleY = plateY + plateH, titleH = 150;
      const cellY = titleY + titleH;
      // with a photograph the cell runs to the foot; without one it takes a
      // measured block and the rows sit below it on eggshell, like the index
      const cellH = photo ? H - footH - cellY : 620;
      const belowY = cellY + cellH, belowH = H - footH - belowY;
      const rules = [headH, ...(photo ? [titleY] : []), cellY, ...(photo ? [] : [belowY]), H - footH];
      return (
        <div style={ground}>
          {photo && <Plate src={photo} x={pad + 1} y={plateY + 1} w={inner - 1} h={plateH - 1} />}
          <div style={{ position: 'absolute', top: titleY, left: pad, width: inner, height: titleH, ...F, flexDirection: 'column', justifyContent: 'center', padding: '0 28px' }}>
            <div style={sans(38, 300, INK)}>{p.maker}</div>
            <div style={{ ...sans(22, 400, INK2), marginTop: 10, lineHeight: 1.3 }}>{p.title}</div>
          </div>
          <Cell dir={dir} x={pad + 1} y={cellY + 1} w={inner - 1} h={cellH - 1}>
            <div style={{ ...F, flexDirection: 'column', padding: '26px 28px 0', flexGrow: 1, justifyContent: photo ? 'flex-start' : 'center' }}>
              <div style={{ ...sans(photo ? 196 : 250, 300, ON_CELL), lineHeight: 0.92, marginLeft: -6 }}>{big}</div>
              <div style={{ ...sans(21, 400, ON_CELL_2), marginTop: 14 }}>{sub}</div>
            </div>
            {photo && (
              <div style={{ ...F, flexDirection: 'column', padding: '0 28px 22px' }}>
                {rows.map(([k, v], i) => <Row key={k} k={k} v={v} s={s} last={i === rows.length - 1} />)}
              </div>
            )}
          </Cell>
          {!photo && (
            <div style={{ position: 'absolute', top: belowY, left: pad, width: inner, height: belowH, ...F, flexDirection: 'column', justifyContent: 'center', padding: '0 28px' }}>
              {rows.map(([k, v], i) => (
                <div key={k} style={{ ...F, justifyContent: 'space-between', alignItems: 'baseline', borderBottom: i === rows.length - 1 ? 'none' : `1px solid ${HAIR}`, padding: '15px 0' }}>
                  <div style={mono(17, 400, MUTED)}>{k}</div>
                  <div style={mono(21, 500, INK)}>{v}</div>
                </div>
              ))}
            </div>
          )}
          <Head s={s} kicker={kicker} />
          <Foot s={s} right="comps: same maker, same form — medians, never means" />
          <Frame s={s} rules={rules} dark={[[cellY, belowY]]} />
        </div>
      );
    }
    // X — landscape: photograph left, cell right, full height between the rules
    const bodyY = headH, bodyH = H - footH - headH;
    const plateW = photo ? Math.round(inner * 0.44) : 0;
    const cellX = pad + plateW, cellW = inner - plateW;
    return (
      <div style={ground}>
        {photo && <Plate src={photo} x={pad + 1} y={bodyY + 1} w={plateW - 1} h={bodyH - 1} />}
        <Cell dir={dir} x={cellX + 1} y={bodyY + 1} w={cellW - 1} h={bodyH - 1}>
          <div style={{ ...F, flexDirection: 'column', padding: '22px 28px 0' }}>
            <div style={sans(26, 300, ON_CELL)}>{p.maker}</div>
            <div style={{ ...sans(16, 400, ON_CELL_2), marginTop: 6, lineHeight: 1.3 }}>{p.title}</div>
          </div>
          <div style={{ ...F, flexDirection: 'column', padding: '10px 28px 0', flexGrow: 1, justifyContent: 'center' }}>
            <div style={{ ...sans(photo ? 150 : 190, 300, ON_CELL), lineHeight: 0.92, marginLeft: -5 }}>{big}</div>
            <div style={{ ...sans(16, 400, ON_CELL_2), marginTop: 8 }}>{sub}</div>
          </div>
          <div style={{ ...F, flexDirection: 'column', padding: '0 28px 14px' }}>
            {rows.map(([k, v], i) => <Row key={k} k={k} v={v} s={s} last={i === rows.length - 1} />)}
          </div>
        </Cell>
        <Head s={s} kicker={kicker} />
        <Foot s={s} right="comps: same maker, same form — medians, never means" />
        <Frame s={s} rules={[headH, H - footH]} />
      </div>
    );
  }

  // ── index / record: the cell IS the picture ───────────────────────────────
  const isIndex = p.type === 'index';
  const dir: keyof typeof CELL = isIndex ? (p.changePct >= 0 ? 'up' : 'down') : 'up';
  const kicker = `${isIndex ? 'The index' : 'The record, replayed'} · ${date}`;
  const cellY = headH, cellH = s.tall ? 820 : H - footH - headH;
  const belowY = cellY + cellH, belowH = H - footH - belowY;
  const rules = s.tall ? [headH, belowY, H - footH] : [headH, H - footH];
  const span = isIndex ? ({ '1Y': 'one year', '3Y': 'three years', '5Y': 'five years' } as Record<string, string>)[p.horizon] || p.horizon : '';
  const rows: [string, string][] = isIndex
    ? [['95% interval', `${signed(p.ciLo)} to ${signed(p.ciHi)}`], [p.nLabel, p.n.toLocaleString()], ['method', p.method === 'repeat-sale' ? 'repeat-sale · ' + p.basis : 'hedonic · ' + p.basis]]
    : [['beat the high estimate', `${p.beatHighPct}%`], ['failed to sell', `${p.failToSellPct}%`], ['record as of', p.asOf]];
  const padX = 28;

  return (
    <div style={ground}>
      <Cell dir={dir} x={pad + 1} y={cellY + 1} w={inner - 1} h={cellH - 1}>
        <div style={{ ...F, flexDirection: 'column', padding: `${s.tall ? 30 : 20}px ${padX}px 0` }}>
          <div style={sans(s.tall ? 40 : 26, 300, ON_CELL)}>{isIndex ? marketLabel(p.market) : `${p.n.toLocaleString()} flagged lots, replayed`}</div>
          <div style={{ ...sans(s.tall ? 21 : 15, 400, ON_CELL_2), marginTop: 8, lineHeight: 1.3 }}>
            {isIndex ? `${p.method === 'repeat-sale' ? 'repeat-sale index' : 'hedonic index'} · ${p.basis}` : 'scored against what each one actually hammered for'}
          </div>
        </div>
        <div style={{ ...F, flexDirection: 'column', padding: `0 ${padX}px`, flexGrow: 1, justifyContent: 'center' }}>
          {isIndex ? (
            // a real column, not a Fragment — satori lays Fragment children out beside each other
            <div style={{ ...F, flexDirection: 'column', width: inner - padX * 2 - 2 }}>
              <div style={{ ...sans(s.tall ? 230 : 170, 300, ON_CELL), lineHeight: 0.92, marginLeft: -6 }}>{signed(p.changePct, 1)}</div>
              <div style={{ ...sans(s.tall ? 22 : 16, 400, ON_CELL_2), marginTop: 14 }}>over {span}</div>
              <div style={{ ...F, marginTop: s.tall ? 34 : 10, marginBottom: s.tall ? 0 : 14, width: inner - padX * 2 - 2 }}>
                <Line series={p.series} w={inner - padX * 2 - 2} h={s.tall ? 220 : 84} />
              </div>
            </div>
          ) : (
            <div style={{ ...F, alignItems: 'baseline', gap: s.tall ? 40 : 30 }}>
              <div style={{ ...F, flexDirection: 'column' }}>
                <div style={{ ...sans(s.tall ? 230 : 170, 300, ON_CELL), lineHeight: 0.92, marginLeft: -6 }}>{signed(p.flaggedMedianPct)}</div>
                <div style={{ ...sans(s.tall ? 21 : 15, 400, ON_CELL_2), marginTop: 12 }}>flagged · median over estimate</div>
              </div>
              <div style={{ ...F, flexDirection: 'column' }}>
                <div style={{ ...sans(s.tall ? 110 : 84, 300, ON_CELL_2), lineHeight: 0.92 }}>{signed(p.unflaggedMedianPct)}</div>
                <div style={{ ...sans(s.tall ? 21 : 15, 400, ON_CELL_3), marginTop: 12 }}>not flagged</div>
              </div>
            </div>
          )}
        </div>
        {!s.tall && (
          <div style={{ ...F, flexDirection: 'column', padding: `0 ${padX}px 12px` }}>
            {rows.map(([k, v], i) => <Row key={k} k={k} v={v} s={s} last={i === rows.length - 1} />)}
          </div>
        )}
      </Cell>
      {s.tall && (
        <div style={{ position: 'absolute', top: belowY, left: pad, width: inner, height: belowH, ...F, flexDirection: 'column', justifyContent: 'center', padding: `0 ${padX}px` }}>
          {rows.map(([k, v], i) => (
            <div key={k} style={{ ...F, justifyContent: 'space-between', alignItems: 'baseline', borderBottom: i === rows.length - 1 ? 'none' : `1px solid ${HAIR}`, padding: '15px 0' }}>
              <div style={mono(17, 400, MUTED)}>{k}</div>
              <div style={mono(21, 500, INK)}>{v}</div>
            </div>
          ))}
        </div>
      )}
      <Head s={s} kicker={kicker} />
      <Foot s={s} right={isIndex ? 'every index prints its interval, or abstains' : 'the misses are on the page too'} />
      <Frame s={s} rules={rules} dark={[[cellY, belowY]]} />
    </div>
  );
}

// ── render + grain + encode ─────────────────────────────────────────────────
/** pixel-static grain: heavier where the ground is dark (the cell), faint on
 *  eggshell — the site's CSS grain, by hand. Deterministic per card. */
function grain(png: { data: Buffer; width: number; height: number }) {
  const d = png.data;
  let seed = 0x9e3779b9;
  const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return ((seed >>> 0) % 1000) / 1000; };
  for (let i = 0; i < d.length; i += 4) {
    const luma = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114);
    const amp = luma < 90 ? 16 : luma > 235 ? 4 : 6;
    const n = Math.round((rnd() - 0.5) * 2 * amp);
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
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
  // remember tonight's flags before choosing, so a receipt can find its photo
  const memory = rememberFlags(d, await getJson<FlagMemory>('flags', {}));
  await putJson('flags', memory);
  const exclude = opts.exclude || new Set<string>();
  // never repeat a key the ledger posted inside 21 days
  const ledger = await getJson<{ posted: { date: string; key: string }[] }>('ledger', { posted: [] });
  const cut = new Date(Date.now() - 21 * 864e5).toISOString().slice(0, 10);
  for (const e of ledger.posted) if (e.date >= cut) exclude.add(e.key);
  const post = pickTonight(d, exclude, opts.force, memory);
  if (!post) {
    console.log('[social] nothing honest to post tonight — no candidate for any type');
    return null;
  }
  const date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
  const stamp = new Date().toISOString().slice(0, 10);
  const photo = post.type === 'call' ? await imageDataUri(post.lot.imageUrl) : post.type === 'receipt' ? await imageDataUri(post.lot?.imageUrl) : null;
  if ((post.type === 'call' || post.type === 'receipt') && !photo) console.warn('[social] photograph unavailable — card renders type-only');

  fs.mkdirSync(OUT, { recursive: true });
  const files: Record<string, string> = {};
  for (const k of ['ig', 'x'] as const) {
    const s = SIZES[k];
    const buf = await renderJpeg(<Card p={post} s={s} photo={photo} date={date} />, s);
    const name = `${stamp}-${post.type}-${k}.jpg`;
    fs.writeFileSync(path.join(OUT, name), buf);
    files[k] = name;
    console.log(`[social] ${name} ${(buf.length / 1024).toFixed(0)} KB`);
  }
  const copy = writeCopy(post);
  const plan = {
    date: stamp,
    type: post.type,
    key: post.key,
    url: post.url,
    files,
    publicUrls: { ig: `https://lectr.bid/social/${files.ig}`, x: `https://lectr.bid/social/${files.x}` },
    copy,
    dataAsOf: d.meta?.lastCrawl || null,
  };
  fs.writeFileSync(path.join(OUT, 'today.json'), JSON.stringify(plan, null, 2));
  console.log(`[social] plan → ${post.type} · ${post.key}`);
  console.log('\n— X —\n' + copy.x + '\n\n↳ ' + copy.xReply + '\n\n— IG —\n' + copy.ig + '\n');
  return plan;
}

if (require.main === module) {
  const force = process.argv.find(a => a.startsWith('--type='))?.slice(7) as PostType | undefined;
  renderTonight({ force }).catch(e => { console.error(e); process.exit(1); });
}
