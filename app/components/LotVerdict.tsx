'use client';

import type { AuctionLot } from '../types';
import { type Verdict, ENGINE_WEIGHTED_K, fmtUsd, estLabel } from '../lib/verdict';

/** LotVerdict — the lot's "why" panel + comp strip (the frame and its
    numbers live in lib/verdict.ts, server-safe). */
function Row({ k, v, sub }: { k: string; v: string; sub?: React.ReactNode }) {
  return (
    <div className="ns-ledger-row lectr-vd-row">
      <span className="lectr-vd-k">{k}</span>
      <span className="lectr-vd-v">
        {sub && <span className="lectr-vd-sub">{sub}</span>}
        <span className="lectr-vd-num">{v}</span>
      </span>
    </div>
  );
}

/** The forecast cell + the four rows that explain it. */
export function VerdictPanel({ lot, verdict: v, house, weightedOn }: {
  lot: AuctionLot;
  verdict: Verdict;
  house: string;
  /** how many comps the median is weighted on (rows on the page), if known */
  weightedOn?: number | null;
}) {
  const hasEst = v.estMid != null;
  const dir = v.flagged ? 'up' : 'ink';
  const k = weightedOn && weightedOn > 0 ? Math.min(weightedOn, v.compN) : Math.min(ENGINE_WEIGHTED_K, v.compN);
  const sign = (p: number) => (p > 0 ? `+${p}%` : p < 0 ? `−${Math.abs(p)}%` : 'level');
  return (
    <div className="lectr-vd">
      <div className="ns-cell ns-cell-color lectr-vd-cell" data-dir={dir}>
        <span className="ns-cell-label">Expected hammer</span>
        <span className="lectr-vd-stat">
          {fmtUsd(v.expected)}
          {hasEst
            ? <span className="lectr-vd-vs">vs {estLabel(v)} estimate · {v.vsEstPct === 0 ? 'level with it' : `${sign(v.vsEstPct!)} ${v.vsEstPct! > 0 ? 'over' : 'under'}`}</span>
            : v.bid != null ? <span className="lectr-vd-vs">vs {fmtUsd(v.bid)} bid now</span> : null}
        </span>
        <span className="ns-cell-body">
          Likely {fmtUsd(v.bandLo)}–{fmtUsd(v.bandHi)} · {v.confidence} confidence
          {v.beatRatePct != null ? <> · {v.beatRatePct}% of lots called like this beat their estimate</> : null}
        </span>
      </div>
      <div className="lectr-vd-rows">
        {hasEst && <Row k="House estimate" v={estLabel(v)} sub="hammer, before premium" />}
        {v.compMedianAllIn != null && v.compN > 0 && (
          <Row
            k="Comps median"
            v={fmtUsd(v.compMedianAllIn)}
            sub={v.compN > k
              ? `all-in · weighted on the ${k} closest of ${v.compN} sales`
              : `all-in · ${v.compN} ${v.compN === 1 ? 'sale' : 'sales'}, weighted by similarity and recency`}
          />
        )}
        {v.floorAllIn != null && (
          <Row k="Value floor" v={fmtUsd(v.floorAllIn)} sub="all-in · the low edge of the likely range" />
        )}
        {v.maxBid != null && (
          <Row
            k="Max bid"
            v={`≤ ${fmtUsd(v.maxBid)} hammer`}
            sub={`lands on the floor after ${house}'s ~${v.premiumPct}% premium`}
          />
        )}
      </div>
      <p className="lectr-vd-note">
        {hasEst
          ? <>The forecast starts from {house}&rsquo;s estimate and moves it by what the comps realized. </>
          : <>No house estimate here — the forecast is the comps alone, premium stripped. </>}
        {v.maxBid != null
          ? <>Winning will likely take about {fmtUsd(v.expected)}; at {fmtUsd(v.maxBid)} or less you pay no more than the floor even if it lands low.</>
          : <>At {lot.value?.confidence === 'low' ? 'low' : 'this'} confidence lectr prints no floor, so no max bid.</>}
      </p>
    </div>
  );
}

/** The comp distribution on one log axis: every comp price lectr can show
    (all-in), the comps median, the expected all-in, and the estimate band
    grossed up by the premium — so the reader sees where the forecast sits
    in the evidence. Needs ≥ 2 prices. */
export function CompStrip({ prices, median, expectedAllIn, estAllInLo, estAllInHi, flagged }: {
  prices: number[];
  median: number | null;
  expectedAllIn: number | null;
  estAllInLo: number | null;
  estAllInHi: number | null;
  flagged: boolean;
}) {
  const ps = prices.filter(p => p > 0);
  if (ps.length < 2) return null;
  const all = [...ps, median, expectedAllIn, estAllInLo, estAllInHi].filter((x): x is number => x != null && x > 0);
  const lo = Math.min(...all) / 1.12, hi = Math.max(...all) * 1.12;
  const L = Math.log(lo), R = Math.log(hi);
  const x = (p: number) => `${((Math.log(p) - L) / (R - L)) * 100}%`;
  // stack coincident dots so ties stay countable
  const seen = new Map<number, number>();
  const dots = ps.slice().sort((a, b) => a - b).map(p => {
    const bucket = Math.round(((Math.log(p) - L) / (R - L)) * 90);
    const lvl = seen.get(bucket) || 0;
    seen.set(bucket, lvl + 1);
    return { p, lvl };
  });
  const mid = Math.exp((L + R) / 2);
  return (
    <figure className="lectr-strip" style={{ margin: '16px 4px 4px' }}
      aria-label={`Comparable prices from ${fmtUsd(Math.min(...ps))} to ${fmtUsd(Math.max(...ps))}${median ? `, median ${fmtUsd(median)}` : ''}${expectedAllIn ? `, expected ${fmtUsd(expectedAllIn)} all-in` : ''}`}>
      <div className="lectr-strip-track" aria-hidden>
        {estAllInLo != null && estAllInHi != null && (
          <span className="lectr-strip-est" style={{ left: x(estAllInLo), width: `calc(${x(estAllInHi)} - ${x(estAllInLo)} + 2px)` }} />
        )}
        {dots.map((d, i) => (
          <span key={i} className="lectr-strip-dot" title={fmtUsd(d.p)} style={{ left: x(d.p), bottom: 4 + d.lvl * 10 }} />
        ))}
        {median != null && <span className="lectr-strip-line" style={{ left: x(median) }} />}
        {expectedAllIn != null && <span className={`lectr-strip-line exp${flagged ? ' up' : ''}`} style={{ left: x(expectedAllIn) }} />}
      </div>
      <div className="lectr-strip-axis" aria-hidden>
        <span style={{ left: 0 }}>{fmtUsd(lo)}</span>
        <span style={{ left: '50%' }}>{fmtUsd(mid)}</span>
        <span style={{ left: '100%' }}>{fmtUsd(hi)}</span>
      </div>
      <figcaption className="lectr-strip-key">
        <span><i className="k-dot" />{ps.length} comp {ps.length === 1 ? 'price' : 'prices'}, all-in</span>
        {median != null && <span><i className="k-med" />comps median {fmtUsd(median)}</span>}
        {expectedAllIn != null && <span><i className={`k-exp${flagged ? ' up' : ''}`} />expected {fmtUsd(expectedAllIn)} all-in</span>}
        {estAllInLo != null && estAllInHi != null && (
          <span><i className="k-est" />estimate + premium {estAllInLo === estAllInHi ? fmtUsd(estAllInLo) : `${fmtUsd(estAllInLo)}–${fmtUsd(estAllInHi)}`}</span>
        )}
      </figcaption>
    </figure>
  );
}
