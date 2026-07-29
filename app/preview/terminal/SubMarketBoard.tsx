'use client';

import { useMemo, useState } from 'react';
import { LazyMotion, domAnimation, m } from 'framer-motion';
import type { MarketData, SubMarketRead } from '../../hooks/useRayData';
import { type Market } from '../../constants';
import { fmtInt, fmtMoneyCompact, useInView, useReducedMotion } from './hooks';
import { fmtPct } from './verified';
import RollingNumber from './RollingNumber';
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

/* ── THE CERTIFIED READ CARD ─────────────────────────────────
   The paper room's grammar: every sub-market is a curated card,
   not a table row, composed as a bento — the strongest read is
   the FLAGSHIP, an inverted ink card (the dark market speaking
   inside the paper room). Each card draws its own data live on
   scroll: an index read sweeps in its 95% confidence band, a
   demand read traces its real quarterly series, a descriptive
   read prints its record. The % speaks mono; everything else
   is ink on cream (or cream on ink). */

const bandT = { duration: 0.9, ease: EASE, delay: 0.25 };

/** The drawn 95% CI band: a zero-anchored scale with the confidence
    interval as a filled band and the point estimate as a marker.
    The band sweeps in and the dot lands when the card scrolls into view. */
function CIBand({ lo, hi, point, dir, play }: { lo: number; hi: number; point: number; dir?: 'up' | 'down'; play: boolean }) {
  const min = Math.min(0, lo);
  const max = Math.max(0, hi);
  const span = max - min || 1;
  const pad = span * 0.08;
  const x = (v: number) => ((v - min + pad) / (span + pad * 2)) * 100;
  return (
    <div className={styles.ciBand} data-dir={dir} aria-label={`95% confidence band ${lo.toFixed(0)} to ${hi.toFixed(0)}`}>
      <div className={styles.ciTrack} aria-hidden>
        <span className={styles.ciAxisLine} />
        <span className={styles.ciZeroTick} style={{ left: `${x(0)}%` }} />
        <m.span
          className={styles.ciFillBar}
          style={{ left: `${x(lo)}%`, width: `${Math.max(0.5, x(hi) - x(lo))}%`, transformOrigin: 'left center' }}
          initial={{ scaleX: 0 }}
          animate={play ? { scaleX: 1 } : { scaleX: 0 }}
          transition={bandT}
        />
        <m.span
          className={styles.ciPointDot}
          style={{ left: `${x(point)}%` }}
          initial={{ scale: 0, opacity: 0 }}
          animate={play ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
          transition={{ duration: 0.4, ease: EASE, delay: 1.0 }}
        />
      </div>
      <div className={styles.ciEnds}>
        <span className={styles.pctData}>{lo.toFixed(0)}</span>
        <span className={styles.ciTag}>95% band</span>
        <span className={styles.pctData}>{hi.toFixed(0)}</span>
      </div>
    </div>
  );
}

/** The drawn demand series: the real quarterly %-over-estimate line,
    tracing itself in on scroll. */
function DemandSpark({ series, dir, play }: { series: { period: string; value: number }[]; dir?: 'up' | 'down'; play: boolean }) {
  const vals = series.map((s) => s.value);
  if (vals.length < 2) return null;
  const min = Math.min(...vals, 0);
  const max = Math.max(...vals, 0);
  const span = max - min || 1;
  const px = (i: number) => (i / (vals.length - 1)) * 100;
  const py = (v: number) => 11 - ((v - min) / span) * 10;
  const d = vals.map((v, i) => `${i === 0 ? 'M' : 'L'} ${px(i)} ${py(v)}`).join(' ');
  return (
    <div className={styles.ciBand} data-dir={dir} aria-label="Demand by quarter">
      <svg viewBox="0 0 100 12" preserveAspectRatio="none" className={styles.ciSvg} aria-hidden>
        {min < 0 && <line x1="0" y1={py(0)} x2="100" y2={py(0)} className={styles.ciAxis} vectorEffect="non-scaling-stroke" />}
        <m.path
          d={d}
          className={styles.sparkLine}
          vectorEffect="non-scaling-stroke"
          fill="none"
          initial={{ pathLength: 0 }}
          animate={play ? { pathLength: 1 } : { pathLength: 0 }}
          transition={{ duration: 1.4, ease: EASE, delay: 0.25 }}
        />
        <m.circle
          cx="100" cy={py(vals[vals.length - 1])} r="2.2" className={styles.ciDot}
          initial={{ opacity: 0 }}
          animate={play ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: 0.3, delay: 1.55 }}
        />
      </svg>
      <div className={styles.ciEnds}>
        <span className={styles.ciTag}>{series[0].period}</span>
        <span className={styles.ciTag}>sold over estimate · by quarter</span>
        <span className={styles.ciTag}>{series[series.length - 1].period}</span>
      </div>
    </div>
  );
}

/** One certified read card. size: 'flag' (the inverted ink flagship,
    2×2 in the bento), 'wide' (2×1), or 'std'. */
function ReadCard({ r, active, onSelect, size = 'std', play }: {
  r: SubMarketRead; active: boolean; onSelect: (k: Market) => void;
  size?: 'flag' | 'wide' | 'std'; play: boolean;
}) {
  const dir = dirFor(r);
  const line = readLine(r);
  const foot: string[] = [`${fmtInt(r.lots)} lots`];
  if (r.readType !== 'descriptive' && r.typicalUsd != null) foot.push(`typical ${fmtMoneyCompact(r.typicalUsd)}`);
  if (r.bidCompNow != null) foot.push(`${r.bidCompNow} bids/lot`);
  if (r.readType === 'descriptive' && r.sellThroughPct != null) foot.push(`${Math.round(r.sellThroughPct)}% sell-through`);
  // the flagship states its method in plain words — the wow is the certainty
  const methodLine = size === 'flag' && r.readType === 'index'
    ? (r.indexMethod === 'repeat-sale'
        ? 'Repeat-sales index — the same card, the same grade, resold. Mix-immune, 95% confidence.'
        : 'Quality-controlled price index across this maker’s verified sales. 95% confidence.')
    : null;
  return (
    <button
      type="button"
      className={styles.readCard}
      data-size={size}
      data-active={active || undefined}
      onClick={() => onSelect(r.vertical as Market)}
      aria-label={`${r.label}: ${line.primary} ${line.per}, ${supportLine(r)} — switch the board to ${r.vertical}`}
      aria-current={active ? 'true' : undefined}
    >
      <div className={styles.readCardHead}>
        <span className={styles.readCardName}>{r.label}</span>
        <span className={styles.readSeal} data-type={r.readType} title={methodTitle(r)}>{tagFor(r)}</span>
      </div>
      <div className={styles.readCardRead} data-dir={dir}>
        {r.readType === 'index' && r.index ? (
          <>
            {size === 'flag' ? (
              <RollingNumber
                className={`${styles.readCardPct} ${styles.pctData}`}
                value={r.index.changePct}
                from={0}
                format={fmtPct}
                duration={1400}
                delay={150}
                play={play}
              />
            ) : (
              <span className={`${styles.readCardPct} ${styles.pctData}`}>{fmtPct(r.index.changePct)}</span>
            )}
            <span className={styles.readCardPer}>{r.index.horizon}</span>
          </>
        ) : r.readType === 'demand' && r.demandNow != null ? (
          <>
            <span className={`${styles.readCardPct} ${styles.pctData}`}>{fmtPct(r.demandNow)}</span>
            <span className={styles.readCardPer}>demand · over est.</span>
          </>
        ) : (
          <>
            <span className={styles.readCardMoney}>{r.typicalUsd != null ? fmtMoneyCompact(r.typicalUsd) : '—'}</span>
            <span className={styles.readCardPer}>typical price</span>
          </>
        )}
      </div>
      {methodLine && <div className={styles.readCardMethod}>{methodLine}</div>}
      {r.readType === 'index' && r.index ? (
        <CIBand lo={r.index.ciLoPct} hi={r.index.ciHiPct} point={r.index.changePct} dir={dir} play={play} />
      ) : r.readType === 'demand' && r.demandSeries.length >= 2 ? (
        <DemandSpark series={r.demandSeries} dir={dir} play={play} />
      ) : r.record ? (
        <div className={styles.readCardRecord}>
          <span className={styles.readCardRecordLabel}>record</span>
          <span className={styles.readCardRecordVal}>{fmtMoneyCompact(r.record.usd)}</span>
          <span className={styles.readCardRecordTitle}>{r.record.title}</span>
        </div>
      ) : null}
      <div className={styles.readCardFoot}>{foot.join(' · ')}</div>
    </button>
  );
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

  const head = paper ? (
    <div className={styles.cardRoomHead}>
      <img src="/brand/lectr.png" alt="" className={styles.inkMark} aria-hidden />
      <h2 className={styles.roomTitle}>The verified <em>board</em></h2>
      <p className={styles.roomSub}>
        {activeKey === 'all'
          ? 'Every read the engine will stand behind — drawn from its own data, card by card.'
          : 'This market’s certified reads — each drawn from its own data, card by card.'}
      </p>
    </div>
  ) : (
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

  // ── THE PAPER ROOM: the certified bento (both viewports; CSS reflows the
  // mosaic — 4-col with a 2×2 ink flagship on desktop, stacked on mobile).
  // The strongest read anchors the composition as the inverted flagship;
  // every card draws its data in as the room scrolls into view.
  if (paper) {
    const CARD_CAP = 8; // flagship (2×2) + wide (2×1) + six singles = a full mosaic
    const shownCards = expanded ? rows : rows.slice(0, CARD_CAP);
    const sizeAt = (i: number): 'flag' | 'wide' | 'std' => (i === 0 ? 'flag' : i === 1 ? 'wide' : 'std');
    const cardV = {
      hidden: reduce ? { opacity: 1 } : { opacity: 0, y: 14 },
      show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: EASE } },
    };
    return (
      <LazyMotion features={domAnimation} strict>
        <div className={styles.moversPaper} ref={ref}>
          {head}
          <m.div
            className={styles.bento}
            variants={{ hidden: {}, show: { transition: { staggerChildren: reduce ? 0 : 0.07 } } }}
            initial="hidden"
            animate={seen ? 'show' : 'hidden'}
          >
            {shownCards.map((r, i) => (
              <m.div key={`${r.vertical}:${r.slug}`} className={styles.bentoCell} data-size={sizeAt(i)} variants={cardV}>
                <ReadCard r={r} active={r.vertical === activeKey} onSelect={onSelect} size={sizeAt(i)} play={seen && !reduce} />
              </m.div>
            ))}
          </m.div>
          {rows.length > CARD_CAP && (
            <button type="button" className={styles.subShowMore} onClick={() => setExpanded((v) => !v)}>
              {expanded ? 'Show less' : `Show ${rows.length - CARD_CAP} more`}
            </button>
          )}
        </div>
      </LazyMotion>
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
