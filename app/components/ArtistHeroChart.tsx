'use client';

/**
 * The maker hero's area chart, split out of ArtistHero so recharts (~100KB
 * gz) leaves the maker page's initial bundle: ArtistHero mounts this through
 * next/dynamic (ssr:false) inside its fixed-height .ray-hero2-chart well, so
 * the layout is settled before the module lands.
 */
import { ResponsiveContainer, AreaChart, Area, YAxis, Tooltip, ReferenceLine } from 'recharts';

export interface HeroPoint { date: string; value: number; n: number }

export default function ArtistHeroChart({ data, bidMarket, lineColor, onHover }: {
  data: HeroPoint[];
  bidMarket: boolean;
  lineColor: string;
  onHover: (p: HeroPoint | null) => void;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart
        data={data}
        margin={{ top: 8, right: 0, left: 0, bottom: 0 }}
        onMouseMove={(s: { activePayload?: Array<{ payload: HeroPoint }> }) => {
          const p = s?.activePayload?.[0]?.payload;
          if (p) onHover({ date: p.date, value: p.value, n: p.n });
        }}
        onMouseLeave={() => onHover(null)}
      >
        <defs>
          <linearGradient id="artistHeroGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={lineColor} stopOpacity={0.13} />
            <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
          </linearGradient>
        </defs>
        <YAxis hide domain={bidMarket ? [(min: number) => min * 0.85, (max: number) => max * 1.05] : [(min: number) => Math.min(0, min), (max: number) => Math.max(0, max)]} />
        {!bidMarket && <ReferenceLine y={0} stroke="var(--color-border-mid)" strokeDasharray="4 4" />}
        <Tooltip content={() => null} cursor={{ stroke: 'var(--color-border-mid)', strokeWidth: 1 }} />
        <Area
          type="monotone"
          dataKey="value"
          stroke={lineColor}
          strokeWidth={2.25}
          fill="url(#artistHeroGrad)"
          dot={false}
          activeDot={{ r: 4, fill: lineColor, stroke: 'var(--color-bg)', strokeWidth: 2 }}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
