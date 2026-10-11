/**
 * Pre-renders every artist's OG share card to public/og/<slug>.png at build
 * time. This replaces app/[artist]/opengraph-image.tsx — Next can't export
 * dynamic-segment metadata images with `output: 'export'`, and a static host
 * has no server to render them per scrape anyway. Same satori pipeline
 * (next/og ImageResponse), same visual: sharing /kaws shows KAWS's own line
 * and numbers — the share IS the product.
 *
 * Run before `next build` (wired into the build script in package.json).
 */
import React from 'react';
import { ImageResponse } from 'next/og';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { ARTISTS, MARKETS, type Market } from '../app/constants';
import { marketFacts, lotNoun } from '../app/lib/og-meta';
import { staticEntities, entityFacts, type StaticEntity } from '../app/lib/seo-entities';

interface ArtistStats {
  totalAuctionRevenue?: number;
  avgPriceLast12Months?: number;
  appreciationRate?: number;
  recordPrice?: number;
  priceHistory?: { date: string; avgPrice: number; totalSales: number }[];
}

const size = { width: 1200, height: 630 };
// Next 16's next/og default font is Geist; every card through Next 14 used
// next/og's bundled Noto Sans. Pin that exact file (OFL, vendored from
// next@14.2.35) so the share cards keep their look across the upgrade.
const fonts = [{ name: 'sans-serif', data: fs.readFileSync(path.join(process.cwd(), 'scripts/og-fonts/noto-sans-v27-latin-regular.ttf')), weight: 400 as const, style: 'normal' as const }];

// The sign, embedded — this script runs pre-build with no host to fetch from.
const mark = fs.readFileSync(path.join(process.cwd(), 'public', 'brand', 'lectr-ink-lg.png')).toString('base64');

function fmt(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${Math.round(n)}`;
}

function card(label: string, s: ArtistStats) {
  const hist = (s.priceHistory || []).map(p => p.avgPrice);
  const salesCount = (s.priceHistory || []).reduce((x, p) => x + (p.totalSales || 0), 0);
  const W = 1080, H = 200;
  // true series min/max (an empty series falls back to a flat 0..1) — seeding
  // min with 0 previously flattened real price variation into the top sliver.
  const max = hist.length ? Math.max(...hist) : 1;
  const min = hist.length ? Math.min(...hist) : 0;
  const line = hist
    .map((v, i) => `${((i / Math.max(hist.length - 1, 1)) * W).toFixed(1)},${(H - ((v - min) / Math.max(max - min, 1)) * H + 8).toFixed(1)}`)
    .join(' ');
  const up = hist.length >= 2 ? hist[hist.length - 1] >= hist[0] : true;
  // print-density signal inks — they hold on the eggshell card
  const lineColor = up ? '#0F7C43' : '#C13E2C';

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', position: 'relative', background: '#FDFCFC', padding: '54px 60px 36px', fontFamily: 'sans-serif' }}>
        {/* mat frame — ink hairline holds the edge in light AND dark bubbles */}
        <div style={{ position: 'absolute', top: 24, left: 24, right: 24, bottom: 24, border: '1px solid rgba(28,25,23,0.16)' }} />
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <img src={'data:image/png;base64,' + mark} width={150} height={96} alt="" />
          <div style={{ fontSize: 20, color: '#777169' }}>maker market page · lectr.bid</div>
        </div>
        <div style={{ display: 'flex', fontSize: 66, fontWeight: 400, color: '#1C1917', letterSpacing: -2.5, marginTop: 22 }}>{label}</div>
        <div style={{ display: 'flex', gap: 40, marginTop: 10, fontSize: 24, color: '#59544F' }}>
          <div style={{ display: 'flex' }}>{`avg sale ${fmt(s.avgPriceLast12Months || 0)}`}</div>
          <div style={{ display: 'flex' }}>{`record ${fmt(s.recordPrice || 0)}`}</div>
          {/* the third figure used to print "prices up X.X% this year" green/red
              from appreciationRate — a 3-year CAGR over non-empty quarters
              wearing the verified-move grammar ("0.0%" on thin makers). Removed
              exactly as app/opengraph-image.tsx did; the sales count is a fact. */}
          <div style={{ display: 'flex' }}>{`${salesCount.toLocaleString()} tracked sales`}</div>
        </div>
        {hist.length >= 2 && (
          <svg width={W} height={H + 16} style={{ marginTop: 30 }}>
            <polyline points={line} fill="none" stroke={lineColor} strokeWidth={4} strokeLinejoin="round" strokeLinecap="round" />
          </svg>
        )}
      </div>
    ),
    { ...size, fonts }
  );
}

/* ── the market card (SEO wave, Oct 11 2026) ─────────────────────────────
   /art, /value/<m>, /analytics/<m>, /makers/m/<m> and every /sub dossier
   shared with no image (or the generic site card). Same grammar as the maker
   card — eggshell, ink hairline mat, the ink mark, Noto — with the market's
   own counts at build (app/lib/og-meta marketFacts: what the page itself
   renders from). No line: a market has no single honest price series. */
function marketCard(market: Market) {
  const m = MARKETS.find(x => x.key === market)!;
  const f = marketFacts(market);
  const facts = [
    f.settled ? `${f.settled.toLocaleString('en-US')} settled results` : null,
    `${f.live.toLocaleString('en-US')} ${lotNoun(market, f.live)} on the block`,
  ].filter(Boolean) as string[];
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', position: 'relative', background: '#FDFCFC', padding: '54px 60px 36px', fontFamily: 'sans-serif' }}>
        <div style={{ position: 'absolute', top: 24, left: 24, right: 24, bottom: 24, border: '1px solid rgba(28,25,23,0.16)' }} />
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <img src={'data:image/png;base64,' + mark} width={150} height={96} alt="" />
          <div style={{ fontSize: 20, color: '#777169' }}>market · lectr.bid</div>
        </div>
        <div style={{ display: 'flex', fontSize: 96, fontWeight: 400, color: '#1C1917', letterSpacing: -3.5, marginTop: 64 }}>{m.label}</div>
        <div style={{ display: 'flex', fontSize: 30, color: '#59544F', marginTop: 6 }}>{m.tagline}</div>
        <div style={{ display: 'flex', gap: 40, marginTop: 'auto', marginBottom: 20, fontSize: 24, color: '#59544F' }}>
          {facts.map(t => <div key={t} style={{ display: 'flex' }}>{t}</div>)}
        </div>
      </div>
    ),
    { ...size, fonts }
  );
}

/* ── the entity card (/p/<player>, /e/<name>) ─────────────────────────────
   The maker card's grammar for the static dossier aliases (app/lib/
   seo-entities): kind kicker, the name, the measured facts with their n, and
   the summary's own quarterly line in plain ink (no green/red — the line is
   a level, not a verified move), captioned with what it measures. */
function entityCard(x: StaticEntity) {
  const f = entityFacts(x);
  const pts = (x.e.spark || []).map(v => (typeof v === 'number' && Number.isFinite(v) ? v : null));
  const real = pts.filter((v): v is number => v != null);
  const W = 1080, H = 150;
  let runs: string[] = [];
  if (real.length >= 4) {
    const max = Math.max(...real), min = Math.min(...real);
    // gaps stay gaps: a thin quarter (null) breaks the line into runs
    const acc: string[][] = [];
    let cur: string[] = [];
    pts.forEach((v, i) => {
      if (v == null) { if (cur.length) acc.push(cur); cur = []; return; }
      cur.push(`${((i / Math.max(pts.length - 1, 1)) * W).toFixed(1)},${(H - ((v - min) / Math.max(max - min, 1e-9)) * H + 8).toFixed(1)}`);
    });
    if (cur.length) acc.push(cur);
    runs = acc.filter(r => r.length >= 2).map(r => r.join(' '));
  }
  const caption = x.e.sparkBasis === 'matched' ? 'same-item price level · trailing year · by quarter' : 'median sale · trailing year · by quarter';
  const nameSize = f.name.length <= 18 ? 66 : f.name.length <= 30 ? 54 : 42;
  const facts = [f.sold, f.median, f.record].filter(Boolean) as string[];
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', position: 'relative', background: '#FDFCFC', padding: '54px 60px 36px', fontFamily: 'sans-serif' }}>
        <div style={{ position: 'absolute', top: 24, left: 24, right: 24, bottom: 24, border: '1px solid rgba(28,25,23,0.16)' }} />
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <img src={'data:image/png;base64,' + mark} width={150} height={96} alt="" />
          <div style={{ fontSize: 20, color: '#777169' }}>{`${x.kind === 'player' ? 'player' : 'dossier'} · lectr.bid`}</div>
        </div>
        <div style={{ display: 'flex', fontSize: 22, color: '#777169', marginTop: 18 }}>{f.kicker}</div>
        <div style={{ display: 'flex', fontSize: nameSize, fontWeight: 400, color: '#1C1917', letterSpacing: -2.5, marginTop: 4 }}>{f.name}</div>
        <div style={{ display: 'flex', gap: 36, marginTop: 10, fontSize: 24, color: '#59544F' }}>
          {facts.map(t => <div key={t} style={{ display: 'flex' }}>{t}</div>)}
        </div>
        {runs.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 'auto' }}>
            <svg width={W} height={H + 16}>
              {runs.map((r, i) => <polyline key={i} points={r} fill="none" stroke="#1C1917" strokeWidth={4} strokeLinejoin="round" strokeLinecap="round" />)}
            </svg>
            <div style={{ display: 'flex', fontSize: 17, color: '#777169', marginTop: 4 }}>{caption}</div>
          </div>
        )}
      </div>
    ),
    { ...size, fonts }
  );
}

async function writePng(file: string, res: ImageResponse) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

/** one shard of the entity cards — satori + resvg are CPU-bound and single-
 *  threaded, so the ~600 alias cards render across child processes */
async function renderEntityShard(i: number, k: number) {
  const outDir = path.join(process.cwd(), 'public', 'og');
  const ents = staticEntities().filter((_, j) => j % k === i);
  for (const x of ents) await writePng(path.join(outDir, x.kind === 'player' ? 'p' : 'e', `${x.slug}.png`), entityCard(x));
}

function runShards(k: number): Promise<void> {
  return Promise.all(Array.from({ length: k }, (_, i) => new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [...process.execArgv, __filename], { env: { ...process.env, OG_SHARD: `${i}/${k}` }, stdio: 'inherit' });
    child.on('exit', code => (code === 0 ? resolve() : reject(new Error(`entity-card shard ${i}/${k} exited ${code}`))));
    child.on('error', reject);
  }))).then(() => undefined);
}

async function main() {
  const shard = process.env.OG_SHARD;
  if (shard) {
    const [i, k] = shard.split('/').map(Number);
    return renderEntityShard(i, k);
  }
  const t0 = Date.now();
  const stats: Record<string, ArtistStats> = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'public', 'data', 'ray', 'stats.json'), 'utf8')
  );
  const outDir = path.join(process.cwd(), 'public', 'og');
  fs.mkdirSync(outDir, { recursive: true });
  for (const a of ARTISTS) {
    await writePng(path.join(outDir, `${a.slug}.png`), card(a.label, stats[a.slug] || {}));
  }
  console.log(`[og] ${ARTISTS.length} maker cards → public/og/`);

  const markets = MARKETS.filter(m => m.live && m.key !== 'all');
  for (const m of markets) await writePng(path.join(outDir, 'm', `${m.key}.png`), marketCard(m.key));
  console.log(`[og] ${markets.length} market cards → public/og/m/`);

  // the static aliases' cards — fresh dirs each build, so a name that left
  // the set never ships a stale card
  for (const d of ['p', 'e']) fs.rmSync(path.join(outDir, d), { recursive: true, force: true });
  const ents = staticEntities();
  const k = Math.max(1, Math.min(6, os.availableParallelism() - 1, Math.ceil(ents.length / 50)));
  if (k > 1) await runShards(k);
  else await renderEntityShard(0, 1);
  console.log(`[og] ${ents.length} entity cards → public/og/{p,e}/ across ${k} process(es) (${((Date.now() - t0) / 1000).toFixed(1)}s total)`);
}

main().catch(err => { console.error('[og] failed:', err); process.exit(1); });
