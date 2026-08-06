'use client';

import { useMemo } from 'react';
import type { MarketData, DemandByMarket, HedonicHorizon } from '../../hooks/useRayData';
import type { RealizedByMarket } from '../../hooks/useRayData';
import type { RealizedPoint } from '../../types';
import type { Market } from '../../constants';
import { MARKETS } from '../../constants';
import { useMarket } from '../../lib/market';
import { CIBeam, DemandLine } from './SubMarketBoard';
import { fmtInt, fmtMoneyCompact } from './hooks';
import { fmtPct } from './verified';
import styles from './style.module.css';

/* ============================================================
   THE MARKET TAPE — the hero's stage, in the 02 board's grammar.

   Replaces the multi-line HeroChart, which drew six base-100-rebased
   index lines AND a demand median on one stage: two different measures
   sharing axes, which is why it read as a portfolio but wasn't.

   One row per vertical, on the same honesty ladder as the sub-market
   tape: a CI-gated hedonic index where one publishes (market.hedonic —
   shipped by build-market since Jul 2026, consumed nowhere until now),
   else the measured demand read, else the realized-$ descriptive. As of
   Aug 2026 only Art clears the CI bar at this altitude — that scarcity
   is the point, and the tape says so instead of drawing around it.

   Scoped to a market, the tape becomes that vertical's HORIZON LADDER:
   every horizon is a gated claim (1Y/3Y/5Y/MAX), and an unpublishable
   horizon prints its abstention reason verbatim. This keeps the old
   1Y/3Y/5Y/ALL toggle's *idea* but makes each window an honest claim
   rather than a slice of a demand line.

   Row click = the market pill click (the same in-place setMarket swap),
   so the tape is also a picker — the pills above stay as the primary
   toggle because they scope the whole page, not just the hero.
   ============================================================ */

const HORIZON_PREF = ['5Y', '3Y', '1Y'] as const; // the house rule: longest CI-resolved horizon (verified.ts)
const LADDER_ORDER = ['1Y', '3Y', '5Y', 'MAX'] as const;

interface TapeRowData {
  key: Market;
  label: string;
  read:
    | { kind: 'index'; horizon: string; changePct: number; ciLo: number; ciHi: number; n: number }
    | { kind: 'demand'; now: number; series: { period: string; value: number }[]; qN: number }
    | { kind: 'descriptive'; typicalUsd: number; qN: number; series: { period: string; value: number }[] };
  /** vertical corpus size, for the row sub */
  lots: number;
}

function resolveTape(
  market: MarketData | null,
  demandAll: DemandByMarket,
  realized: RealizedByMarket,
): TapeRowData[] {
  const rows: TapeRowData[] = [];
  for (const m of MARKETS) {
    if (m.key === 'all') continue;
    const lots = market?.markets?.[m.key]?.n ?? 0;

    // 1 — certified: the vertical's own CI-gated hedonic read
    const hz = market?.hedonic?.[m.key]?.horizons;
    let pick: HedonicHorizon | null = null;
    let pickKey = '';
    for (const h of HORIZON_PREF) {
      const x = hz?.[h];
      if (x?.publishable && x.changePct != null) { pick = x; pickKey = h; break; }
    }
    if (pick) {
      rows.push({
        key: m.key, label: m.label, lots,
        read: {
          kind: 'index', horizon: pickKey, changePct: pick.changePct as number,
          ciLo: pick.ciLoPct ?? (pick.changePct as number), ciHi: pick.ciHiPct ?? (pick.changePct as number),
          n: pick.nEnd ?? 0,
        },
      });
      continue;
    }

    // 2 — measured demand (%-over-estimate), where estimates exist
    const d = demandAll[m.key] || [];
    if (d.length >= 2) {
      rows.push({
        key: m.key, label: m.label, lots,
        read: {
          kind: 'demand', now: d[d.length - 1].value,
          series: d.map((p) => ({ period: p.date, value: p.value })),
          qN: d[d.length - 1].n,
        },
      });
      continue;
    }

    // 3 — descriptive: the realized-$ cohort median (no estimates to read against)
    const rz = (realized[m.key] as RealizedPoint[] | undefined) || [];
    if (rz.length) {
      rows.push({
        key: m.key, label: m.label, lots,
        read: {
          kind: 'descriptive', typicalUsd: rz[rz.length - 1].value, qN: rz[rz.length - 1].n,
          series: rz.map((p) => ({ period: p.date, value: p.value })),
        },
      });
    }
  }
  // certified first — the scarce tier leads and its scarcity reads as meaning —
  // then demand by strength, then descriptive by size. Same rank as the 02 board.
  const rank = { index: 0, demand: 1, descriptive: 2 } as const;
  return rows.sort((a, b) =>
    rank[a.read.kind] - rank[b.read.kind] ||
    (b.read.kind === 'demand' && a.read.kind === 'demand' ? b.read.now - a.read.now : b.lots - a.lots));
}

const tagFor = (kind: TapeRowData['read']['kind']): string =>
  kind === 'index' ? 'Hedonic index · 95% CI' : kind === 'demand' ? 'Demand read' : 'Descriptive — no estimates';

const fmtCI = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(0)}`;

/** the lead read — the row the monument enthrones. Certified beats measured
    beats descriptive, so as more verticals clear the CI bar the monument
    upgrades itself; today it is Art's certified 5Y. */
export function pickLead(
  market: MarketData | null,
  demandAll: DemandByMarket,
  realized: RealizedByMarket,
): TapeRowData | null {
  return resolveTape(market, demandAll, realized)[0] ?? null;
}

/** THE MONUMENT — the hero's focal object. The big demand-median numeral is
    gone (it was one number wearing the whole market); its place is taken by
    the product's signature instrument at display scale: the strongest honest
    read, drawn as the full CI beam with its bounds, or the demand line where
    nothing certifies. Clicking it scopes to that market, like any tape row. */
export function TapeMonument({ row, play }: { row: TapeRowData; play: boolean }) {
  const { setMarket } = useMarket();
  const r = row.read;
  return (
    <button type="button" className={styles.mtMon} onClick={() => setMarket(row.key)}
      aria-label={`${row.label} — open the ${row.label} lander`}>
      <span className={styles.mtMonKicker}>
        {r.kind === 'index' ? 'The certified read' : r.kind === 'demand' ? 'The strongest read' : 'The read'}
      </span>
      <span className={styles.mtMonMarket}>{row.label}</span>
      {r.kind === 'index' && (
        <>
          <span className={`${styles.mtMonFigure} ${styles.pctData}`} data-dir={r.changePct >= 0 ? 'up' : 'down'}>
            {fmtPct(r.changePct)}
          </span>
          <span className={styles.mtMonBeam}><CIBeam lo={r.ciLo} hi={r.ciHi} point={r.changePct}
            dir={r.changePct >= 0 ? 'up' : 'down'} play={play} large /></span>
          <span className={styles.mtMonSub}>
            hedonic index · past {r.horizon.replace('Y', r.horizon === '1Y' ? ' year' : ' years')} · {fmtInt(row.lots)} lots
          </span>
        </>
      )}
      {r.kind === 'demand' && (
        <>
          <span className={`${styles.mtMonFigure} ${styles.pctData}`} data-dir={r.now >= 0 ? 'up' : 'down'}>
            {fmtPct(r.now)}
          </span>
          <span className={styles.mtMonBeam}>{r.series.length >= 2 && <DemandLine series={r.series} />}</span>
          <span className={styles.mtMonSub}>demand · sold over estimate · {fmtInt(row.lots)} lots</span>
        </>
      )}
      {r.kind === 'descriptive' && (
        <>
          <span className={styles.mtMonFigure}>{fmtMoneyCompact(r.typicalUsd)}</span>
          <span className={styles.mtMonSub}>typical at hammer · {fmtInt(row.lots)} lots</span>
        </>
      )}
    </button>
  );
}

/** the all-markets stage: one row per vertical, one honest read each */
export function MarketTape({ market, demandAll, realized, play, omit }: {
  market: MarketData | null;
  demandAll: DemandByMarket;
  realized: RealizedByMarket;
  play: boolean;
  /** the vertical the monument already shows — never printed twice */
  omit?: Market;
}) {
  const { setMarket } = useMarket();
  const rows = useMemo(
    () => resolveTape(market, demandAll, realized).filter((r) => r.key !== omit),
    [market, demandAll, realized, omit]);
  if (!rows.length) return null;
  return (
    <div className={styles.mtTape} role="list">
      {rows.map((r) => (
        <button
          key={r.key} type="button" role="listitem" className={styles.mtRow}
          onClick={() => setMarket(r.key)}
          aria-label={`${r.label} — open the ${r.label} lander`}
        >
          <span className={styles.mtLabelBlock}>
            <span className={styles.mtLabel}>{r.label}</span>
            <span className={styles.mtTag}>{tagFor(r.read.kind)}</span>
          </span>
          <span className={styles.mtInstrument} aria-hidden>
            {r.read.kind === 'index' && (
              <CIBeam mini lo={r.read.ciLo} hi={r.read.ciHi} point={r.read.changePct}
                dir={r.read.changePct >= 0 ? 'up' : 'down'} play={play} />
            )}
            {r.read.kind === 'demand' && r.read.series.length >= 2 && <DemandLine mini series={r.read.series} />}
            {r.read.kind === 'descriptive' && (r.read.series.length >= 2
              ? <DemandLine mini series={r.read.series} />
              : <span className={styles.mtAbstain}>—</span>)}
          </span>
          <span className={styles.mtRight}>
            {r.read.kind === 'index' && (
              <>
                <span className={`${styles.mtFigure} ${styles.pctData}`} data-dir={r.read.changePct >= 0 ? 'up' : 'down'}>
                  {fmtPct(r.read.changePct)} · {r.read.horizon}
                </span>
                <span className={styles.mtSub}>CI {fmtCI(r.read.ciLo)} to {fmtCI(r.read.ciHi)} · {fmtInt(r.lots)} lots</span>
              </>
            )}
            {r.read.kind === 'demand' && (
              <>
                <span className={`${styles.mtFigure} ${styles.pctData}`} data-dir={r.read.now >= 0 ? 'up' : 'down'}>
                  {fmtPct(r.read.now)}
                </span>
                <span className={styles.mtSub}>over estimate · {fmtInt(r.lots)} lots</span>
              </>
            )}
            {r.read.kind === 'descriptive' && (
              <>
                <span className={styles.mtFigure}>Typical {fmtMoneyCompact(r.read.typicalUsd)}</span>
                <span className={styles.mtSub}>at hammer · {fmtInt(r.lots)} lots</span>
              </>
            )}
          </span>
        </button>
      ))}
    </div>
  );
}

/** the scoped stage: the vertical's horizon ladder, abstentions included */
export function HorizonLadder({ activeKey, market, play }: {
  activeKey: Market;
  market: MarketData | null;
  play: boolean;
}) {
  const hz = market?.hedonic?.[activeKey]?.horizons;
  const rows = LADDER_ORDER
    .map((k) => ({ k: k as string, x: hz?.[k] }))
    .filter((r): r is { k: string; x: HedonicHorizon } => !!r.x && (r.x.publishable || !!r.x.reason));
  if (!rows.length) {
    // no horizon carries even an abstention reason — say so once, plainly
    return (
      <div className={styles.mtLadderEmpty}>
        No certified price index at this altitude — no horizon&rsquo;s 95% CI resolves the sign.
        The certified reads for this market live in its sub-market rows below.
      </div>
    );
  }
  return (
    <div className={styles.mtLadder} role="list">
      {rows.map(({ k, x }) => (
        <div key={k} role="listitem" className={styles.mtRow} data-static="true">
          <span className={styles.mtLabelBlock}>
            <span className={styles.mtLabel}>{k === 'MAX' ? 'All time' : `Past ${k.replace('Y', k === '1Y' ? ' year' : ' years')}`}</span>
            <span className={styles.mtTag}>{x.publishable ? 'Hedonic index · 95% CI' : 'Abstains'}</span>
          </span>
          <span className={styles.mtInstrument} aria-hidden>
            {x.publishable && x.changePct != null
              ? <CIBeam mini lo={x.ciLoPct ?? x.changePct} hi={x.ciHiPct ?? x.changePct} point={x.changePct}
                  dir={x.changePct >= 0 ? 'up' : 'down'} play={play} />
              : <span className={styles.mtAbstain}>—</span>}
          </span>
          <span className={styles.mtRight}>
            {x.publishable && x.changePct != null ? (
              <>
                <span className={`${styles.mtFigure} ${styles.pctData}`} data-dir={x.changePct >= 0 ? 'up' : 'down'}>
                  {fmtPct(x.changePct)}
                </span>
                <span className={styles.mtSub}>
                  CI {fmtCI(x.ciLoPct ?? x.changePct)} to {fmtCI(x.ciHiPct ?? x.changePct)}{x.nEnd ? ` · n ${fmtInt(x.nEnd)}` : ''}
                </span>
              </>
            ) : (
              // the abstention IS the content — the pipeline's reason, verbatim
              <span className={styles.mtReason}>{x.reason || 'CI spans zero — direction unresolved'}</span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
