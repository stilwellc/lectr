'use client';

import { useMemo, useState } from 'react';
import { LazyMotion, domAnimation, m } from 'framer-motion';
import type { MarketData, SubMarketRead } from '../../hooks/useRayData';
import { type Market } from '../../constants';
import { fmtInt, fmtMoneyCompact, useInView, useReducedMotion } from './hooks';
import { fmtPct } from './verified';
import styles from './style.module.css';

/* ============================================================
   THE SUB-MARKET BOARD — the market as a hierarchy: vertical →
   sub-markets. Each tracked sub-market shows the STRONGEST HONEST
   read its data supports, in one of three grammars so nothing
   masquerades as a return:

     · index       a verified, CI'd hedonic move
                   `label · +25.1% 5Y · [12, 39]`  (95% CI tag)
     · demand      a measured %-over-estimate
                   `label · demand +X%`  + typical / record
     · descriptive `label · typical $X · record $Y · N lots`
                   — NEVER a % appreciation.

   Scoping (activeKey):
     · 'all'    — cross-market leaders: the CI'd index sub-markets
                  first (today's verified movers), then the
                  strongest demand sub-markets across verticals.
     · vertical — that vertical's sub-markets, ordered index →
                  demand → descriptive. This is the key win: on
                  Science it shows meteorites/fossils/etc. with
                  demand + records instead of an empty bar.

   A row click re-scopes the page to that read's vertical.
   Desktop = table; mobile = card list — the movers grammar.
   ============================================================ */

const EASE = [0.23, 1, 0.32, 1] as const;

interface Props {
  market: MarketData | null;
  activeKey: Market;
  onSelect: (key: Market) => void;
  /** mobile = card list; desktop = table */
  variant?: 'desktop' | 'mobile';
  /** the condensed desktop board — rides beside Today's Call, no show-more/foot.
      It's the only board on desktop; CI'd reads lead, demand fills the rest. */
  condensed?: boolean;
  /** how many rows the condensed board renders — sized by the caller to fill
      the call plate's height (rows flex to eat the remaining slack). */
  maxRows?: number;
  /** printed on the paper room (home) — ink palette swaps, layout unchanged */
  paper?: boolean;
}

// how strong a demand read is — used to rank the cross-market roll-up
const demandStrength = (r: SubMarketRead) => r.demandNow ?? -Infinity;

/**
 * Resolve the ordered rows for the active scope.
 * - 'all': every vertical's 'index' sub-markets (ranked by |move|), then the
 *   strongest 'demand' sub-markets across verticals — a roll-up of what's
 *   moving everywhere. Descriptive buckets stay off the cross-market board.
 * - a vertical: that vertical's sub-markets, ordered index → demand →
 *   descriptive (each group internally by its own strength).
 */
function resolveRows(market: MarketData | null, activeKey: Market): SubMarketRead[] {
  const sm = market?.subMarkets;
  if (!sm) return [];

  if (activeKey === 'all') {
    const all: SubMarketRead[] = Object.values(sm).flat();
    const index = all
      .filter((r) => r.readType === 'index' && r.index)
      .sort((a, b) => Math.abs(b.index!.changePct) - Math.abs(a.index!.changePct));
    const demand = all
      .filter((r) => r.readType === 'demand')
      .sort((a, b) => demandStrength(b) - demandStrength(a));
    return [...index, ...demand];
  }

  const rows = sm[activeKey] || [];
  const rank = { index: 0, demand: 1, descriptive: 2 } as const;
  return [...rows].sort((a, b) => {
    if (rank[a.readType] !== rank[b.readType]) return rank[a.readType] - rank[b.readType];
    // within a group: index by |move|, demand by demandNow, descriptive by lots
    if (a.readType === 'index' && a.index && b.index) return Math.abs(b.index.changePct) - Math.abs(a.index.changePct);
    if (a.readType === 'demand') return demandStrength(b) - demandStrength(a);
    return b.lots - a.lots;
  });
}

/** Whether the active scope resolves any board rows — lets the home terminal
    decide if the condensed board earns the call plate's second column. */
export function hasSubMarketRows(market: MarketData | null, activeKey: Market): boolean {
  return resolveRows(market, activeKey).length > 0;
}

// the small readType tag per row
function tagFor(r: SubMarketRead): string {
  if (r.readType === 'index') return '95% CI';
  if (r.readType === 'demand') return 'demand';
  return 'typical';
}

// hover-title naming the method behind an index read — both are 95% CI'd, but a
// hedonic maker move and a mix-immune repeat-sales index are different animals.
function methodTitle(r: SubMarketRead): string | undefined {
  if (r.readType !== 'index') return undefined;
  return r.indexMethod === 'repeat-sale'
    ? 'Repeat-sales index — same card, same grade, resold 2+ times (mix-immune Bailey-Muth-Nourse, 95% CI)'
    : 'Hedonic index — quality-controlled per-maker price regression (95% CI)';
}

// the direction for tinting — index by CI'd move, demand by sign, descriptive neutral
function dirFor(r: SubMarketRead): 'up' | 'down' | undefined {
  if (r.readType === 'index' && r.index) return r.index.changePct >= 0 ? 'up' : 'down';
  if (r.readType === 'demand' && r.demandNow != null) return r.demandNow >= 0 ? 'up' : 'down';
  return undefined;
}

// the headline cell — the strongest honest read (never a fake %)
function readLine(r: SubMarketRead): { primary: string; per: string } {
  if (r.readType === 'index' && r.index) {
    return { primary: fmtPct(r.index.changePct), per: r.index.horizon };
  }
  if (r.readType === 'demand' && r.demandNow != null) {
    return { primary: `demand ${fmtPct(r.demandNow)}`, per: 'over est.' };
  }
  // descriptive — the typical price is the headline; no appreciation
  return { primary: r.typicalUsd != null ? `typical ${fmtMoneyCompact(r.typicalUsd)}` : '—', per: '' };
}

// the secondary cell — the CI for an index, else typical/record support. On the
// cards row the CI is joined by the bid-competition demand read (median bids/lot
// from Goldin's bidCount) — a demand primitive alongside the CI'd price index,
// never masquerading as the index itself.
function supportLine(r: SubMarketRead): string {
  if (r.readType === 'index' && r.index) {
    const ci = `[${r.index.ciLoPct.toFixed(0)}, ${r.index.ciHiPct.toFixed(0)}]`;
    return r.bidCompNow != null ? `${ci} · ${r.bidCompNow} bids/lot` : ci;
  }
  if (r.readType === 'demand') {
    if (r.typicalUsd != null) return `typical ${fmtMoneyCompact(r.typicalUsd)}`;
    if (r.record) return `record ${fmtMoneyCompact(r.record.usd)}`;
    return '—';
  }
  // descriptive — the record is the support
  return r.record ? `record ${fmtMoneyCompact(r.record.usd)}` : '—';
}

// One board row's five cells — shared by the animated table and the condensed board.
function RowCells({ r }: { r: SubMarketRead }) {
  const dir = dirFor(r);
  const line = readLine(r);
  return (
    <>
      <span className={styles.moversName}>
        <span className={styles.moversTick} data-dir={dir} aria-hidden />
        {r.label}
      </span>
      <span className={styles.subTag} data-type={r.readType} title={methodTitle(r)}>{tagFor(r)}</span>
      <span className={styles.moversDelta} data-dir={dir}>
        {line.primary} {line.per && <em>{line.per}</em>}
      </span>
      <span className={styles.subSupport}>{supportLine(r)}</span>
      <span className={styles.moversN}>{fmtInt(r.lots)}</span>
    </>
  );
}

export default function SubMarketBoard({ market, activeKey, onSelect, variant = 'desktop', condensed = false, maxRows, paper = false }: Props) {
  const reduce = useReducedMotion();
  const [ref, seen] = useInView<HTMLDivElement>();
  const rows = useMemo(() => resolveRows(market, activeKey), [market, activeKey]);

  // cap the visible rows; the rest reveal behind a "show more"
  const CAP = 5;
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? rows : rows.slice(0, CAP);
  const hasMore = rows.length > CAP;
  const moreBtn = hasMore ? (
    <button type="button" className={styles.subShowMore} onClick={() => setExpanded((v) => !v)}>
      {expanded ? 'Show less' : `Show ${rows.length - CAP} more`}
    </button>
  ) : null;

  // The condensed board — rides beside Today's Call and IS the desktop board.
  // CI'd reads lead (resolveRows), demand fills the rest; the caller sizes
  // maxRows to the call plate's height and the rows flex to fill it exactly.
  if (condensed) {
    if (!rows.length) return null;
    const shownCond = rows.slice(0, Math.max(1, maxRows ?? CAP));
    return (
      <div className={`${styles.movers} ${styles.condensed}`}>
        <div className={styles.condHead}>
          <span className={styles.sectionKicker}>Sub-markets · live board</span>
          <span className={styles.condCount}>{rows.length} tracked</span>
        </div>
        <div className={styles.subTable} role="table">
          <div className={styles.subColHead} role="row">
            <span role="columnheader">Sub-market</span>
            <span role="columnheader">Read</span>
            <span role="columnheader" className={styles.right}>Move / typical</span>
            <span role="columnheader" className={styles.right}>Support</span>
            <span role="columnheader" className={styles.right}>Lots</span>
          </div>
          {shownCond.map((r) => {
            const line = readLine(r);
            return (
              <button
                key={`${r.vertical}:${r.slug}`}
                type="button"
                className={styles.subRow}
                data-active={r.vertical === activeKey}
                onClick={() => onSelect(r.vertical as Market)}
                aria-label={`${r.label}: ${line.primary} ${line.per}, ${supportLine(r)} — switch the board to ${r.vertical}`}
                aria-current={r.vertical === activeKey ? 'true' : undefined}
              >
                <RowCells r={r} />
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  const head = (
    <div className={styles.moversHead}>
      <div>
        <h2 className={styles.roomTitle}>The verified <em>board</em></h2>
        <p className={styles.roomSub}>
          {activeKey === 'all'
            ? 'Every read the engine will stand behind — price indices at 95% confidence, measured demand where estimates exist, and the plain record everywhere else.'
            : 'This market’s certified reads — indices at 95% confidence, measured demand, and the plain record.'}
        </p>
      </div>
    </div>
  );

  const foot = (
    <p className={styles.moversFoot}>
      Each sub-market shows the strongest read its data supports — a 95%-CI index (a hedonic maker move where
      estimates exist, a mix-immune repeat-sales index where they don&apos;t, as with cards), else measured demand
      over estimate, else the descriptive record (typical · record · volume). No sub-market prints an
      appreciation the engine won&apos;t defend.
    </p>
  );

  if (!rows.length) {
    return (
      <div className={`${styles.movers}${paper ? ` ${styles.moversPaper}` : ''}`} ref={ref}>
        {head}
        <div className={styles.moversEmpty}>
          No tracked sub-markets in {activeKey === 'all' ? 'the market' : `${activeKey}`} yet — as coverage deepens,
          each vertical&apos;s sub-markets surface here with the strongest read they can honestly support.
        </div>
        {foot}
      </div>
    );
  }

  if (variant === 'mobile') {
    return (
      <div ref={ref} className={paper ? styles.moversPaper : undefined}>
        {head}
        <div className={styles.mobSubList}>
          {shown.map((r) => {
            const dir = dirFor(r);
            const line = readLine(r);
            return (
              <button
                key={`${r.vertical}:${r.slug}`}
                type="button"
                className={styles.mobSubCard}
                data-active={r.vertical === activeKey}
                onClick={() => onSelect(r.vertical as Market)}
                aria-label={`${r.label}: ${line.primary} ${line.per} — switch to ${r.vertical}`}
              >
                <div className={styles.mobSubTop}>
                  <span className={styles.mobSubName}>
                    <span className={styles.moversTick} data-dir={dir} aria-hidden />
                    {r.label}
                  </span>
                  <span className={styles.subTag} data-type={r.readType} title={methodTitle(r)}>{tagFor(r)}</span>
                </div>
                <div className={styles.mobSubBot}>
                  <span className={styles.moversDelta} data-dir={dir}>
                    {line.primary} {line.per && <em>{line.per}</em>}
                  </span>
                  <span className={styles.subSupport}>{supportLine(r)}</span>
                </div>
                <div className={styles.subMeta}>{fmtInt(r.lots)} lots{r.record ? ` · record ${fmtMoneyCompact(r.record.usd)}` : ''}</div>
              </button>
            );
          })}
        </div>
        {moreBtn}
        {foot}
      </div>
    );
  }

  const container = { hidden: {}, show: { transition: { staggerChildren: reduce ? 0 : 0.05 } } };
  const rowV = {
    hidden: reduce ? { opacity: 1 } : { opacity: 0, y: 8 },
    show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE } },
  };

  return (
    <LazyMotion features={domAnimation} strict>
      <div className={`${styles.movers}${paper ? ` ${styles.moversPaper}` : ''}`} ref={ref}>
        {head}
        <div className={styles.subTable} role="table">
          <div className={styles.subColHead} role="row">
            <span role="columnheader">Sub-market</span>
            <span role="columnheader">Read</span>
            <span role="columnheader" className={styles.right}>Move / typical</span>
            <span role="columnheader" className={styles.right}>Support</span>
            <span role="columnheader" className={styles.right}>Lots</span>
          </div>
          <m.div variants={container} initial="hidden" animate={seen ? 'show' : 'hidden'}>
            {shown.map((r) => {
              const line = readLine(r);
              return (
                <m.button
                  key={`${r.vertical}:${r.slug}`}
                  type="button"
                  className={styles.subRow}
                  data-active={r.vertical === activeKey}
                  variants={rowV}
                  onClick={() => onSelect(r.vertical as Market)}
                  aria-label={`${r.label}: ${line.primary} ${line.per}, ${supportLine(r)} — switch the board to ${r.vertical}`}
                  aria-current={r.vertical === activeKey ? 'true' : undefined}
                >
                  <RowCells r={r} />
                </m.button>
              );
            })}
          </m.div>
        </div>
        {moreBtn}
        {foot}
      </div>
    </LazyMotion>
  );
}
