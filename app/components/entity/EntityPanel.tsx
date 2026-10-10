'use client';
/**
 * EntityPanel — the ledger row's inline read (makers overhaul P2), LIVE
 * FIRST: the row's live lots (eight, ordered by what matters / closing /
 * estimate), then three facts (the 12-month median with its n and scope, the
 * record, the houses), then the way out: the entity's own page. No photo
 * banner, no chart — the page carries those; the panel is for deciding.
 */
import React, { useMemo } from 'react';
import Link from 'next/link';
import { ARTIST_LABEL } from '../../constants';
import type { AuctionLot } from '../../types';
import { formatDate, formatPrice, craftTitle, httpsImg, sizedImg, trueSaleDay } from '../../utils';
import { formatEstimate } from '../LotCard';
import CloseClock from '../CloseClock';
import Flick from '../Flick';
import { isFlagged } from '../../lib/flags';
import { reasonOf } from '../../lib/priority';
import { makerLineOf, labelLineOf } from '../../lib/lot-labels';
import { subLabelOf } from '../../lib/taxonomy';
import { liveBookHref } from '../../lib/lot-browser';
import { recordOf } from '../../lib/entity/model';
import type { RowKind } from '../../lib/entity/kinds';
import type { LiveSort } from '../../lib/entity/view-state';
import { useEntity } from '../../hooks/useEntities';
import { fmtUsd, type Row } from '../../lib/entity/ledger';

/** a live lot's quiet line under its title — the home feed's label line,
 *  then the house. Under a sub row the sub is the row's own name, so the
 *  lot's player / Pokémon leads; under a subject row, the label line alone */
function lotSubLine(l: AuctionLot, kind: RowKind): string {
  let parts: string[];
  if (kind === 'sub' || kind === 'rest') {
    const who = makerLineOf(l).name;
    parts = [who !== (ARTIST_LABEL[l.artist] || l.artist) ? who : '', ...labelLineOf(l).split(' · ').filter(p => p !== subLabelOf(l))];
  } else parts = [labelLineOf(l)];
  return [...parts, l.auctionHouse].filter(Boolean).join(' · ');
}

/** one live lot, as the panel and the compare tray print it */
export function LiveLotRow({ l, letter, kind, note }: { l: AuctionLot; letter: string; kind: RowKind; note?: string | null }) {
  const t = l.saleDateTime ? Date.parse(l.saleDateTime) : NaN;
  const closeSoon = Number.isFinite(t) && t - Date.now() < 24 * 3600e3 && t > Date.now();
  return (
    <Link href={`/lot/${l.id}`} className="mkx-lot">
      <span className="mkx-lot-thumb" aria-hidden>
        <span className="mkx-lot-letter">{letter}</span>
        {l.imageUrl && (
          <img src={sizedImg(httpsImg(l.imageUrl), 120)} alt="" referrerPolicy="no-referrer" loading="lazy" decoding="async"
            onError={e => e.currentTarget.remove()} />
        )}
      </span>
      <span className="mkx-lot-main">
        <span className="mkx-lot-title">{craftTitle(l.title, l.auctionHouse)}</span>
        <span className="mkx-lot-sub">
          {lotSubLine(l, kind)}
          {isFlagged(l) && <span className="mkx-lot-flag"> · flagged below market</span>}
          {(() => {
            // the flag already says "below market" — the reason never repeats it
            const why = note && isFlagged(l) ? note.split(' · ').filter(p => p !== 'Below market').join(' · ') : note;
            return why ? <span className="mkx-lot-why"> · {why}</span> : null;
          })()}
        </span>
      </span>
      <span className="mkx-lot-cells">
        <span className="mkx-lot-est">{formatEstimate(l)}</span>
        <span className="mkx-lot-close">
          {closeSoon
            ? <span style={{ color: 'var(--color-fg)', fontWeight: 600 }}><CloseClock iso={l.saleDateTime!} windowHours={24} /></span>
            : <>closes {formatDate(l.saleDate)}</>}
        </span>
      </span>
    </Link>
  );
}

/* the live book: eight rows, three orders */
export const LIVE_SORTS: [LiveSort, string][] = [['matters', 'Matters'], ['closing', 'Closing'], ['est', 'Est.']];
export const LIVE_ROWS = 8;
/** the close instant (timed close, else the true sale day's start) */
export const closeKey = (l: AuctionLot) => {
  const t = l.saleDateTime ? Date.parse(l.saleDateTime) : NaN;
  if (Number.isFinite(t)) return t;
  const d = trueSaleDay(l);
  return d ? Date.parse(`${d}T00:00:00Z`) : Infinity;
};
/** the asking level: estimate high, else low, else the live bid */
export const estKey = (l: AuctionLot) => l.estimateHigh || l.estimateLow || l.currentBid || 0;
export function orderLive(lots: readonly AuctionLot[], s: LiveSort): AuctionLot[] {
  return s === 'matters' ? lots.slice()
    : s === 'closing' ? [...lots].sort((a, b) => closeKey(a) - closeKey(b))
    : [...lots].sort((a, b) => estKey(b) - estKey(a));
}

export default function EntityPanel({
  r, open, liveSort, search, isSel, isFollowed, authEnabled, onLiveSort, onToggleCompare, onToggleFollow, onSeeLots,
}: {
  r: Row; open: boolean; liveSort: LiveSort; search: string;
  isSel: boolean; isFollowed: boolean; authEnabled: boolean;
  onLiveSort: (ls: LiveSort) => void;
  onToggleCompare: (id: string) => void;
  onToggleFollow: (key: string, label: string) => void;
  onSeeLots: (id: string) => void;
}) {
  const shown = useMemo(() => orderLive(r.liveLots, liveSort).slice(0, LIVE_ROWS), [r.liveLots, liveSort]);
  // the record's title / house and the houses live in the detail bucket —
  // fetched when the panel first opens (the remainder row has none)
  const { detail } = useEntity(r.kind === 'rest' ? null : r.id, open && !r.detail, r.bundle);
  const det = r.detail ?? detail;
  const rec = useMemo(() => recordOf(r.record, det), [r.record, det]);
  const houses = det?.houses?.length ? det.houses.slice().sort((a, b) => b.n - a.n).slice(0, 3) : null;
  const letter = r.label.charAt(0);
  const hasSold = r.kind !== 'rest' && (r.sold ?? 0) > 0;
  return (
    <>
      <div className="mkx-live">
        <div className="mkx-live-head kicker">
          <span>
            {r.live > 0
              ? <>On the block · {r.live.toLocaleString()} live{r.flags > 0 ? <> · <b className="mkx-live-flagn">{r.flags} flagged by the engine</b></> : null}</>
              : 'Nothing on the block under these filters'}
          </span>
          {r.liveLots.length > 1 && (
            <span role="radiogroup" aria-label="Order the live lots" className="mkx-live-sorts">
              {LIVE_SORTS.map(([k, lbl]) => (
                <button key={k} type="button" role="radio" aria-checked={liveSort === k} className="mk-chip mk-chip-sm" data-on={liveSort === k || undefined}
                  onClick={() => onLiveSort(k)}>
                  {lbl}
                </button>
              ))}
            </span>
          )}
        </div>
        {/* under Matters each lot says why it ranks (app/lib/priority reasonOf) */}
        {shown.map(l => <LiveLotRow key={l.id} l={l} letter={letter} kind={r.kind} note={liveSort === 'matters' ? reasonOf(l) : null} />)}
        {r.live > shown.length && (
          <button type="button" className="mkx-live-more" onClick={() => onSeeLots(r.id)}>
            See all {r.live.toLocaleString()} live lots <Flick size={9} style={{ marginLeft: 4 }} />
          </button>
        )}
      </div>

      {hasSold && (
        <div className="mkx-grid">
          <div>
            <span className="kicker">Typical sale · 12 mo</span>
            <p>
              {r.median
                ? <><b>{formatPrice(r.median)}</b> median{r.medianN ? <> · n {r.medianN.toLocaleString()}</> : null}{r.medianScope ? <> · {r.medianScope}</> : null}</>
                : <>Under 5 sales in the last 12 months — no median</>}
              {r.sold12 > 0 && <><br />{r.sold12.toLocaleString()} sold in 12 mo · {(r.sold ?? 0).toLocaleString()} all time</>}
            </p>
          </div>
          <div>
            <span className="kicker">The record</span>
            {rec ? (
              <p><b>{formatPrice(rec.p)}</b>{rec.d ? <> · {formatDate(rec.d)}</> : null}{rec.h ? <> · {rec.h}</> : null}{rec.t ? <><br /><span className="mkx-rec-t">{rec.t}</span></> : null}</p>
            ) : <p>—</p>}
          </div>
          <div>
            <span className="kicker">The houses</span>
            {houses ? (
              <div className="mkx-houses">
                {houses.map((h, _, arr) => (
                  <div key={h.h} className="mkx-house">
                    <span className="mkx-house-name">{h.h}</span>
                    <span className="mkx-house-track" aria-hidden><span style={{ width: `${Math.round((h.n / Math.max(1, arr[0].n)) * 100)}%` }} /></span>
                    <span className="mkx-house-n">{h.n.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            ) : <p>{det ? '—' : '…'}</p>}
          </div>
        </div>
      )}

      <div className="mkx-actions">
        {r.page ? (
          <Link href={liveBookHref(r.page, search, { land: false })} className="ray-call-btn ray-call-btn-primary">
            {r.kind === 'maker' ? 'Open the maker page' : r.kind === 'player' ? 'Open the player page' : 'Open the page'}
          </Link>
        ) : r.feed ? (
          <Link href={liveBookHref(r.feed, search)} className="ray-call-btn ray-call-btn-primary">See every lot</Link>
        ) : null}
        {r.canCompare && (
          <button type="button" className="mk-chip" data-on={isSel || undefined} onClick={() => onToggleCompare(r.id)}>
            {isSel ? 'In compare' : 'Add to compare'}
          </button>
        )}
        {authEnabled && r.follow && (
          <button type="button" className="mk-chip" data-on={isFollowed || undefined} onClick={() => onToggleFollow(r.follow!, r.label)}>
            {isFollowed ? 'Following' : 'Follow'}
          </button>
        )}
        {r.revenue > 0 && (
          <span className="mkx-act-note">{fmtUsd(r.revenue)} settled, all time</span>
        )}
      </div>
    </>
  );
}
