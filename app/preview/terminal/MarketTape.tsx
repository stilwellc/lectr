'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import type { MarketData, DemandByMarket, HedonicHorizon, SubMarketRead } from '../../hooks/useRayData';
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

interface TapeRowData {
  key: Market;
  label: string;
  read:
    | { kind: 'index'; method: 'repeat-sale' | 'hedonic' | 'composite'; horizon: string;
        changePct: number; ciLo: number; ciHi: number; n: number;
        /** the identity/population the read covers — printed, never implied */
        scope?: string | null }
    | { kind: 'demand'; now: number; series: { period: string; value: number }[]; qN: number }
    | { kind: 'descriptive'; typicalUsd: number; qN: number; series: { period: string; value: number }[] };
  /** vertical corpus size, for the row sub */
  lots: number;
}

const RS_HORIZON_PREF = ['5Y', '3Y', '1Y'] as const;

function resolveTape(
  market: MarketData | null,
  demandAll: DemandByMarket,
  realized: RealizedByMarket,
): TapeRowData[] {
  const rows: TapeRowData[] = [];
  for (const m of MARKETS) {
    if (m.key === 'all') continue;
    const lots = market?.markets?.[m.key]?.n ?? 0;

    // ── THE LADDER, best rung first (repeat-sale > hedonic > composite >
    //    demand > typical). Each rung publishes only what its own gates
    //    certified upstream; this file never re-decides statistics.

    // 1 — repeat-sale: the same object/model priced twice. No quality-mix
    //     assumption at all, which is why it outranks the hedonic — with ONE
    //     refinement: at vertical altitude a SCOPED repeat-sale (art's covers
    //     prints & multiples only) yields to an UNSCOPED certified hedonic of
    //     the whole vertical. A prints figure must not wear the Art headline
    //     while a whole-vertical read exists; the scoped read still leads its
    //     own drill row (art:prints) directly below. Sports' cards-scoped read
    //     leads because nothing unscoped certifies there — and says "cards".
    const rs = market?.repeatSale?.[m.key];
    const unscopedHedonicExists = HORIZON_PREF.some((h) => {
      const x = market?.hedonic?.[m.key]?.horizons?.[h];
      return !!(x?.publishable && x.changePct != null);
    });
    let placedRs = false;
    if (rs && !(rs.scope && unscopedHedonicExists)) {
      for (const h of RS_HORIZON_PREF) {
        const x = rs.horizons?.[h];
        if (x?.publishable && x.changePct != null) {
          rows.push({
            key: m.key, label: m.label, lots,
            read: {
              kind: 'index', method: 'repeat-sale', horizon: h, changePct: x.changePct,
              ciLo: x.ciLoPct ?? x.changePct, ciHi: x.ciHiPct ?? x.changePct,
              n: rs.nPairs, scope: rs.scope,
            },
          });
          placedRs = true; break;
        }
      }
    }
    if (placedRs) continue;

    // 2 — the vertical's own CI-gated hedonic read
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
          kind: 'index', method: 'hedonic', horizon: pickKey, changePct: pick.changePct as number,
          ciLo: pick.ciLoPct ?? (pick.changePct as number), ciHi: pick.ciHiPct ?? (pick.changePct as number),
          n: pick.nEnd ?? 0,
        },
      });
      continue;
    }

    // 3 — the bottom-up composite (same CI discipline, assembled from the
    //     vertical's publishable makers — watches 5Y ships this today and it
    //     was consumed NOWHERE until Aug 2026)
    const comp = (market?.hedonic?.[m.key] as { composite?: { horizons?: Record<string, HedonicHorizon> } } | undefined)?.composite;
    if (comp) {
      let placed = false;
      for (const h of HORIZON_PREF) {
        const x = comp.horizons?.[h];
        if (x?.publishable && x.changePct != null) {
          rows.push({
            key: m.key, label: m.label, lots,
            read: {
              kind: 'index', method: 'composite', horizon: h, changePct: x.changePct,
              ciLo: x.ciLoPct ?? x.changePct, ciHi: x.ciHiPct ?? x.changePct,
              n: x.nEnd ?? 0,
            },
          });
          placed = true; break;
        }
      }
      if (placed) continue;
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

const tagFor = (read: TapeRowData['read']): string => {
  if (read.kind === 'index') {
    const m = read.method === 'repeat-sale' ? 'Repeat-sale index'
      : read.method === 'composite' ? 'Hedonic composite' : 'Hedonic index';
    return `${m} · 95% CI${read.scope ? ` · ${read.scope}` : ''}`;
  }
  return read.kind === 'demand' ? 'Demand read' : 'Descriptive';
};

const fmtCI = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(0)}`;

/** direction of a value series — last vs first — for coloring a descriptive
    (price) sparkline green/red the way demand reads already sign. */
const seriesDir = (s: { value: number }[]): 'up' | 'down' | undefined =>
  s.length >= 2 ? (s[s.length - 1].value >= s[0].value ? 'up' : 'down') : undefined;

/** the lead read — the row the monument enthrones. Certified beats measured
    beats descriptive, so as more verticals clear the CI bar the monument
    upgrades itself; today it is Art's certified 5Y. Scoped, it is that
    vertical's own strongest read. */
export function pickLead(
  market: MarketData | null,
  demandAll: DemandByMarket,
  realized: RealizedByMarket,
  scope?: Market,
): TapeRowData | null {
  const rows = resolveTape(market, demandAll, realized);
  if (scope && scope !== 'all') return rows.find((r) => r.key === scope) ?? null;
  return rows[0] ?? null;
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
    <button type="button" className={styles.mtMon} data-play={play ? 'true' : undefined}
      data-dir={r.kind === 'index' ? (r.changePct >= 0 ? 'up' : 'down') : r.kind === 'demand' ? (r.now >= 0 ? 'up' : 'down') : undefined}
      onClick={() => setMarket(row.key)}
      aria-label={`${row.label} — open the ${row.label} lander`}>
      <span className={styles.mtMonKicker}>
        {r.kind === 'index'
          ? (r.method === 'repeat-sale' ? 'Certified · repeat-sale' : r.method === 'composite' ? 'Certified · composite' : 'Certified · hedonic')
          : r.kind === 'demand' ? 'The strongest read' : 'The read'}
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
            {r.method === 'repeat-sale'
              ? `same ${row.key === 'sports' ? 'card' : row.key === 'watches' ? 'reference' : 'edition'} resold · past ${r.horizon.replace('Y', r.horizon === '1Y' ? ' year' : ' years')} · ${fmtInt(r.n)} pairs${r.scope ? ` · ${r.scope}` : ''}`
              : `${r.method === 'composite' ? 'hedonic composite' : 'hedonic index'} · past ${r.horizon.replace('Y', r.horizon === '1Y' ? ' year' : ' years')} · ${fmtInt(row.lots)} lots`}
          </span>
        </>
      )}
      {r.kind === 'demand' && (
        <>
          <span className={`${styles.mtMonFigure} ${styles.pctData}`} data-dir={r.now >= 0 ? 'up' : 'down'}>
            {fmtPct(r.now)}
          </span>
          <span className={styles.mtMonBeam}>{r.series.length >= 2 && <DemandLine series={r.series} dir={r.now >= 0 ? 'up' : 'down'} />}</span>
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
    <div className={styles.mtTape} role="list" data-play={play ? 'true' : undefined}>
      {rows.map((r) => (
        <button
          key={r.key} type="button" role="listitem" className={styles.mtRow}
          onClick={() => setMarket(r.key)}
          aria-label={`${r.label} — open the ${r.label} lander`}
        >
          <span className={styles.mtLabelBlock}>
            <span className={styles.mtLabel}>{r.label}</span>
            <span className={styles.mtTag}>{tagFor(r.read)}</span>
          </span>
          <span className={styles.mtInstrument} aria-hidden>
            {r.read.kind === 'index' && (
              <CIBeam mini lo={r.read.ciLo} hi={r.read.ciHi} point={r.read.changePct}
                dir={r.read.changePct >= 0 ? 'up' : 'down'} play={play} />
            )}
            {r.read.kind === 'demand' && r.read.series.length >= 2 && <DemandLine mini series={r.read.series} dir={r.read.now >= 0 ? 'up' : 'down'} />}
            {r.read.kind === 'descriptive' && (r.read.series.length >= 2
              ? <DemandLine mini series={r.read.series} dir={seriesDir(r.read.series)} />
              : <span className={styles.mtAbstain}>—</span>)}
          </span>
          <span className={styles.mtRight}>
            {r.read.kind === 'index' && (
              <>
                <span className={`${styles.mtFigure} ${styles.pctData}`} data-dir={r.read.changePct >= 0 ? 'up' : 'down'}>
                  <span className={styles.tri} data-dir={r.read.changePct >= 0 ? 'up' : 'down'} aria-hidden />
                  {fmtPct(r.read.changePct)} · {r.read.horizon}
                </span>
                <span className={styles.mtSub}>
                  CI {fmtCI(r.read.ciLo)} to {fmtCI(r.read.ciHi)} · {r.read.method === 'repeat-sale' ? `${fmtInt(r.read.n)} pairs` : `${fmtInt(r.lots)} lots`}
                </span>
              </>
            )}
            {r.read.kind === 'demand' && (
              <>
                <span className={`${styles.mtFigure} ${styles.pctData}`} data-dir={r.read.now >= 0 ? 'up' : 'down'}>
                  <span className={styles.tri} data-dir={r.read.now >= 0 ? 'up' : 'down'} aria-hidden />
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

/** THE SUB TAPE — the scoped stage. Pick a market and the board becomes its
    sub-markets in the 02 grammar: watch families, card eras, art kinds — each
    with the strongest honest read its data supports. Same rank as the 02
    resolver (certified by |move|, then demand by strength, then descriptive
    by size); rows link to the dossier the 02 rows link to. The full board
    lives in "The markets" below — this is the front row, not a replacement. */
const SUB_CAP = 6;
/* Art and Design lead with their MAKERS (Picasso, Warhol / Eames, Nakashima) —
   the names ARE those markets. The structural drills (kinds, families, eras)
   stay for watches, sports, science, culture, where the sub-market is the
   recognizable unit. Collin's call, Aug 6. */
const MAKER_LED: ReadonlySet<string> = new Set(['art', 'design']);

function subHref(r: SubMarketRead): string {
  return r.slug.includes(':') ? `/sub/${r.slug.replace(':', '/')}` : `/makers/${r.slug}`;
}

const subTag = (r: SubMarketRead): string =>
  r.readType === 'index' ? (r.indexMethod === 'repeat-sale' ? 'Repeat-sale index' : 'Hedonic index')
  : r.readType === 'demand' ? 'Demand read' : 'Descriptive';

export function SubTape({ market, activeKey, play }: {
  market: MarketData | null;
  activeKey: Market;
  play: boolean;
}) {
  const rows = useMemo(() => {
    const makerLed = MAKER_LED.has(activeKey);
    const pool: SubMarketRead[] = makerLed
      ? (market?.subMarkets?.[activeKey] ?? [])
      : (market?.drills?.[activeKey] ?? []);
    const cap = makerLed ? 5 : SUB_CAP;
    // the ladder at drill altitude: repeat-sale > hedonic > demand >
    // descriptive. Certified rows rank by the size of the certified move;
    // everything else ranks by DEPTH, not heat — sorting demand reads by
    // demandNow front-ran thin hot families (Panthère, Cellini) over Daytona
    // and Nautilus, and a front row should read like the market.
    const rank = (r: SubMarketRead) =>
      r.readType === 'index' ? (r.indexMethod === 'repeat-sale' ? 0 : 1)
      : r.readType === 'demand' ? 2 : 3;
    const strength = (r: SubMarketRead) =>
      r.readType === 'index' ? Math.abs(r.index?.changePct ?? 0) : (r.lots ?? 0);
    return [...pool]
      .sort((a, b) => rank(a) - rank(b) || strength(b) - strength(a))
      .slice(0, cap);
  }, [market, activeKey]);
  if (!rows.length) return null;
  return (
    <div className={styles.mtTape} role="list" data-play={play ? 'true' : undefined}>
      {rows.map((r) => {
        const idx = r.readType === 'index' ? r.index : null;
        return (
          <Link key={r.slug} href={subHref(r)} role="listitem" className={styles.mtRow}>
            <span className={styles.mtLabelBlock}>
              <span className={styles.mtLabel}>{r.label}</span>
              <span className={styles.mtTag}>{subTag(r)}</span>
            </span>
            <span className={styles.mtInstrument} aria-hidden>
              {idx && idx.changePct != null && (
                <CIBeam mini lo={idx.ciLoPct ?? idx.changePct} hi={idx.ciHiPct ?? idx.changePct}
                  point={idx.changePct} dir={idx.changePct >= 0 ? 'up' : 'down'} play={play} />
              )}
              {!idx && r.readType === 'demand' && (r.demandSeries?.length ?? 0) >= 2 && (
                <DemandLine mini series={r.demandSeries as { period: string; value: number }[]} dir={(r.demandNow ?? 0) >= 0 ? 'up' : 'down'} />
              )}
              {!idx && r.readType !== 'demand' && <span className={styles.mtAbstain}>—</span>}
            </span>
            <span className={styles.mtRight}>
              {idx && idx.changePct != null && (
                <>
                  <span className={`${styles.mtFigure} ${styles.pctData}`} data-dir={idx.changePct >= 0 ? 'up' : 'down'}>
                    <span className={styles.tri} data-dir={idx.changePct >= 0 ? 'up' : 'down'} aria-hidden />
                    {fmtPct(idx.changePct)}{idx.horizon ? ` · ${idx.horizon}` : ''}
                  </span>
                  <span className={styles.mtSub}>
                    CI {fmtCI(idx.ciLoPct ?? idx.changePct)} to {fmtCI(idx.ciHiPct ?? idx.changePct)}{r.lots ? ` · ${fmtInt(r.lots)} lots` : ''}
                  </span>
                </>
              )}
              {!idx && r.readType === 'demand' && (
                <>
                  <span className={`${styles.mtFigure} ${styles.pctData}`} data-dir={(r.demandNow ?? 0) >= 0 ? 'up' : 'down'}>
                    <span className={styles.tri} data-dir={(r.demandNow ?? 0) >= 0 ? 'up' : 'down'} aria-hidden />
                    {fmtPct(r.demandNow ?? 0)}
                  </span>
                  <span className={styles.mtSub}>over estimate{r.lots ? ` · ${fmtInt(r.lots)} lots` : ''}</span>
                </>
              )}
              {!idx && r.readType !== 'demand' && (
                <>
                  <span className={styles.mtFigure}>{r.typicalUsd ? `Typical ${fmtMoneyCompact(r.typicalUsd)}` : '—'}</span>
                  <span className={styles.mtSub}>{r.record?.usd ? `record ${fmtMoneyCompact(r.record.usd)} · ` : ''}{fmtInt(r.lots ?? 0)} lots</span>
                </>
              )}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
