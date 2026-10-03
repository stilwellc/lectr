/**
 * THE SHARE CARDS — every og:image lectr ships, drawn from the social desk's
 * card grammar (scripts/social/render.tsx) in the auction-catalogue doctrine
 * (docs/NORTHSTAR_UI.md Part 0):
 *
 *   GROUND     eggshell, the content column bounded by registration rails,
 *              section rules running to the edge, crop dots at the crossings
 *   SIGNATURE  the ink script mark top-left — the one place it is drawn
 *   PLATE      the lot photograph on a cream mat at ~80%, contained, no
 *              scrim, no gradient; a dead photo drops the plate entirely
 *   TYPE       Inter 300 for the large figure (never bold), 400 body,
 *              Plex Mono for data; gold only for the folio
 *   COLOUR     only a measured market move may wear green or brick
 *
 * Pure render functions: no fs reads beyond the fonts + the mark, no
 * network. Callers (scripts/build-og.tsx, app/opengraph-image.tsx) pass the
 * photograph already embedded as a data URI.
 */
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { ImageResponse } from 'next/og';

export const OG_SIZE = { width: 1200, height: 630 };

// ── palette (the social desk's, light-only) ─────────────────────────────────
const EGG = '#FDFCFC', CREAM = '#F5F3F1', INK = '#1C1917', INK2 = '#59544F', MUTED = '#777169', GOLD = '#8F6B1E';
const HAIR = 'rgba(28,25,23,0.16)';
const UP = '#0F7C43', DOWN = '#C13E2C';
/** satori draws no dotted borders — the leader is a dashed SVG rule (round
 *  caps on a near-zero dash = dots), clipped to whatever width it is given */
function Dots({ w, style }: { w?: number; style?: React.CSSProperties }) {
  return (
    <div style={{ ...F, overflow: 'hidden', height: 4, ...(w ? { width: w } : { flexGrow: 1, flexBasis: 0, width: 0 }), ...style }}>
      <svg width={1000} height={4}>
        <line x1={2} y1={2} x2={1000} y2={2} stroke="rgba(28,25,23,0.42)" strokeWidth={2} strokeDasharray="0.1 6" strokeLinecap="round" />
      </svg>
    </div>
  );
}

const FONT_DIR = path.join(process.cwd(), 'scripts', 'social', 'fonts');
type FontSpec = { name: string; data: Buffer; weight: 300 | 400 | 500; style: 'normal' }[];
let fontCache: FontSpec | null = null;
function fonts(): FontSpec {
  if (!fontCache) {
    const woff = (f: string) => fs.readFileSync(path.join(FONT_DIR, f));
    fontCache = [
      { name: 'Inter', data: woff('Inter-300.woff'), weight: 300, style: 'normal' },
      { name: 'Inter', data: woff('Inter-400.woff'), weight: 400, style: 'normal' },
      { name: 'Inter', data: woff('Inter-500.woff'), weight: 500, style: 'normal' },
      { name: 'Plex', data: woff('IBMPlexMono-400.woff'), weight: 400, style: 'normal' },
      { name: 'Plex', data: woff('IBMPlexMono-500.woff'), weight: 500, style: 'normal' },
    ];
  }
  return fontCache;
}
let markCache: string | null = null;
const mark = () => (markCache ??= 'data:image/png;base64,' + fs.readFileSync(path.join(process.cwd(), 'public', 'brand', 'lectr-ink-lg.png')).toString('base64'));

// ── geometry (the social desk's x-format, at 1200×630) ─────────────────────
const W = OG_SIZE.width, H = OG_SIZE.height, PAD = 56, HEAD = 92, FOOT = 52;
const INNER = W - PAD * 2;
const F = { display: 'flex' } as const;
const sans = (size: number, weight: 300 | 400 | 500 = 400, color = INK): React.CSSProperties => ({
  ...F, fontFamily: 'Inter', fontSize: size, fontWeight: weight, color,
  letterSpacing: size >= 60 ? size * -0.035 : size >= 28 ? -0.8 : -0.1, lineHeight: 1.1,
});
const mono = (size: number, weight: 400 | 500 = 400, color = INK): React.CSSProperties => ({
  ...F, fontFamily: 'Plex', fontSize: size, fontWeight: weight, color, letterSpacing: -0.2,
});

function Frame({ rules }: { rules: number[] }) {
  return (
    <>
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: PAD, width: 1, background: HAIR }} />
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: W - PAD, width: 1, background: HAIR }} />
      {rules.map((y, i) => <div key={`r${i}`} style={{ position: 'absolute', top: y, left: 0, right: 0, height: 1, background: HAIR }} />)}
      {rules.flatMap((y, i) => [PAD, W - PAD].map((x, j) => (
        <div key={`d${i}${j}`} style={{ position: 'absolute', top: y - 3, left: x - 3, width: 7, height: 7, background: INK, opacity: 0.5 }} />
      )))}
    </>
  );
}
function Head({ kicker }: { kicker: string }) {
  return (
    <div style={{ position: 'absolute', top: 0, left: PAD, width: INNER, height: HEAD, ...F, alignItems: 'center', justifyContent: 'space-between', padding: '0 26px' }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- satori, not a page */}
      <img src={mark()} width={86} height={55} alt="" />
      <div style={sans(18, 400, INK2)}>{kicker}</div>
    </div>
  );
}
function Foot({ left, folio }: { left?: string; folio: string }) {
  return (
    <div style={{ position: 'absolute', bottom: 0, left: PAD, width: INNER, height: FOOT, ...F, alignItems: 'center', justifyContent: 'space-between', padding: '0 26px' }}>
      <div style={mono(15, 400, MUTED)}>{left || 'lectr.bid'}</div>
      <div style={mono(14, 500, GOLD)}>{folio}</div>
    </div>
  );
}
/** the plate: cream mat, object at ~80%, contained — no scrim, ever */
function Plate({ src, x, y, w, h }: { src: string; x: number; y: number; w: number; h: number }) {
  return (
    <div style={{ position: 'absolute', top: y, left: x, width: w, height: h, background: CREAM, ...F, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- satori, not a page */}
      <img src={src} style={{ objectFit: 'contain', maxWidth: Math.round(w * 0.8), maxHeight: Math.round(h * 0.8) }} alt="" />
    </div>
  );
}
/** one dotted-leader ledger row: label · · · · value */
function Ledger({ k, v, color = INK, w }: { k: string; v: string; color?: string; w: number }) {
  return (
    <div style={{ ...F, alignItems: 'flex-end', width: w, marginTop: 14 }}>
      <div style={{ ...sans(19, 400, INK2), flexShrink: 0 }}>{k}</div>
      <Dots style={{ margin: '0 12px 5px' }} />
      <div style={{ ...mono(19, 500, color), flexShrink: 0 }}>{v}</div>
    </div>
  );
}
const clip = (t: string, max: number) => (t.length <= max ? t : t.slice(0, max - 1).replace(/\s+\S*$/, '') + '…');
const page = (children: React.ReactNode) => (
  <div style={{ ...F, width: W, height: H, background: EGG, position: 'relative', fontFamily: 'Inter' }}>{children}</div>
);
const render = (el: React.ReactElement) => new ImageResponse(el, { ...OG_SIZE, fonts: fonts() });
export async function toPng(res: ImageResponse): Promise<Buffer> {
  return Buffer.from(await res.arrayBuffer());
}

// ── the cards ───────────────────────────────────────────────────────────────

export interface BrandCardProps {
  settled: number;        // settled results on file
  replayed: number | null; // calls replayed (backtest flagged n)
  houses: number;
  flaggedHammerPct: number | null;   // hammer vs estimate, flagged
  restHammerPct: number | null;      // hammer vs estimate, the rest
  folio: string;
}
/** HOME — the position, in two lines, and the record that backs it. */
export function brandCard(p: BrandCardProps) {
  const bodyY = HEAD, bodyH = H - HEAD - FOOT;
  const colW = Math.round(INNER * 0.6);
  const sw = INNER - colW - 52;
  return render(page(
    <>
      <div style={{ position: 'absolute', top: bodyY, left: PAD, width: colW, height: bodyH, ...F, flexDirection: 'column', justifyContent: 'center', padding: '0 26px' }}>
        <div style={{ ...sans(50, 300, INK), whiteSpace: 'nowrap' }}>The house prints a guess.</div>
        <div style={{ ...sans(50, 300, INK), marginTop: 6, whiteSpace: 'nowrap' }}>We print the record.</div>
        <div style={{ ...sans(20, 400, INK2), marginTop: 26, lineHeight: 1.4 }}>
          {`lectr scores the house estimate against ${p.settled.toLocaleString('en-US')} settled results.`}
        </div>
      </div>
      <div style={{ position: 'absolute', top: bodyY, left: PAD + colW, width: INNER - colW, height: bodyH, borderLeft: `1px solid ${HAIR}`, ...F, flexDirection: 'column', justifyContent: 'center', padding: '0 26px 0 26px' }}>
        <div style={sans(17, 400, MUTED)}>The record, replayed</div>
        {p.flaggedHammerPct != null && (
          <Ledger w={sw} k="Our flags, hammer vs est." v={`${p.flaggedHammerPct >= 0 ? '+' : '−'}${Math.abs(p.flaggedHammerPct)}%`} color={p.flaggedHammerPct >= 0 ? UP : DOWN} />
        )}
        {p.restHammerPct != null && (
          <Ledger w={sw} k="Everything else" v={`${p.restHammerPct >= 0 ? '+' : '−'}${Math.abs(p.restHammerPct)}%`} color={p.restHammerPct >= 0 ? UP : DOWN} />
        )}
        {p.replayed != null && <Ledger w={sw} k="Calls replayed" v={p.replayed.toLocaleString('en-US')} />}
        <Ledger w={sw} k="Auction houses read" v={String(p.houses)} />
      </div>
      <Head kicker="The second opinion in the saleroom" />
      <Foot folio={p.folio} />
      <Frame rules={[HEAD, H - FOOT]} />
    </>,
  ));
}

export interface CallCardProps {
  kicker: string;
  house: string;
  houseSays: string | null;  // "$8,000–12,000" — the house's printed estimate
  recordSays: string;        // "$23,400" — the engine's expected hammer
  overPct: number | null;    // record vs estimate midpoint (signed)
  maker: string;
  title: string;
  hammers: string;           // "hammers Oct 8"
  basis: string;             // "24 comparable sales · high confidence"
  photo: string | null;
  folio: string;
}
/** THE CALL — photo plate left, the read right: the house's guess, the
 *  record's number, the stub that says what it stands on. */
export function callCard(p: CallCardProps) {
  const bodyY = HEAD, bodyH = H - HEAD - FOOT;
  const plateW = p.photo ? Math.round(INNER * 0.42) : 0;
  const colX = PAD + plateW, colW = INNER - plateW;
  const textW = colW - 64;
  const big = p.recordSays.length > 8 ? 104 : 124;
  return render(page(
    <>
      {p.photo && <Plate src={p.photo} x={PAD + 1} y={bodyY + 1} w={plateW - 1} h={bodyH - 1} />}
      <div style={{ position: 'absolute', top: bodyY, left: colX, width: colW, height: bodyH, borderLeft: p.photo ? `1px solid ${HAIR}` : 'none', ...F, flexDirection: 'column', padding: '0 32px' }}>
        <div style={{ ...F, flexDirection: 'column', flexGrow: 1, justifyContent: 'center' }}>
        <div style={{ ...sans(24, 400, INK2), whiteSpace: 'nowrap' }}>
          {p.houseSays ? `${p.house} says ${p.houseSays}.` : `${p.house} prints no estimate.`}
        </div>
        {/* the delta rides the label line, right-aligned — beside a wide
            numeral it wrapped ("+81% vs / est.") */}
        <div style={{ ...F, alignItems: 'baseline', justifyContent: 'space-between', width: textW, marginTop: 18 }}>
          <div style={sans(24, 400, INK)}>The record says</div>
          {p.overPct != null && Math.abs(p.overPct) >= 1 && (
            <div style={mono(18, 500, p.overPct > 0 ? UP : DOWN)}>
              {`${p.overPct > 0 ? '+' : '−'}${Math.abs(Math.round(p.overPct))}% vs the estimate`}
            </div>
          )}
        </div>
        <div style={{ ...sans(big, 300, INK), lineHeight: 1, marginLeft: -5, marginTop: 4 }}>{p.recordSays}</div>
        <div style={{ ...sans(19, 400, INK2), marginTop: 18, maxWidth: textW, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {clip(`${p.maker} · ${p.title}`, 64)}
        </div>
        </div>
        {/* the receipt stub */}
        <div style={{ ...F, justifyContent: 'space-between', width: textW, marginBottom: 22, paddingTop: 14, position: 'relative' }}>
          <Dots w={textW} style={{ position: 'absolute', top: 0, left: 0 }} />
          <div style={mono(15, 400, MUTED)}>{p.basis}</div>
          <div style={mono(15, 500, INK)}>{p.hammers}</div>
        </div>
      </div>
      <Head kicker={p.kicker} />
      <Foot folio={p.folio} />
      <Frame rules={[HEAD, H - FOOT]} />
    </>,
  ));
}

export interface MakerCardProps {
  name: string;
  market: string;         // "art market"
  read: { line: string; ci: string; dir: 'up' | 'down' } | null; // a CI-verified index move
  abstain: string | null; // the engine's own reason when nothing verifies
  sold: number | null;
  record: string | null;  // "$14.84M · Sotheby's, 2019"
  median: string | null;  // "$2,455"
  photo: string | null;
  folio: string;
}
/** A MAKER — the name, the one verified read (or the honest abstention), and
 *  the ledger of facts it stands on. */
export function makerCard(p: MakerCardProps) {
  const bodyY = HEAD, bodyH = H - HEAD - FOOT;
  const plateW = p.photo ? Math.round(INNER * 0.34) : 0;
  const colW = INNER - plateW;
  const lw = colW - 64;
  const nameSize = p.name.length > 22 ? 56 : p.name.length > 14 ? 68 : 80;
  return render(page(
    <>
      <div style={{ position: 'absolute', top: bodyY, left: PAD, width: colW, height: bodyH, ...F, flexDirection: 'column', justifyContent: 'center', padding: '0 32px' }}>
        <div style={sans(18, 400, MUTED)}>{`The ${p.market}`}</div>
        <div style={{ ...sans(nameSize, 300, INK), marginTop: 8, marginLeft: -3 }}>{p.name}</div>
        {p.read ? (
          <div style={{ ...F, flexDirection: 'column', marginTop: 18 }}>
            <div style={sans(26, 400, p.read.dir === 'up' ? UP : DOWN)}>{p.read.line}</div>
            <div style={{ ...mono(15, 400, MUTED), marginTop: 6 }}>{p.read.ci}</div>
          </div>
        ) : (
          <div style={{ ...sans(19, 400, INK2), marginTop: 18 }}>
            {p.abstain ? `No verified price move — ${p.abstain}.` : 'No verified price move yet.'}
          </div>
        )}
        <div style={{ ...F, flexDirection: 'column', marginTop: 30 }}>
          {p.sold != null && <Ledger w={lw} k="Settled sales on file" v={p.sold.toLocaleString('en-US')} />}
          {p.record && <Ledger w={lw} k="Record" v={p.record} />}
          {p.median && <Ledger w={lw} k="Median, last 12 months" v={p.median} />}
        </div>
      </div>
      {p.photo && <Plate src={p.photo} x={PAD + colW + 1} y={bodyY + 1} w={plateW - 1} h={bodyH - 1} />}
      {p.photo && <div style={{ position: 'absolute', top: bodyY, left: PAD + colW, width: 1, height: bodyH, background: HAIR }} />}
      <Head kicker="Maker dossier" />
      <Foot folio={p.folio} />
      <Frame rules={[HEAD, H - FOOT]} />
    </>,
  ));
}

export interface LedgerCardProps {
  kicker: string;
  headline: string;
  sub?: string;
  rows: { k: string; v: string; dir?: 'up' | 'down' }[];
  folio: string;
}
/** A STATEMENT — a checkable headline over a dotted ledger (the record, a
 *  quiet vertical). */
export function ledgerCard(p: LedgerCardProps) {
  const bodyY = HEAD, bodyH = H - HEAD - FOOT;
  const colW = Math.round(INNER * 0.55);
  const lw = INNER - colW - 52;
  const size = p.headline.length > 60 ? 44 : 52;
  return render(page(
    <>
      <div style={{ position: 'absolute', top: bodyY, left: PAD, width: colW, height: bodyH, ...F, flexDirection: 'column', justifyContent: 'center', padding: '0 26px' }}>
        <div style={{ ...sans(size, 300, INK), lineHeight: 1.12 }}>{p.headline}</div>
        {p.sub && <div style={{ ...sans(19, 400, INK2), marginTop: 22, lineHeight: 1.4 }}>{p.sub}</div>}
      </div>
      <div style={{ position: 'absolute', top: bodyY, left: PAD + colW, width: INNER - colW, height: bodyH, borderLeft: `1px solid ${HAIR}`, ...F, flexDirection: 'column', justifyContent: 'center', padding: '0 26px' }}>
        {p.rows.map(r => (
          <Ledger key={r.k} w={lw} k={r.k} v={r.v} color={r.dir === 'up' ? UP : r.dir === 'down' ? DOWN : INK} />
        ))}
      </div>
      <Head kicker={p.kicker} />
      <Foot folio={p.folio} />
      <Frame rules={[HEAD, H - FOOT]} />
    </>,
  ));
}
