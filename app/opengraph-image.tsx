import { ImageResponse } from 'next/og';
import fs from 'node:fs';
import path from 'node:path';
import stats from '../public/data/ray/stats.json';
import backtest from '../public/data/ray/backtest.json';

export const alt = 'lectr — auction intelligence for the collectibles market';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

interface ArtistStats {
  totalAuctionRevenue?: number;
  appreciationRate?: number;
  priceHistory?: { date: string; avgPrice: number; totalSales: number }[];
}

/**
 * The share card is the product: live totals and the cumulative market curve,
 * regenerated on every deploy (each daily crawl commit redeploys). Statically
 * rendered at build under `output: 'export'`, so node:fs is safe here — the
 * mark ships as a base64 data URI, never a runtime URL.
 */
export default function OG() {
  const all = Object.values(stats as Record<string, ArtistStats>);
  const total = all.reduce((s, a) => s + (a.totalAuctionRevenue || 0), 0);
  const totalLabel = total >= 1e9 ? `$${(total / 1e9).toFixed(2)}B` : `$${(total / 1e6).toFixed(0)}M`;
  // The companion line used to print "prices up X.X% this year" green/red from
  // the revenue-weighted appreciationRate — a descriptive estimate wearing the
  // verified-move grammar on every link embed. Counts are facts: show the
  // sales the headline is built from instead; the backtest line below stays
  // the card's only colored figure (a real measured median with its n).
  const salesCount = all.reduce((s, a) => s + (a.priceHistory || []).reduce((x, p) => x + (p.totalSales || 0), 0), 0);
  const salesLabel = salesCount >= 1000 ? `${Math.round(salesCount / 1000)}K` : String(salesCount);

  // cumulative curve, downsampled to a polyline
  const q: Record<string, number> = {};
  for (const a of all) {
    for (const p of a.priceHistory || []) q[p.date] = (q[p.date] || 0) + p.avgPrice * p.totalSales;
  }
  let run = 0;
  const pts = Object.keys(q).sort().map(k => (run += q[k]));
  const W = 1080, H = 110;
  const max = pts[pts.length - 1] || 1;
  const line = pts
    .map((v, i) => `${((i / Math.max(pts.length - 1, 1)) * W).toFixed(1)},${(H - (v / max) * H + 8).toFixed(1)}`)
    .join(' ');

  // the sign, embedded — no host to fetch from at build time
  const mark = fs.readFileSync(path.join(process.cwd(), 'public/brand/lectr.png')).toString('base64');

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          background: '#0B0A07',
          padding: '40px 60px 36px',
          fontFamily: 'sans-serif',
        }}
      >
        {/* mat frame — holds the edge in an iMessage dark-mode bubble */}
        <div
          style={{
            position: 'absolute',
            top: 24,
            left: 24,
            right: 24,
            bottom: 24,
            border: '1px solid rgba(242,238,227,0.14)',
          }}
        />
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          {/* the light the sign casts on the wall */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 80,
              margin: -80,
              background: 'radial-gradient(closest-side, rgba(242,238,227,0.07), transparent 70%)',
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={'data:image/png;base64,' + mark} width={340} height={218} alt="" />
          </div>
          <div style={{ fontSize: 22, color: '#8A8477' }}>auction intelligence · lectr.bid</div>
        </div>
        <div style={{ display: 'flex', fontSize: 26, color: '#A19B8D', marginTop: 8 }}>
          The collectibles market · art, design, watches &amp; science · total realized, all time
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 26 }}>
          <div style={{ fontSize: 110, fontWeight: 800, color: '#F2EEE3', letterSpacing: -4 }}>{totalLabel}</div>
          <div style={{ fontSize: 30, fontWeight: 700, color: '#A19B8D' }}>
            {`across ${salesLabel} tracked sales`}
          </div>
        </div>
        <svg width={W} height={H + 16} style={{ marginTop: 8 }}>
          <polyline points={line} fill="none" stroke="#E8DAB6" strokeWidth={5} strokeLinejoin="round" strokeLinecap="round" />
        </svg>
        {backtest.flagged.n > 500 && (
          <div style={{ display: 'flex', fontSize: 21, color: '#A19B8D', marginTop: 'auto', gap: 7 }}>
            <span>flagged calls hammered</span>
            <span style={{ color: '#2FBF71', fontWeight: 700 }}>{`+${backtest.flagged.medianPerfPct}% median`}</span>
            <span>{`over estimates · ${backtest.flagged.n.toLocaleString()} replayed sales`}</span>
          </div>
        )}
      </div>
    ),
    { ...size }
  );
}
