'use client';

import { useMemo } from 'react';
import { ResponsiveContainer, AreaChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { PricePoint, AuctionLot } from '../types';
import type { LotCategory } from '../types';
import { formatPrice, categoryLabels, categoryColors } from '../utils';
import { useChartDraw } from '../hooks/useChartDraw';
import SectionMark from './SectionMark';

type CategoryFilter = 'all' | LotCategory;

interface CategoryPricing {
  category: string;
  count: number;
  avgPrice: number;
  recordPrice: number;
}

function formatAxis(value: number): string {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value}`;
}

const tooltipColors: Record<string, string> = { avgPrice: 'var(--color-fg)', highPrice: 'var(--color-accent-gold-text)', trendline: 'var(--color-accent-wine-text)' };
const tooltipLabels: Record<string, string> = { avgPrice: 'Avg', highPrice: 'High', trendline: 'Trend' };

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; dataKey: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'var(--color-bg-elevated)',
      border: '1px solid var(--color-border)',
      borderRadius: 10,
      padding: '10px 14px',
      fontFamily: "var(--font-sans), sans-serif",
    }}>
      <div style={{ fontSize: 12, color: 'var(--color-text-muted)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>
        {label}
      </div>
      {payload.filter(e => e.value != null).map((entry) => (
        <div key={entry.dataKey} style={{ fontSize: 13, color: tooltipColors[entry.dataKey] || 'var(--color-fg)', marginBottom: 1, fontWeight: 500 }}>
          {tooltipLabels[entry.dataKey] || entry.dataKey}: {formatAxis(entry.value)}
        </div>
      ))}
    </div>
  );
}

function computePriceHistory(lots: AuctionLot[]): PricePoint[] {
  const sold = lots.filter(l => l.status === 'sold' && l.priceUsd);
  if (sold.length === 0) return [];

  const quarters: Record<string, number[]> = {};
  for (const lot of sold) {
    const d = new Date(lot.saleDate);
    if (isNaN(d.getTime())) continue;
    // UTC getters: saleDate is date-only (UTC midnight); local getters can
    // shift a sale into the previous quarter/year depending on timezone.
    const q = Math.floor(d.getUTCMonth() / 3) + 1;
    const key = `${d.getUTCFullYear()} Q${q}`;
    if (!quarters[key]) quarters[key] = [];
    quarters[key].push(lot.priceUsd!);
  }

  return Object.entries(quarters)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, prices]) => ({
      date,
      avgPrice: prices.reduce((s, p) => s + p, 0) / prices.length,
      medianPrice: (() => { const s = prices.sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m]; })(),
      totalSales: prices.length,
      highPrice: Math.max(...prices),
    }));
}

interface Props {
  lots: AuctionLot[];
  allLots?: AuctionLot[];
  categoryFilter?: CategoryFilter;
  onCategoryChange?: (cat: CategoryFilter) => void;
  fallbackData?: PricePoint[];
  /** ghost ordinal behind the h2 band (headers only) */
  mark?: string;
}

export default function PriceChart({ lots, allLots, categoryFilter = 'all', onCategoryChange, fallbackData, mark }: Props) {
  const drawRef = useChartDraw();
  const data = useMemo(() => {
    const filtered = categoryFilter === 'all' ? lots : lots.filter(l => l.category === categoryFilter);
    const computed = computePriceHistory(filtered);
    const points = computed.length >= 2 ? computed : (categoryFilter === 'all' && fallbackData?.length ? fallbackData : computed);
    // Add 3-quarter moving average trendline
    const window = 3;
    return points.map((p, i) => {
      if (i < window - 1) return { ...p, trendline: undefined };
      const slice = points.slice(i - window + 1, i + 1);
      const avg = slice.reduce((s, q) => s + q.avgPrice, 0) / window;
      return { ...p, trendline: avg };
    });
  }, [lots, categoryFilter, fallbackData]);

  const catPricing = useMemo(() => {
    const source = allLots || lots;
    const catData: Record<string, { prices: number[]; count: number }> = {};
    for (const lot of source) {
      const cat = lot.category || 'unknown';
      if (cat === 'unknown') continue;
      if (!catData[cat]) catData[cat] = { prices: [], count: 0 };
      catData[cat].count++;
      if (lot.priceUsd && lot.status === 'sold') catData[cat].prices.push(lot.priceUsd);
    }
    return Object.entries(catData)
      .map(([cat, d]): CategoryPricing => ({
        category: cat,
        count: d.count,
        avgPrice: d.prices.length ? d.prices.reduce((s, p) => s + p, 0) / d.prices.length : 0,
        recordPrice: d.prices.length ? Math.max(...d.prices) : 0,
      }))
      .sort((a, b) => b.count - a.count);
  }, [allLots, lots]);

  const hasChart = data.length >= 2;
  const hasCategories = catPricing.length > 1;

  if (!hasChart && !hasCategories) return null;

  const filterLabel = categoryFilter !== 'all' ? ` — ${categoryLabels[categoryFilter]}` : '';
  const totalLots = (allLots || lots).length;

  return (
    <section className="ray-market rail">
      <style>{`
        .ray-market { padding-block: 40px 48px; }
        .ray-market-card {
          overflow: hidden;
        }
        .ray-chart-container { height: 300px; }
        .ray-cat-tr {
          cursor: pointer;
          transition: background var(--duration-fast) var(--ease-signature);
        }
        .ray-cat-tr:hover { background: var(--color-hover-item); }
        .ray-cat-td {
          padding: 11px 20px;
          font-size: 13px;
        }
        .ray-cat-td-right { text-align: right; }
        .ray-cat-divider {
          height: 1px;
          background: var(--color-border);
          margin: 0 20px;
        }
        @media (max-width: 768px) {
          .ray-market { padding-block: 32px 32px; }
          .ray-chart-container { height: 200px; }
          .ray-cat-record-col { display: none; }
          .ray-cat-td { padding: 10px 16px; font-size: 12px; }
          .ray-cat-divider { margin: 0 16px; }
        }
      `}</style>

      {/* Ghost ordinal clipped to the header band — never under the chart */}
      <div style={{ position: 'relative', overflow: 'hidden', marginBottom: 12 }}>
        {mark && <SectionMark n={mark} style={{ fontSize: 'clamp(96px, 12vw, 150px)' }} />}
        <h2 style={{
          position: 'relative',
          fontFamily: "var(--font-serif), serif",
          fontSize: 32,
          fontWeight: 300,
          letterSpacing: '-0.02em',
          padding: '16px 0 12px',
        }}>
          Price <span style={{ fontStyle: 'italic' }}>History</span>
          {filterLabel && (
            <span style={{ fontSize: 18, color: 'var(--color-text-muted)', fontStyle: 'normal', marginLeft: 8 }}>{filterLabel}</span>
          )}
        </h2>
      </div>

      <div className="ray-market-card glass glass-quiet">
        {/* Chart */}
        {hasChart && (
          <div style={{ padding: '20px 8px 0 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '0 20px 12px', }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--color-fg)', flexShrink: 0 }} />
                <span style={{ fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-text-faint)', fontWeight: 600 }}>
                  Avg
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--color-accent-gold)', flexShrink: 0 }} />
                <span style={{ fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-text-faint)', fontWeight: 600 }}>
                  High
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 12, height: 2, background: 'var(--color-accent-wine)', borderRadius: 1, flexShrink: 0 }} />
                <span style={{ fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-text-faint)', fontWeight: 600 }}>
                  Trend
                </span>
              </div>
            </div>
            <div className="ray-chart-container ray-chart-draw" ref={drawRef}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data} margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="ivoryGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-fg)" stopOpacity={0.08} />
                      <stop offset="100%" stopColor="var(--color-fg)" stopOpacity={0.01} />
                    </linearGradient>
                    <linearGradient id="goldGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-accent-gold)" stopOpacity={0.1} />
                      <stop offset="100%" stopColor="var(--color-accent-gold)" stopOpacity={0.01} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 12, fill: 'var(--color-text-faint)', fontFamily: "var(--font-sans), sans-serif" }}
                    axisLine={{ stroke: 'var(--color-border)' }}
                    tickLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tickFormatter={formatAxis}
                    tick={{ fontSize: 12, fill: 'var(--color-text-faint)', fontFamily: "var(--font-sans), sans-serif" }}
                    axisLine={false}
                    tickLine={false}
                    width={50}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="highPrice"
                    stroke="var(--color-accent-gold)"
                    strokeWidth={1}
                    fill="url(#goldGrad)"
                    strokeOpacity={0.35}
                    dot={false}
                  />
                  <Area
                    type="monotone"
                    dataKey="avgPrice"
                    stroke="var(--color-fg)"
                    strokeWidth={2}
                    fill="url(#ivoryGrad)"
                    dot={false}
                    activeDot={{ r: 3, fill: 'var(--color-fg)', stroke: 'var(--color-bg)', strokeWidth: 2 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="trendline"
                    stroke="var(--color-accent-wine)"
                    strokeWidth={2}
                    strokeDasharray="6 3"
                    dot={false}
                    connectNulls={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Category pricing table */}
        {hasCategories && onCategoryChange && (
          <div>
            {hasChart && (
              <div style={{
                height: 1,
                background: 'var(--color-border)',
                margin: hasChart ? '16px 0 0' : '0',
              }} />
            )}
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  <th style={{
                    fontSize: 12,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    color: 'var(--color-text-faint)',
                    fontWeight: 600,
                    padding: '12px 20px 8px',
                    textAlign: 'left',
                  }}>
                    Medium
                  </th>
                  <th style={{
                    fontSize: 12,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    color: 'var(--color-text-faint)',
                    fontWeight: 600,
                    padding: '12px 20px 8px',
                    textAlign: 'right',
                  }}>
                    Lots
                  </th>
                  <th style={{
                    fontSize: 12,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    color: 'var(--color-text-faint)',
                    fontWeight: 600,
                    padding: '12px 20px 8px',
                    textAlign: 'right',
                  }}>
                    Avg
                  </th>
                  <th className="ray-cat-record-col" style={{
                    fontSize: 12,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    color: 'var(--color-text-faint)',
                    fontWeight: 600,
                    padding: '12px 20px 8px',
                    textAlign: 'right',
                  }}>
                    Record
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td colSpan={4} style={{ padding: 0 }}>
                    <div className="ray-cat-divider" />
                  </td>
                </tr>
                <tr
                  className="ray-cat-tr"
                  onClick={() => onCategoryChange('all')}
                  style={{
                    background: categoryFilter === 'all' ? 'var(--color-hover-item)' : undefined,
                  }}
                >
                  <td className="ray-cat-td">
                    <span style={{
                      display: 'inline-block',
                      width: 7,
                      height: 7,
                      borderRadius: '50%',
                      background: categoryFilter === 'all' ? 'var(--color-accent-wine)' : 'var(--color-text-faint)',
                      marginRight: 10,
                      verticalAlign: 'middle',
                      opacity: categoryFilter === 'all' ? 1 : 0.35,
                      transition: 'background var(--duration-fast) var(--ease-signature), opacity var(--duration-fast) var(--ease-signature)',
                    }} />
                    <span style={{
                      fontWeight: categoryFilter === 'all' ? 600 : 400,
                      color: categoryFilter === 'all' ? 'var(--color-accent-wine-text)' : 'var(--color-fg)',
                      transition: 'color var(--duration-fast) var(--ease-signature)',
                    }}>
                      All
                    </span>
                  </td>
                  <td className="ray-cat-td ray-cat-td-right" style={{ color: 'var(--color-text-muted)' }}>
                    {totalLots}
                  </td>
                  <td className="ray-cat-td ray-cat-td-right" style={{ fontWeight: 500, color: 'var(--color-fg)' }}>
                    —
                  </td>
                  <td className="ray-cat-td ray-cat-td-right ray-cat-record-col" style={{ fontWeight: 500 }}>
                    —
                  </td>
                </tr>
                {catPricing.map((cat) => {
                  const color = categoryColors[cat.category] || 'var(--color-text-faint)';
                  const isActive = categoryFilter === cat.category;
                  return (
                    <tr
                      key={cat.category}
                      className="ray-cat-tr"
                      onClick={() => onCategoryChange(cat.category as CategoryFilter)}
                      style={{
                        background: isActive ? 'var(--color-hover-item)' : undefined,
                      }}
                    >
                      <td className="ray-cat-td">
                        <span style={{
                          display: 'inline-block',
                          width: 7,
                          height: 7,
                          borderRadius: '50%',
                          background: isActive ? 'var(--color-accent-wine)' : color,
                          marginRight: 10,
                          verticalAlign: 'middle',
                          opacity: isActive ? 1 : 0.5,
                          transition: 'background var(--duration-fast) var(--ease-signature), opacity var(--duration-fast) var(--ease-signature)',
                        }} />
                        <span style={{
                          fontWeight: isActive ? 600 : 400,
                          color: isActive ? 'var(--color-accent-wine-text)' : 'var(--color-fg)',
                          transition: 'color var(--duration-fast) var(--ease-signature)',
                        }}>
                          {categoryLabels[cat.category] || cat.category}
                        </span>
                      </td>
                      <td className="ray-cat-td ray-cat-td-right" style={{ color: 'var(--color-text-muted)' }}>
                        {cat.count}
                      </td>
                      <td className="ray-cat-td ray-cat-td-right" style={{ fontWeight: 500, color: 'var(--color-fg)' }}>
                        {cat.avgPrice > 0 ? formatPrice(cat.avgPrice) : '—'}
                      </td>
                      <td className="ray-cat-td ray-cat-td-right ray-cat-record-col" style={{ fontWeight: 500 }}>
                        {cat.recordPrice > 0 ? formatPrice(cat.recordPrice) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
