'use client';
/**
 * CompareTray — up to four entities of ANY kind side by side (makers overhaul
 * P2): a maker beside a player beside a Pokémon. One column each: its own
 * trend (complete quarters, gaps as gaps — never rebased onto a shared axis,
 * the mix artefact that printed "Basquiat +6926%"), the year-over-year read
 * where the n gate passed, live count + flags, the 12-month median with its n
 * and scope, and its three live lots that matter most. The picks ride the URL
 * (cmp=); "See them together" opens the ledger's lots body scoped to them.
 */
import React, { useState } from 'react';
import Link from 'next/link';
import { formatPrice } from '../../utils';
import { liveBookHref } from '../../lib/lot-browser';
import { fmtPct, lastQuarterOf, type Row } from '../../lib/entity/ledger';
import { Spark, medianTitle } from './EntityRow';
import { LiveLotRow } from './EntityPanel';

export default function CompareTray({ picked, search, onRemove, onClear, onSeeLots }: {
  /** the picks that resolve, in pick order */
  picked: Row[];
  search: string;
  onRemove: (id: string) => void;
  onClear: () => void;
  /** the lots body scoped to these ids */
  onSeeLots: (ids: string[]) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const liveTotal = picked.reduce((n, r) => n + r.live, 0);
  return (
    <div className="mkc" role="region" aria-label="Compare">
      <div className="rail mkc-bar">
        <span className="mkc-title">Compare</span>
        {picked.map(r => (
          <span key={r.id} className="mkc-chip">
            {r.label}
            <button type="button" onClick={() => onRemove(r.id)} aria-label={`Remove ${r.label} from compare`}>×</button>
          </span>
        ))}
        {picked.length < 2 && <span className="mkc-hint">Pick {2 - picked.length} more — any maker, player, Pokémon or set</span>}
        <span className="mkc-rule" aria-hidden />
        {picked.length > 1 && liveTotal > 0 && (
          <button type="button" className="mkc-btn" onClick={() => onSeeLots(picked.map(r => r.id))}>
            All {liveTotal.toLocaleString()} live lots
          </button>
        )}
        {picked.length >= 2 && (
          <button type="button" className="mkc-btn" onClick={() => setExpanded(v => !v)} aria-expanded={expanded}>
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        )}
        <button type="button" className="mkc-btn" onClick={onClear}>Clear</button>
      </div>
      {/* one pick is a bar and a hint — the columns open with the second,
          so the tray never covers the rows the reader is still picking from */}
      {expanded && picked.length >= 2 && (
        <div className="rail mkc-body" style={{ '--n': Math.max(2, picked.length) } as React.CSSProperties}>
          {picked.map(r => {
            const lq = lastQuarterOf(r);
            return (
              <div key={r.id} className="mkc-col">
                <div className="mkc-col-head">
                  {r.page
                    ? <Link href={liveBookHref(r.page, search, { land: false })} className="mkc-col-name">{r.label}</Link>
                    : <span className="mkc-col-name">{r.label}</span>}
                  {r.tag && <span className="mk-tag">{r.tag}</span>}
                </div>
                <div className="mkc-trend">
                  {r.spark ? <Spark values={r.spark} w={180} h={40} /> : <span className="mkc-none">No quarterly trend — under 3 sales a quarter</span>}
                  <span className="mkc-cap">
                    {r.spark ? <>12 complete quarters{lq ? <> · last {lq.q.replace('-', ' ')} {formatPrice(lq.v)}</> : null}</> : null}
                    {r.yoy ? <> · YoY <b data-dir={r.yoy.pct >= 0 ? 'up' : 'down'}>{fmtPct(r.yoy.pct)}</b> <span title={`n ${r.yoy.n}`}>n {r.yoy.n.toLocaleString()}</span></> : null}
                  </span>
                </div>
                <dl className="mkc-facts">
                  <div><dt>Live</dt><dd>{r.live > 0 ? r.live.toLocaleString() : '—'}{r.flags > 0 ? <i> · {r.flags} flagged</i> : null}</dd></div>
                  <div title={medianTitle(r)}>
                    <dt>Median · 12 mo</dt>
                    <dd>{r.median ? <>{formatPrice(r.median)}{r.medianN ? <i> · n {r.medianN.toLocaleString()}</i> : null}</> : '—'}</dd>
                  </div>
                  {r.medianScope && r.median ? <div><dt>Over</dt><dd><i>{r.medianScope}</i></dd></div> : null}
                </dl>
                <div className="mkc-lots">
                  {r.liveLots.slice(0, 3).map(l => <LiveLotRow key={l.id} l={l} letter={r.label.charAt(0)} kind={r.kind} />)}
                  {r.live > 3 && (
                    <button type="button" className="mkx-live-more" onClick={() => onSeeLots([r.id])}>
                      +{(r.live - 3).toLocaleString()} more live
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
