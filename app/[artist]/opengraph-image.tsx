import { ImageResponse } from 'next/og';
import stats from '../../public/data/ray/stats.json';
import { ARTISTS } from '../constants';

export const runtime = 'edge';
export const alt = 'Ray — artist market page';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

interface ArtistStats {
  totalAuctionRevenue?: number;
  avgPriceLast12Months?: number;
  appreciationRate?: number;
  recordPrice?: number;
  priceHistory?: { date: string; avgPrice: number; totalSales: number }[];
}

function fmt(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${Math.round(n)}`;
}

/** Sharing /kaws shows KAWS's own line and numbers — the share IS the product. */
export default function OG({ params }: { params: { artist: string } }) {
  const label = ARTISTS.find(a => a.slug === params.artist)?.label || params.artist;
  const s = (stats as Record<string, ArtistStats>)[params.artist] || {};
  const appr = s.appreciationRate || 0;

  const hist = (s.priceHistory || []).map(p => p.avgPrice);
  const W = 1080, H = 200;
  const max = Math.max(...hist, 1);
  const min = Math.min(...hist, 0);
  const line = hist
    .map((v, i) => `${((i / Math.max(hist.length - 1, 1)) * W).toFixed(1)},${(H - ((v - min) / Math.max(max - min, 1)) * H + 8).toFixed(1)}`)
    .join(' ');
  const up = hist.length >= 2 ? hist[hist.length - 1] >= hist[0] : true;
  const lineColor = up ? '#2FBF71' : '#E5544B';

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#0A0B0D', padding: '54px 60px 36px', fontFamily: 'sans-serif' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <svg width="34" height="34" viewBox="0 0 24 24">
              <circle cx="5.2" cy="18.8" r="2.7" fill="#E8B95B" />
              <path d="M9.4 14.6 L20 4" stroke="#E8B95B" strokeWidth="2.7" strokeLinecap="round" />
            </svg>
            <div style={{ fontSize: 38, fontWeight: 800, color: '#E8B95B', letterSpacing: -1.5 }}>Ray</div>
          </div>
          <div style={{ fontSize: 21, color: '#63686E' }}>artist market page</div>
        </div>
        <div style={{ display: 'flex', fontSize: 62, fontWeight: 800, color: '#F4F5F6', letterSpacing: -2.5, marginTop: 22 }}>{label}</div>
        <div style={{ display: 'flex', gap: 40, marginTop: 10, fontSize: 24, color: '#9AA0A6' }}>
          <div style={{ display: 'flex' }}>{`avg sale ${fmt(s.avgPriceLast12Months || 0)}`}</div>
          <div style={{ display: 'flex' }}>{`record ${fmt(s.recordPrice || 0)}`}</div>
          <div style={{ display: 'flex', color: appr >= 0 ? '#2FBF71' : '#E5544B', fontWeight: 700 }}>
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
