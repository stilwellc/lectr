/**
 * The cards. Same satori pipeline as build-og.tsx (next/og ImageResponse),
 * same eggshell + ink + mat-frame grammar as the site's share cards — but in
 * the site's real faces (Inter, IBM Plex Mono, vendored in ./fonts) instead
 * of satori's default, and at the two sizes the platforms want:
 *
 *   ig  1080 × 1350   (4:5 portrait — the largest feed footprint IG allows)
 *   x   1200 × 675    (16:9 — shows uncropped in the timeline)
 *
 * Output: public/social/<date>-<type>-{ig,x}.jpg and public/social/today.json.
 * The deploy job runs this BEFORE `next build`, so the JPEGs ship inside the
 * static export and Instagram can fetch them from lectr.bid — the public URL
 * its API insists on, for free.
 *
 * satori only understands a flexbox subset: every div with children carries
 * an explicit display:flex. JPEG is required by Instagram (PNG is refused).
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

// ── palette: the north-star eggshell ramp, print-density inks ───────────────
const EGG = '#FDFCFC', INK = '#1C1917', INK2 = '#59544F', MUTED = '#777169', HAIR = 'rgba(28,25,23,0.16)', PLATE = '#F5F3F1';
const UP = '#0F7C43', DOWN = '#C13E2C';

const FONT_DIR = path.join(__dirname, 'fonts');
const fonts = [
  { name: 'Inter', data: fs.readFileSync(path.join(FONT_DIR, 'Inter-400.woff')), weight: 400 as const, style: 'normal' as const },
  { name: 'Inter', data: fs.readFileSync(path.join(FONT_DIR, 'Inter-500.woff')), weight: 500 as const, style: 'normal' as const },
  { name: 'Inter', data: fs.readFileSync(path.join(FONT_DIR, 'Inter-600.woff')), weight: 600 as const, style: 'normal' as const },
  { name: 'Plex', data: fs.readFileSync(path.join(FONT_DIR, 'IBMPlexMono-400.woff')), weight: 400 as const, style: 'normal' as const },
  { name: 'Plex', data: fs.readFileSync(path.join(FONT_DIR, 'IBMPlexMono-500.woff')), weight: 500 as const, style: 'normal' as const },
];
const MARK = 'data:image/png;base64,' + fs.readFileSync(path.join(process.cwd(), 'public', 'brand', 'lectr-ink-lg.png')).toString('base64');

type Size = { w: number; h: number; pad: number; tall: boolean };
const SIZES: Record<'ig' | 'x', Size> = {
  ig: { w: 1080, h: 1350, pad: 64, tall: true },
  x: { w: 1200, h: 675, pad: 56, tall: false },
};

const F = { display: 'flex' } as const;
const mono = (size: number, weight = 400, color = INK): React.CSSProperties => ({ ...F, fontFamily: 'Plex', fontSize: size, fontWeight: weight, color, letterSpacing: -0.5 });
const sans = (size: number, weight = 400, color = INK): React.CSSProperties => ({ ...F, fontFamily: 'Inter', fontSize: size, fontWeight: weight, color, letterSpacing: size > 40 ? -1.5 : -0.2 });

// ── chrome shared by every card ─────────────────────────────────────────────
function Frame({ s, eyebrow, children }: { s: Size; eyebrow: string; children: React.ReactNode }) {
  return (
    <div style={{ ...F, width: '100%', height: '100%', flexDirection: 'column', background: EGG, padding: s.pad, position: 'relative', fontFamily: 'Inter' }}>
      <div style={{ position: 'absolute', top: 26, left: 26, right: 26, bottom: 26, border: `1px solid ${HAIR}` }} />
      <div style={{ ...F, alignItems: 'center', justifyContent: 'space-between' }}>
        <img src={MARK} width={s.tall ? 118 : 100} height={s.tall ? 76 : 64} alt="" />
        <div style={{ ...mono(s.tall ? 20 : 18, 500, MUTED), letterSpacing: 2, textTransform: 'uppercase' }}>{eyebrow}</div>
      </div>
      <div style={{ ...F, flexDirection: 'column', flexGrow: 1, marginTop: s.tall ? 36 : 22 }}>{children}</div>
      <div style={{ ...F, justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 20 }}>
        <div style={mono(s.tall ? 19 : 17, 400, MUTED)}>lectr.bid</div>
        <div style={mono(s.tall ? 17 : 15, 400, MUTED)}>comps: same maker, same form — medians, never means</div>
      </div>
    </div>
  );
}

function Plate({ src, w, h }: { src: string | null; w: number; h: number }) {
  if (!src) return null; // no photograph → the type-only layout, never an empty box
  return (
    <div style={{ ...F, width: w, height: h, background: PLATE, border: `1px solid ${HAIR}`, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      {src ? <img src={src} style={{ objectFit: 'contain', maxWidth: w - 24, maxHeight: h - 24 }} alt="" /> : null}
    </div>
  );
}

function Spec({ k, v, s, tone }: { k: string; v: string; s: Size; tone?: string }) {
  return (
    <div style={{ ...F, justifyContent: 'space-between', alignItems: 'baseline', borderBottom: `1px solid ${HAIR}`, padding: s.tall ? '14px 0' : '9px 0' }}>
      <div style={mono(s.tall ? 20 : 17, 400, MUTED)}>{k}</div>
      <div style={mono(s.tall ? 24 : 20, 500, tone || INK)}>{v}</div>
    </div>
  );
}

function Line({ series, w, h, up }: { series: number[]; w: number; h: number; up: boolean }) {
  const pts = series.filter(Number.isFinite);
  if (pts.length < 2) return null;
  const min = Math.min(...pts), max = Math.max(...pts), span = max - min || 1;
  const d = pts.map((v, i) => `${(i / (pts.length - 1)) * w},${h - ((v - min) / span) * (h - 8) - 4}`).join(' ');
  return (
    <svg width={w} height={h}>
      <polyline points={d} fill="none" stroke={up ? UP : DOWN} strokeWidth={4} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ── the four cards ──────────────────────────────────────────────────────────
function Card({ p, s, photo, date }: { p: Post; s: Size; photo: string | null; date: string }) {
  const inner = s.w - s.pad * 2;
  if (p.type === 'call') {
    const plateH = s.tall ? 560 : 300;
    return (
      <Frame s={s} eyebrow={`Tonight's call · ${date}`}>
        <div style={{ ...F, flexDirection: s.tall ? 'column' : 'row', gap: s.tall ? 28 : 40, flexGrow: 1 }}>
          <Plate src={photo} w={s.tall ? inner : 440} h={s.tall ? plateH : plateH} />
          <div style={{ ...F, flexDirection: 'column', flexGrow: 1, justifyContent: s.tall && photo ? 'flex-start' : 'space-between' }}>
            <div style={{ ...F, flexDirection: 'column' }}>
              <div style={sans(s.tall ? 34 : 28, 600)}>{p.maker}</div>
              <div style={{ ...sans(s.tall ? 24 : 19, 400, INK2), marginTop: 6, lineHeight: 1.3 }}>{p.title}</div>
            </div>
            <div style={{ ...F, alignItems: 'baseline', gap: 16, marginTop: s.tall ? 22 : 8 }}>
              <div style={{ ...mono(s.tall ? 132 : 96, 500, UP), letterSpacing: -6, lineHeight: 1 }}>{p.multiple}</div>
              <div style={sans(s.tall ? 22 : 18, 400, MUTED)}>the ask, at the comps</div>
            </div>
            <div style={{ ...F, flexDirection: 'column', marginTop: s.tall ? 18 : 6 }}>
              {p.estimate ? <Spec s={s} k="estimate" v={p.estimate} /> : <Spec s={s} k="ask, about" v={money(p.askUsd)} />}
              <Spec s={s} k="comps median" v={`${money(p.med)} · ${p.basis} sales`} />
              <Spec s={s} k="hammers" v={`${whenLabel(p.closes)} · ${p.lot.auctionHouse}`} />
            </div>
          </div>
        </div>
      </Frame>
    );
  }
  if (p.type === 'receipt') {
    const tone = p.hit ? UP : DOWN;
    return (
      <Frame s={s} eyebrow={`The receipt · ${date}`}>
        <div style={{ ...F, flexDirection: s.tall ? 'column' : 'row', gap: s.tall ? 28 : 40, flexGrow: 1 }}>
          <Plate src={photo} w={s.tall ? inner : 400} h={s.tall ? 470 : 300} />
          <div style={{ ...F, flexDirection: 'column', flexGrow: 1, justifyContent: photo ? 'flex-start' : 'space-between' }}>
            <div style={{ ...F, flexDirection: 'column' }}>
              <div style={sans(s.tall ? 34 : 28, 600)}>{p.maker}</div>
              <div style={{ ...sans(s.tall ? 24 : 19, 400, INK2), marginTop: 6, lineHeight: 1.3 }}>{p.title}</div>
            </div>
            <div style={{ ...F, flexDirection: 'column', marginTop: s.tall ? 26 : 10 }}>
              <div style={{ ...mono(s.tall ? (photo ? 120 : 160) : 88, 500, INK), letterSpacing: -6, lineHeight: 1 }}>{signed(p.deltaPct)}</div>
              <div style={{ ...sans(s.tall ? 26 : 20, 500, tone), marginTop: 10 }}>{p.hit ? 'hammer within the ±30% band of the call' : 'hammer outside the ±30% band · missed'}</div>
            </div>
            <div style={{ ...F, flexDirection: 'column', marginTop: s.tall ? 18 : 6 }}>
              <Spec s={s} k="called" v={`${money(p.row.p)} · ${whenLabel(p.row.d)}`} />
              <Spec s={s} k="hammered" v={`${money(p.row.r)} · ${whenLabel(p.row.sd || p.row.d)}`} tone={tone} />
              <Spec s={s} k="house" v={p.row.h || p.lot?.auctionHouse || '—'} />
            </div>
          </div>
        </div>
      </Frame>
    );
  }
  if (p.type === 'index') {
    const up = p.changePct >= 0;
    const span = { '1Y': 'one year', '3Y': 'three years', '5Y': 'five years' }[p.horizon] || p.horizon;
    return (
      <Frame s={s} eyebrow={`The index · ${date}`}>
        <div style={{ ...F, flexDirection: 'column', flexGrow: 1, justifyContent: 'space-between' }}>
          <div style={{ ...F, flexDirection: 'column' }}>
            <div style={sans(s.tall ? 44 : 34, 600)}>{marketLabel(p.market)}</div>
            <div style={{ ...sans(s.tall ? 24 : 19, 400, INK2), marginTop: 6 }}>{p.method === 'repeat-sale' ? 'repeat-sale index' : 'hedonic index'} · {p.basis}</div>
          </div>
          <div style={{ ...F, alignItems: 'baseline', gap: 18 }}>
            <div style={{ ...mono(s.tall ? 150 : 104, 500, up ? UP : DOWN), letterSpacing: -7, lineHeight: 1 }}>{signed(p.changePct, 1)}</div>
            <div style={sans(s.tall ? 26 : 20, 400, MUTED)}>over {span}</div>
          </div>
          <Line series={p.series} w={inner} h={s.tall ? 220 : 110} up={up} />
          <div style={{ ...F, flexDirection: 'column' }}>
            <Spec s={s} k="95% interval" v={`${signed(p.ciLo)} to ${signed(p.ciHi)}`} />
            <Spec s={s} k={p.nLabel} v={p.n.toLocaleString()} />
          </div>
        </div>
      </Frame>
    );
  }
  // record
  return (
    <Frame s={s} eyebrow={`The record, replayed · ${date}`}>
      <div style={{ ...F, flexDirection: 'column', flexGrow: 1, justifyContent: 'space-between' }}>
        <div style={{ ...sans(s.tall ? 30 : 24, 400, INK2), lineHeight: 1.35, maxWidth: inner }}>
          {p.n.toLocaleString()} lots we flagged below their comparables, scored against what they actually hammered for.
        </div>
        <div style={{ ...F, gap: s.tall ? 48 : 60, alignItems: 'flex-end' }}>
          <div style={{ ...F, flexDirection: 'column' }}>
            <div style={{ ...mono(s.tall ? 150 : 104, 500, UP), letterSpacing: -7, lineHeight: 1 }}>{signed(p.flaggedMedianPct)}</div>
            <div style={{ ...sans(s.tall ? 22 : 18, 400, MUTED), marginTop: 10 }}>flagged · median over estimate</div>
          </div>
          <div style={{ ...F, flexDirection: 'column' }}>
            <div style={{ ...mono(s.tall ? 84 : 60, 500, INK2), letterSpacing: -3, lineHeight: 1 }}>{signed(p.unflaggedMedianPct)}</div>
            <div style={{ ...sans(s.tall ? 22 : 18, 400, MUTED), marginTop: 10 }}>not flagged</div>
          </div>
        </div>
        <div style={{ ...F, flexDirection: 'column' }}>
          <Spec s={s} k="beat the high estimate" v={`${p.beatHighPct}%`} />
          <Spec s={s} k="failed to sell" v={`${p.failToSellPct}%`} tone={DOWN} />
          <Spec s={s} k="record as of" v={p.asOf} />
        </div>
      </div>
    </Frame>
  );
}

// ── render + encode ─────────────────────────────────────────────────────────
async function renderJpeg(node: React.ReactElement, s: Size): Promise<Buffer> {
  const res = new ImageResponse(node, { width: s.w, height: s.h, fonts });
  const png = PNG.sync.read(Buffer.from(await res.arrayBuffer()));
  return jpeg.encode({ data: png.data, width: png.width, height: png.height }, 90).data;
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
