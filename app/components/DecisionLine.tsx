'use client';
/**
 * DecisionLine (N2, Oct 11 2026) — one compact line under a pick's reason:
 *
 *   projected close ~$34K · worth up to $38K · $4K headroom · closes Thu 10 PM
 *
 * Every part is lot-face.decisionOf (the ranker's projection or the house
 * estimate, lotFace's max bid, the gap between those two, the house-tz
 * close) — this component formats nothing of its own. A part that does not
 * exist is left out; an engine that abstained says "no engine read" or
 * nothing. It wears the stacked row's price line (.ray-feedrow-price: mono,
 * figures in ink) and wraps between parts, never inside one — the reason line
 * above it is never cut for it.
 */
import React, { useMemo } from 'react';
import type { AuctionLot } from '../types';
import { decisionOf, decisionParts, type Decision } from '../lib/lot-face';

/** "projected close ~$34K" → ["projected close ", "~$34K", ""] */
const FIG = /^(.*?)(~?\$[\d.,]+[KM]?(?:–\$[\d.,]+[KM]?)?)(.*)$/;

function Part({ text, title, tone }: { text: string; title?: string; tone?: 'up' | 'down' }) {
  const m = text.match(FIG);
  const ink = tone === 'up' ? 'var(--color-up)' : tone === 'down' ? 'var(--color-down-text)' : undefined;
  return (
    <span title={title} style={ink ? { color: ink } : undefined}>
      {m ? <>{m[1]}<b style={ink ? { color: ink } : undefined}>{m[2]}</b>{m[3]}</> : text}
    </span>
  );
}

export default function DecisionLine({ lot, when = true, estimate = true, abstain = 'say', nowMs, className, style }: {
  lot: AuctionLot;
  /** false: leave a two-sided house estimate out (a host that already prints
   *  it — the card, the feed row, the Watching ledger); a projection and a
   *  one-sided estimate always print */
  estimate?: boolean;
  /** false: leave the close out (a surface that prints its own Hammers column) */
  when?: boolean;
  /** an engine that abstained: 'say' prints "no engine read"; 'quiet'
   *  prints nothing for it (a list that explains abstention once, in its
   *  how-to-read — a row never implies a value either way) */
  abstain?: 'say' | 'quiet';
  /** the clock (tests, frozen captures); default: now */
  nowMs?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const d: Decision = useMemo(() => decisionOf(lot, nowMs ?? Date.now()), [lot, nowMs]);
  // a one-sided estimate is never what the host printed (formatEstimate
  // leads with the bid there) — the line names it
  const showClose = !!d.close && (estimate || d.close.kind !== 'est' || d.close.oneSided);
  const texts = decisionParts(d, { when, close: showClose });
  // a line with no figure on it (only the close time the host already
  // prints) is not a decision — nothing renders
  const sayAbstain = d.abstained && abstain === 'say';
  if (!texts.length || (!(d.close && showClose) && !d.worth && !sayAbstain)) return null;
  const parts: React.ReactNode[] = [];
  if (d.close && showClose) parts.push(<Part key="c" text={d.close.text} title={d.close.title} />);
  if (d.worth) parts.push(<Part key="w" text={d.worth.text} title={d.worth.title} />);
  else if (sayAbstain) parts.push(<Part key="w" text="no engine read" title="The engine abstained on this lot — no max bid" />);
  if (d.gap) parts.push(<Part key="g" text={d.gap.text} tone={d.gap.dir === 'room' ? 'up' : 'down'} />);
  if (d.when && when) parts.push(<Part key="t" text={d.when.text} />);
  return (
    <span className={`ray-feedrow-price ck-decision${className ? ` ${className}` : ''}`} style={style}>
      {parts.map((p, i) => (
        <React.Fragment key={i}>{i > 0 && <span aria-hidden style={{ margin: '0 6px' }}>·</span>}{p}</React.Fragment>
      ))}
    </span>
  );
}
