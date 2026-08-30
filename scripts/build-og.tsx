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
import { ARTISTS } from '../app/constants';

interface ArtistStats {
  totalAuctionRevenue?: number;
  avgPriceLast12Months?: number;
  appreciationRate?: number;
  recordPrice?: number;
  priceHistory?: { date: string; avgPrice: number; totalSales: number }[];
}

const size = { width: 1200, height: 630 };

// The sign, embedded — this script runs pre-build with no host to fetch from.
const mark = fs.readFileSync(path.join(process.cwd(), 'public', 'brand', 'lectr-ink-lg.png')).toString('base64');

function fmt(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${Math.round(n)}`;
}

function card(label: string, s: ArtistStats) {
  const appr = s.appreciationRate || 0;
  const hist = (s.priceHistory || []).map(p => p.avgPrice);
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
          <div style={{ display: 'flex', color: appr >= 0 ? '#0F7C43' : '#A5341F', fontWeight: 600 }}>
            {`prices ${appr >= 0 ? 'up' : 'down'} ${Math.abs(appr).toFixed(1)}% this year`}
          </div>
        </div>
        {hist.length >= 2 && (
          <svg width={W} height={H + 16} style={{ marginTop: 30 }}>
            <polyline points={line} fill="none" stroke={lineColor} strokeWidth={4} strokeLinejoin="round" strokeLinecap="round" />
          </svg>
        )}
      </div>
    ),
    { ...size }
  );
}

async function main() {
  const stats: Record<string, ArtistStats> = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'public', 'data', 'ray', 'stats.json'), 'utf8')
  );
  const outDir = path.join(process.cwd(), 'public', 'og');
  fs.mkdirSync(outDir, { recursive: true });
  for (const a of ARTISTS) {
    const res = card(a.label, stats[a.slug] || {});
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(path.join(outDir, `${a.slug}.png`), buf);
  }
  console.log(`[og] ${ARTISTS.length} share cards → public/og/`);
}

main().catch(err => { console.error('[og] failed:', err); process.exit(1); });
