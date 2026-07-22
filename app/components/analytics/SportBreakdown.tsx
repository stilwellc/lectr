'use client';

import { useMemo } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, LabelList } from 'recharts';
import { AuctionLot } from '../../types';
import { formatPrice, formatMoneyAxis } from '../../utils';
import { useTheme } from '../ThemeProvider';

interface Props {
  allLots: AuctionLot[];
}

const formatAxis = formatMoneyAxis;

// Warm neutral ramps — same fg-into-bg doctrine as houseColorsHex: sports are
// coded by rank, not hue. Concrete hexes because recharts fills can't read
// var(). Other always wears the tail of the ramp.
const SPORT_RAMP: Record<'dark' | 'light', string[]> = {
  dark: ['#EDE6DA', '#E4DDD1', '#DBD4C8', '#D2CBBF', '#C9C2B6', '#C0B9AD', '#B7B0A4', '#AEA79B', '#A59E92', '#9C9589', '#938C80'],
  light: ['#241E15', '#2C261D', '#342E25', '#3C362D', '#443E35', '#4C463D', '#544E45', '#5C564D', '#645E55', '#6C665D', '#746E65'],
};

function SportTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { sport: string; totalValue: number; count: number } }> }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{
      background: 'var(--color-bg-elevated)',
      border: '1px solid var(--color-border)',
      borderRadius: 10,
      padding: '10px 14px',
      fontFamily: "var(--font-sans), sans-serif",
    }}>
      <div style={{ fontSize: 12, color: 'var(--color-text-muted)', letterSpacing: '-0.01em', textTransform: 'none', marginBottom: 6 }}>
        {d.sport}
      </div>
      <div style={{ fontSize: 13, color: 'var(--color-fg)', fontWeight: 500, marginBottom: 1 }}>
        Value: {formatPrice(d.totalValue)}
      </div>
      <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
        {d.count.toLocaleString()} lots
      </div>
    </div>
  );
}

/**
 * SportBreakdown — the Distributions "Sport" tab for the sports market only:
 * sold value ranked by sport, mirroring AuctionHouseDistribution's
 * ranked-horizontal-bars pattern. Other (title names no sport) pinned last.
 * Rendered embedded inside the Distributions band only.
 */
export default function SportBreakdown({ allLots, data }: Props & { data?: { sport: string; count: number; totalValue: number }[] }) {
  const { theme } = useTheme();
  const sportData = useMemo(() => {
    // build-time per-sport totals over the FULL corpus when available — the
    // sports vertical is the sold-archive SAMPLE on the client, so counting
    // `allLots` badly undercounts every sport's value.
    let ranked: { sport: string; count: number; totalValue: number }[];
    if (data?.length) {
      ranked = data.slice().sort((a, b) => b.totalValue - a.totalValue);
    } else {
      const map: Record<string, { count: number; totalValue: number }> = {};
      for (const l of allLots) {
        if (l.status !== 'sold' || !l.priceUsd) continue;
        const sport = l.sport ?? 'Other';
        if (!map[sport]) map[sport] = { count: 0, totalValue: 0 };
        map[sport].count++;
        map[sport].totalValue += l.priceUsd;
      }
      ranked = Object.entries(map)
        .map(([sport, d]) => ({ sport, count: d.count, totalValue: d.totalValue }))
        .sort((a, b) => b.totalValue - a.totalValue);
    }
    const ramp = SPORT_RAMP[theme];
    // Other = the unattributed remainder — pinned last, never ranked
    const pinned = [...ranked.filter(r => r.sport !== 'Other'), ...ranked.filter(r => r.sport === 'Other')];
    return pinned.map((r, i) => ({ ...r, fill: ramp[Math.min(i, ramp.length - 1)] }));
  }, [allLots, theme, data]);

  if (sportData.length === 0) return null;

  const chartHeight = sportData.length * 30 + 40;

  return (
    <div className="glass glass-quiet" style={{ overflow: 'hidden' }}>
      <div style={{ padding: '20px 8px 12px 0' }}>
        <div style={{ height: chartHeight }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={sportData} layout="vertical" margin={{ top: 4, right: 56, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
              <XAxis
                type="number"
                tickFormatter={formatAxis}
                tick={{ fontSize: 11, fill: 'var(--color-text-faint)', fontFamily: "var(--font-sans), sans-serif" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="sport"
                tick={{ fontSize: 12, fill: 'var(--color-text-secondary)', fontFamily: "var(--font-sans), sans-serif" }}
                axisLine={false}
                tickLine={false}
                width={92}
                interval={0}
              />
              <Tooltip content={<SportTooltip />} cursor={{ fill: 'var(--color-hover-item)' }} />
              <Bar dataKey="totalValue" radius={[0, 4, 4, 0]} barSize={14}>
                {sportData.map((entry, i) => (
                  <Cell key={i} fill={entry.fill} fillOpacity={0.75} />
                ))}
                <LabelList dataKey="totalValue" position="right" formatter={(v: number) => formatAxis(v)} style={{ fill: 'var(--color-text-muted)', fontSize: 11, fontFamily: 'var(--font-sans), sans-serif' }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
