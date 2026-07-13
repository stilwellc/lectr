import { ImageResponse } from 'next/og';
import stats from '../public/data/ray/stats.json';

export const alt = 'Ray — auction intelligence for the collectibles market';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

interface ArtistStats {
  totalAuctionRevenue?: number;
  appreciationRate?: number;
  priceHistory?: { date: string; avgPrice: number; totalSales: number }[];
}

/**
 * The share card is the product: live totals and the cumulative market curve,
 * regenerated on every deploy (each daily crawl commit redeploys).
 */
export default function OG() {
  const all = Object.values(stats as Record<string, ArtistStats>);
  const total = all.reduce((s, a) => s + (a.totalAuctionRevenue || 0), 0);
  const totalLabel = total >= 1e9 ? `$${(total / 1e9).toFixed(2)}B` : `$${(total / 1e6).toFixed(0)}M`;
  const appr = total > 0
    ? all.reduce((s, a) => s + (a.appreciationRate || 0) * (a.totalAuctionRevenue || 0), 0) / total
    : 0;

  // cumulative curve, downsampled to a polyline
  const q: Record<string, number> = {};
  for (const a of all) {
    for (const p of a.priceHistory || []) q[p.date] = (q[p.date] || 0) + p.avgPrice * p.totalSales;
  }
  let run = 0;
  const pts = Object.keys(q).sort().map(k => (run += q[k]));
  const W = 1080, H = 210;
  const max = pts[pts.length - 1] || 1;
  const line = pts
    .map((v, i) => `${((i / Math.max(pts.length - 1, 1)) * W).toFixed(1)},${(H - (v / max) * H + 8).toFixed(1)}`)
    .join(' ');

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: '#0A0B0D',
          padding: '56px 60px 40px',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="https://ray-one-theta.vercel.app/brand/ray-r.png" width="44" height="44" alt="" />
            <div style={{ fontSize: 38, fontWeight: 800, color: '#F4F5F6', letterSpacing: -1.5 }}>Ray</div>
          </div>
          <div style={{ fontSize: 22, color: '#7A8087' }}>auction intelligence</div>
        </div>
        <div style={{ display: 'flex', fontSize: 26, color: '#9AA0A6', marginTop: 28 }}>
          The collectibles market · art, design, watches &amp; science · total realized, all time
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 26 }}>
          <div style={{ fontSize: 110, fontWeight: 800, color: '#F4F5F6', letterSpacing: -4 }}>{totalLabel}</div>
          <div style={{ fontSize: 30, fontWeight: 700, color: appr >= 0 ? '#2FBF71' : '#E5544B' }}>
            {`prices ${appr >= 0 ? 'up' : 'down'} ${Math.abs(appr).toFixed(1)}% this year`}
          </div>
        </div>
        <svg width={W} height={H + 16} style={{ marginTop: 26 }}>
          <polyline points={line} fill="none" stroke="#F4F5F6" strokeWidth={4} strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      </div>
    ),
    { ...size }
  );
}
