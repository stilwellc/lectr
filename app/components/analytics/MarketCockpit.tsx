'use client';
/**
 * MarketCockpit — the research desk's market-microstructure dashboard,
 * taken directly from the ElevenLabs Calls/Latency/CSAT panel grammar:
 * a <StatRow> of stat tabs (small gray label over a tabular value, the
 * active stat underlined 2px ink) over ONE thin ink hairline chart, with
 * a white <AnnoChip> riding the line at its terminal point.
 *
 * It merges the desk's former twin cards into one instrument:
 *   · Sell-through  — % of offered lots finding a buyer, quarterly
 *                     (bought-ins observed, never inferred)
 *   · Market depth  — sales per quarter; liquidity, NOT price — counts
 *                     are never dressed as price movement, and the
 *                     current partial quarter stays excluded
 *   · Hottest month — the calendar's best hammer-vs-estimate month,
 *                     same gates as the calendar strip (months under
 *                     30 sales suppressed; the read only prints when
 *                     ≥8 months clear the floor)
 *
 * Each tab keeps its own right-aligned method line; every honesty gate
 * from the merged cards survives verbatim. The chip's y is computed from
 * the chart's own scale (HeroChart's pane math: padTop 18 / padBot 22 /
 * 10% domain padding), so it pins to the terminus, not a guess.
 */
import React, { useMemo, useState } from 'react';
import HeroChart from '../../preview/terminal/HeroChart';
import type { MarketData } from '../../hooks/useRayData';
import { StatRow, AnnoChip } from '../cells';
import { toneOf, fmtSignedPct } from '../../utils';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_MIN_N = 30;          // per-month floor — matches the pipeline's gate
const MONTH_MIN_USABLE = 8;      // the hottest-month read needs most of a calendar

const CHART_H = 150;
// HeroChart's compact pane constants — the chip rides the chart's own scale
const PAD_TOP = 18;
const PAD_BOT = 22;

/** y (px) of a window's terminal value under HeroChart's compact pane math */
function terminusY(values: number[], h: number): number {
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) { min -= 1; max += 1; }
  const pad = (max - min) * 0.10;
  min -= pad; max += pad;
  const last = values[values.length - 1];
  const y = PAD_TOP + (1 - (last - min) / (max - min)) * (h - PAD_TOP - PAD_BOT);
  return Math.max(8, Math.min(h - 34, y));
}

/** the chip rides ABOVE its point unless the point rides too high — then it
    drops below instead of overflowing the stage (never clipped, never wrong) */
const chipLift = (y: number) =>
  y < 56 ? 'translateY(12px)' : 'translateY(calc(-100% - 10px))';

const CSS = `
.ray-mc.ray-vm-card{padding:var(--card-pad)}
@media(min-width:641px){.ray-mc .ns-statrow{gap:0 32px}}
.ray-mc-method{display:block;text-align:right;font-size:10.5px;color:var(--color-text-muted);margin:0 0 6px}
/* phone: the method note joins the reading edge — a right-orphaned caption
   under wrapped tabs reads as collapsed-desktop debris */
@media(max-width:640px){.ray-mc-method{text-align:left}}
.ray-mc-stage{position:relative}
.ray-mc-chip{position:absolute;pointer-events:none;z-index:2}
.ray-mc-mos{display:grid;grid-template-columns:repeat(12,1fr);margin-top:4px}
.ray-mc-mo{font-size:10px;color:var(--color-text-muted);text-align:center}
.ray-mc-mo[data-gated]{opacity:0.4}
.ray-mc-dot{position:absolute;width:6px;height:6px;border-radius:50%;background:var(--color-fg);transform:translate(-50%,-50%)}
`;

/* ── the calendar hairline — 12 month positions, segments broken at
   suppressed months (a line through a gated month would invent data) ── */
function MonthLine({ cells, bestIdx }: {
  cells: { n: number; hammerMedPct: number }[];
  bestIdx: number;
}) {
  const usable = cells.map(c => c.n >= MONTH_MIN_N);
  const vals = cells.filter((_, i) => usable[i]).map(c => c.hammerMedPct);
  let min = Math.min(...vals), max = Math.max(...vals);
  if (min === max) { min -= 1; max += 1; }
  const pad = (max - min) * 0.12;
  min -= pad; max += pad;
  const xPct = (i: number) => 4 + (i / 11) * 92;
  const yPct = (v: number) => 12 + (1 - (v - min) / (max - min)) * 72;

  // polyline segments between CONSECUTIVE usable months only
  const segs: string[] = [];
  let cur: string[] = [];
  cells.forEach((c, i) => {
    if (usable[i]) cur.push(`${xPct(i).toFixed(2)},${yPct(c.hammerMedPct).toFixed(2)}`);
    else { if (cur.length > 1) segs.push(cur.join(' ')); cur = []; }
  });
  if (cur.length > 1) segs.push(cur.join(' '));

  const zeroIn = min < 0 && max > 0;
  const best = cells[bestIdx];
  // the chip hugs inward at either calendar edge and drops below a
  // point that rides too high — never clipped by the stage
  const chipX = bestIdx >= 9 ? '-100%' : bestIdx <= 1 ? '0%' : '-50%';
  const bestY = (yPct(best.hammerMedPct) / 100) * CHART_H;
  const chipY = bestY < 56 ? '12px' : 'calc(-100% - 10px)';

  return (
    <div>
      <div className="ray-mc-stage" style={{ height: CHART_H }} role="img" aria-label="Hammer vs estimate by calendar month">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} aria-hidden>
          {zeroIn && (
            <line x1={0} x2={100} y1={yPct(0)} y2={yPct(0)} stroke="var(--chart-grid)" strokeWidth={1}
              strokeDasharray="1 3" vectorEffect="non-scaling-stroke" />
          )}
          {segs.map((s, i) => (
            <polyline key={i} points={s} fill="none" stroke="var(--color-fg)" strokeWidth={1.6}
              strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
        {cells.map((c, i) => usable[i] ? (
          <span key={MONTHS[i]} className="ray-mc-dot" aria-hidden style={{
            left: `${xPct(i)}%`, top: `${(yPct(c.hammerMedPct) / 100) * CHART_H}px`,
            ...(i === bestIdx ? { width: 8, height: 8 } : null),
          }} />
        ) : null)}
        <span className="ray-mc-chip" style={{
          left: `${xPct(bestIdx)}%`,
          top: bestY,
          transform: `translate(${chipX}, ${chipY})`,
        }}>
          <AnnoChip k={`${MONTHS[bestIdx]} · ${best.n.toLocaleString()} sales`} v={fmtSignedPct(best.hammerMedPct)}
            dir={toneOf(best.hammerMedPct) === 'up' ? 'up' : toneOf(best.hammerMedPct) === 'down' ? 'down' : undefined} />
        </span>
      </div>
      <div className="ray-mc-mos" aria-hidden>
        {MONTHS.map((m, i) => <span key={m} className="ray-mc-mo" data-gated={usable[i] ? undefined : ''}>{m}</span>)}
      </div>
    </div>
  );
}

export default function MarketCockpit({ marketData, scope }: { marketData: MarketData | null; scope: string }) {
  const [activeId, setActiveId] = useState('st');

  const tabs = useMemo(() => {
    const out: {
      id: string;
      label: string;
      value: React.ReactNode;
      method: string;
      chart: React.ReactNode;
    }[] = [];

    // ── sell-through — same window and gates as the former card ──
    const st = marketData?.markets?.[scope]?.sellThrough || [];
    if (st.length >= 8) {
      const win = st.slice(-24);
      const last = win[win.length - 1];
      out.push({
        id: 'st',
        label: 'Sell-through',
        value: `${Math.round(last.value)}%`,
        method: 'sold ÷ offered · quarterly · bought-ins observed, never inferred',
        chart: (
          <div className="ray-mc-stage">
            <HeroChart
              anchor={{ key: '_st', label: 'Sell-through', color: '', unit: 'pct', points: win.map(p => ({ period: p.period, value: p.value, n: p.n ?? 0 })) }}
              height={CHART_H}
              compact
              hideTickLabels
              play={false}
            />
            {(() => { const y = terminusY(win.map(p => p.value), CHART_H); return (
              <span className="ray-mc-chip" style={{ right: 6, top: y, transform: chipLift(y) }}>
                <AnnoChip k={last.period} v={`${Math.round(last.value)}% of offered lots sold`} />
              </span>
            ); })()}
          </div>
        ),
      });
    }

    // ── market depth — the current partial quarter stays excluded ──
    const vol = marketData?.markets?.[scope]?.volume || [];
    if (vol.length >= 8) {
      const win = vol.slice(-25, -1);
      if (win.length >= 8) {
        const last = win[win.length - 1];
        out.push({
          id: 'depth',
          label: 'Market depth',
          value: Math.round(last.value).toLocaleString(),
          method: 'sales per quarter · liquidity, not price · current partial quarter excluded',
          chart: (
            <div className="ray-mc-stage">
              <HeroChart
                anchor={{ key: '_vol', label: 'Sales', color: '', unit: 'count', points: win.map(p => ({ period: p.period, value: p.value, n: p.n ?? 0 })) }}
                height={CHART_H}
                compact
                hideTickLabels
                play={false}
              />
              {(() => { const y = terminusY(win.map(p => p.value), CHART_H); return (
                <span className="ray-mc-chip" style={{ right: 6, top: y, transform: chipLift(y) }}>
                  <AnnoChip k={last.period} v={`${Math.round(last.value).toLocaleString()} sales settled`} />
                </span>
              ); })()}
            </div>
          ),
        });
      }
    }

    // ── hottest month — the calendar's gates, verbatim: months under
    // n=30 suppressed, the read only prints on ≥8 usable months, and a
    // scoped market never silently shows the global calendar ──
    const seasonality = marketData?.seasonality;
    const cells = seasonality?.[scope] ?? (scope === 'all' ? seasonality?.all : undefined);
    if (cells && cells.length === 12) {
      const usable = cells.map((c, i) => ({ i, pct: c.hammerMedPct, n: c.n })).filter(r => r.n >= MONTH_MIN_N);
      if (usable.length >= MONTH_MIN_USABLE) {
        const best = usable.reduce((a, b) => (b.pct > a.pct ? b : a));
        const totalN = usable.reduce((s, r) => s + r.n, 0);
        out.push({
          id: 'month',
          label: 'Hottest month',
          value: `${MONTHS[best.i]} ${fmtSignedPct(best.pct)}`,
          method: `hammer vs estimate by calendar month · trailing full-history · ${totalN.toLocaleString()} sales · months under ${MONTH_MIN_N} suppressed`,
          chart: <MonthLine cells={cells} bestIdx={best.i} />,
        });
      }
    }

    return out;
  }, [marketData, scope]);

  if (!tabs.length) return null;
  // scope changes can retire the active stat — fall back to the first tab
  const idx = tabs.findIndex(t => t.id === activeId);
  const active = idx === -1 ? 0 : idx;
  const tab = tabs[active];

  return (
    <div className="ray-mc ray-vm ray-vm-card glass glass-quiet">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <StatRow
        stats={tabs.map(t => ({ label: t.label, value: t.value }))}
        active={active}
        onSelect={i => setActiveId(tabs[i].id)}
      />
      <span className="ray-mc-method">{tab.method}</span>
      {tab.chart}
    </div>
  );
}
