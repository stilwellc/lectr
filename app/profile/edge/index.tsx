'use client';
/**
 * YOUR EDGE `#edge` (THE DESK v3 §9, Oct 11 2026) — the record deep-dive:
 * the reader's calls against the hammer, by market, with the receipts; and
 * the desk card, a 1200×630 PNG rendered on this device.
 *
 * A pure function of DeskData (desk/types.ts): saved + metaFor + ledger +
 * follows + now. The grading lives in ./edge.ts, the card in ./card.ts —
 * both plain .ts with unit tests. Styles: ./edge.css, existing tokens only.
 *
 * (THE DESK v4, Oct 29 2026) a receipt is the desk's one row (../desk/row
 * DeskRow): the hammer is the figure, the miss off your call (ink, never a
 * lamp) and hit / miss under it; what you called (or your max) on the meta
 * line. The calibration table keeps its column heads; the desk card stays.
 */
import { Thumb } from '../desk/thumb';
import { DeskRow } from '../desk/row';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { SectionProps, SectionMeta, DeskData } from '../desk/types';
import { CellGrid, Cell, ColorCell } from '../../components/cells';
import { CalibrationMark } from '../../components/marks';
import { RoomHead } from '../head';
import { fmtFace } from '../../lib/lot-face';
import { craftTitle, fmtSignedPct, formatDate } from '../../utils';
import { SIGNED_SIGNAL_SINCE } from '../../lib/account';
import {
  gradeDesk, biasText, dayOf, EDGE_MIN_N, EDGE_HIT_PCT, EDGE_MONTHS,
  type EdgeReport, type GradedCall, type MarketRow,
} from './edge';
import { cardNumbersOf, cardLines, cardHasNumber, drawDeskCard, CARD_W, CARD_H, type CardLines } from './card';
import './edge.css';

const reportOf = (desk: DeskData): EdgeReport =>
  gradeDesk({ now: desk.now, saved: desk.saved, metaFor: desk.metaFor, ledger: desk.ledger });

export function meta(desk: DeskData): SectionMeta {
  const r = reportOf(desk);
  return { id: 'edge', label: 'Your calls', count: r.n > 0 ? r.n : null, quiet: r.n === 0 && desk.saved.length === 0 };
}

const pct = (p: number) => fmtSignedPct(Math.round(p));
/** a MISS is the hammer's distance from your call — error, not gain: its sign
 *  says above/below your call, its ink is always neutral (the lamp is for a
 *  measured move of the market, never for being wrong by +101%) */
const missInk = (p: number | null) => ({ color: p == null ? 'var(--color-text-faint)' : 'var(--color-fg)' });

function MarketLine({ row, all }: { row: MarketRow; all?: boolean }) {
  const gated = row.n < EDGE_MIN_N;
  return (
    <div className="pe-trow" data-all={all ? '' : undefined} role="row">
      <span className="pe-mk" role="cell">{row.label}</span>
      <span className="pe-num" data-k="Calls" role="cell">{row.n}</span>
      <span className="pe-num" data-k="Median miss" role="cell" style={gated ? undefined : missInk(row.medianMiss)}
        title={gated ? `prints at ${EDGE_MIN_N} calls` : 'median of realized ÷ called − 1'}>
        {gated ? <span className="pe-faint">at {EDGE_MIN_N}</span> : pct(row.medianMiss!)}
      </span>
      <span className="pe-num" data-k={`Within ±${EDGE_HIT_PCT}%`} role="cell">{row.hits} of {row.n}</span>
      <span className="pe-bias pe-muted" data-k="Bias" role="cell">{gated ? '—' : biasText(row)}</span>
    </div>
  );
}

function CallCard({ label, c }: { label: string; c: GradedCall }) {
  const href = `/lot?id=${encodeURIComponent(c.id)}`;
  return (
    <div className="ns-well pe-call">
      <div className="ns-well-label">{label}</div>
      <div className="ns-well-body pe-call-body">
        <Link href={href} className="pe-call-ph" tabIndex={-1} aria-hidden="true"><Thumb src={c.img} label={c.maker || c.title} size={96} /></Link>
        <Link href={href} className="pe-call-title">{craftTitle(c.title, c.house)}</Link>
        <div className="pe-call-sub pe-muted">{[c.maker, c.house, formatDate(c.date)].filter(Boolean).join(' · ')}{c.provisional ? ' · result provisional' : ''}</div>
        <div className="pe-call-line">
          called <b>{fmtFace(c.called)}</b> <span className="pe-muted">({pct(c.callPct)} vs est. {fmtFace(c.estMid)})</span> · hammer <b>{fmtFace(c.price)}</b> ·{' '}
          <b style={missInk(c.missPct)}>{pct(c.missPct)}</b> <span className="pe-muted">off your call</span>
        </div>
      </div>
    </div>
  );
}

function Months({ r }: { r: EdgeReport }) {
  const max = Math.max(1, ...r.months.map(m => m.n));
  const any = r.months.some(m => m.n > 0);
  return (
    <div className="pe-months">
      <div className="ck-reads-head"><span className="kicker">By month · last {EDGE_MONTHS}</span><i className="ck-reads-rule" /></div>
      <div className="pe-mgrid" role="img" aria-label={`calls graded per month: ${r.months.map(m => `${m.label} ${m.n}`).join(', ')}`}>
        {r.months.map(m => (
          <div key={m.key} className="pe-mcol">
            {m.n > 0
              ? <i className="pe-mbar" style={{ height: `${Math.max(6, Math.round((m.n / max) * 100))}%` }} title={`${m.n} graded`} />
              : <i className="pe-mgap" title="no call hammered" />}
          </div>
        ))}
      </div>
      <div className="pe-mcap">
        {r.months.map(m => (
          <div key={m.key} className="pe-mcol">
            <span className="pe-mlabel">{m.label}</span>
            <span className="pe-mn">{m.n > 0 ? <>{m.n} · {m.hits} hit</> : <span className="pe-faint">—</span>}</span>
            <span className="pe-mmed" style={m.medianMiss == null ? undefined : missInk(m.medianMiss)}>
              {m.medianMiss != null ? pct(m.medianMiss) : m.n > 0 ? <span className="pe-faint">n&lt;{EDGE_MIN_N}</span> : ''}
            </span>
          </div>
        ))}
      </div>
      <p className="ck-sig-note" style={{ marginTop: 8 }}>
        {any
          ? <>bar = calls hammered that month · the month&rsquo;s median miss prints at {EDGE_MIN_N}; under it the month shows its n only</>
          : <>none of your calls hammered in the last {EDGE_MONTHS} months — the series fills as they close</>}
      </p>
    </div>
  );
}

const ROWS = 6;
function Receipts({ r }: { r: EdgeReport }) {
  const [all, setAll] = useState(false);
  const rows = r.graded.slice().reverse();
  const vis = all ? rows : rows.slice(0, ROWS);
  return (
    <div className="pe-receipts">
      <div className="ck-reads-head"><span className="kicker">Every call · {r.n}</span><i className="ck-reads-rule" /></div>
      <div className="dk-list" role="list">
        {vis.map(c => (
          <DeskRow key={c.id} lot={{ id: c.id, title: c.title, auctionHouse: c.house, imageUrl: c.img }} who={c.maker || c.title} attrs={{ role: 'listitem' }}
            sub={`${[c.maker, c.house, c.marketLabel, formatDate(c.date)].filter(Boolean).join(' · ')}${c.provisional ? ' · provisional' : ''}`}
            meta={<span className="dk-meta-fact">called <b>{fmtFace(c.called)}</b> <span className="pe-muted">({pct(c.callPct)} vs est. {fmtFace(c.estMid)})</span></span>}
            figureKind="hammer" figure={fmtFace(c.price)}
            figureSub={<><b style={missInk(c.missPct)}>{pct(c.missPct)}</b> off your call · <span className={c.hit ? 'pe-hit' : 'pe-faint'}>{c.hit ? 'hit' : 'miss'}</span></>} />
        ))}
      </div>
      {rows.length > ROWS && (
        <div className="ck-more-row" style={{ marginTop: 12 }}>
          <button className="ray-show-more" onClick={() => setAll(a => !a)}>{all ? 'Show fewer' : `Show all ${rows.length}`}</button>
        </div>
      )}
    </div>
  );
}

/** the Inter family the page renders with (next/font's hashed name) */
function pageFontFamily(): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--font-inter').trim();
    return v || 'Inter, sans-serif';
  } catch { return 'Inter, sans-serif'; }
}

/** the card drawn on a canvas (state lifted so the room head's toolbar pill
 *  can offer the download — R5#7 / R3#8): a preview data URL, the state,
 *  and the download handler */
function useDeskCard(lines: CardLines, day: string) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [state, setState] = useState<'drawing' | 'ready' | 'failed'>('drawing');
  const key = JSON.stringify(lines);
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const canvas = canvasRef.current ?? document.createElement('canvas');
        canvasRef.current = canvas;
        canvas.width = CARD_W; canvas.height = CARD_H;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('no 2d context');
        const fontFamily = pageFontFamily();
        try {
          await Promise.all([300, 400, 500].map(w => document.fonts.load(`${w} 24px ${fontFamily}`)));
        } catch { /* draw with whatever the browser resolves */ }
        const wordmark = await new Promise<HTMLImageElement | null>(res => {
          const img = new Image();
          img.onload = () => res(img);
          img.onerror = () => res(null);
          img.src = '/brand/lectr-ink-lg.png';
        });
        if (dead) return;
        drawDeskCard(ctx, JSON.parse(key) as CardLines, { fontFamily, wordmark });
        setPreview(canvas.toDataURL('image/png'));
        setState('ready');
      } catch {
        if (!dead) setState('failed');
      }
    })();
    return () => { dead = true; };
  }, [key]);

  const download = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `lectr-desk-${day}.png`;
      document.body.appendChild(a); a.click(); a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    }, 'image/png');
  }, [day]);

  return { preview, state, download };
}

/** the print and its one caption — the record's absence is said ON the
 *  card (recordNote) and nowhere else beside it (R1#19: not twice) */
function DeskCard({ lines, preview, state, hasNumber }: { lines: CardLines; preview: string | null; state: 'drawing' | 'ready' | 'failed'; hasNumber: boolean }) {
  return (
    <div className="pe-card">
      <div className="pe-card-frame" aria-busy={state === 'drawing'}>
        {preview
          // eslint-disable-next-line @next/next/no-img-element
          ? <img className="pe-card-img" src={preview} width={CARD_W} height={CARD_H} alt={`Desk card: ${lines.headline.word} ${lines.headline.figure}, ${lines.sub}${lines.record ? `, record ${lines.record.figure} ${lines.record.rest}` : lines.recordNote ? `, ${lines.recordNote}` : ''}${lines.names.length ? `; your names ${lines.names.join(', ')}` : ''}`} />
          : <div className="pe-card-wait pe-muted">{state === 'failed' ? 'The card could not be drawn in this browser.' : 'Drawing…'}</div>}
      </div>
      <div className="pe-card-side">
        <span className="kicker">Desk card</span>
        <p className="pe-card-dek">
          {CARD_W}×{CARD_H} PNG of the desk&rsquo;s headline numbers — brand ink on eggshell, the page&rsquo;s Inter.
          Rendered on this device and saved by you; never uploaded, no server.
          {!hasNumber && <> <b>Download PNG</b> arrives with the card&rsquo;s first number — a watch on the block or a graded record.</>}
        </p>
      </div>
    </div>
  );
}

/** YOUR MAX vs THE HAMMER — the reader's own price, graded (leads the room) */
function MyMaxBlock({ r }: { r: EdgeReport }) {
  const m = r.mine;
  if (m.n === 0) {
    return (
      <p className="pe-mine-empty">
        <b>Grade your own price.</b> Set <b>My max</b> on a watch (Watching → open a row); when it hammers, this room grades your
        max against the hammer — not only the engine&rsquo;s call.
      </p>
    );
  }
  const rows = m.calls.slice().reverse().slice(0, 6);
  return (
    <div className="pe-mine">
      <div className="ck-reads-head"><span className="kicker">Your max vs the hammer · {m.n}</span><i className="ck-reads-rule" /></div>
      <CellGrid min={200} className="ck-cells ck-figs">
        <Cell stat={`${m.hits} of ${m.n}`} label={`Within ±${EDGE_HIT_PCT}% of your max`} body="your price called the hammer" />
        <Cell stat={`${m.inReach} of ${m.n}`} label="In reach" body="the hammer came in at or under your max" />
        <Cell stat={m.medianMiss == null ? '—' : pct(m.medianMiss)} statNote={m.medianMiss == null ? `prints at ${EDGE_MIN_N}` : undefined}
          label="Median gap" body="hammer vs your max (+ = it ran past you)" />
      </CellGrid>
      <div className="dk-list" role="list">
        {rows.map(c => (
          <DeskRow key={c.id} lot={{ id: c.id, title: c.title, auctionHouse: c.house, imageUrl: c.img }} who={c.maker || c.title} attrs={{ role: 'listitem' }}
            sub={[c.maker, c.house, formatDate(c.date)].filter(Boolean).join(' · ')}
            meta={<span className="dk-meta-fact">your max <b>{fmtFace(c.max)}</b></span>}
            figureKind="hammer" figure={fmtFace(c.price)}
            figureSub={<><b style={missInk(c.missPct)}>{pct(c.missPct)}</b> · <span className={c.inReach ? 'pe-hit' : 'pe-faint'}>{c.inReach ? 'in reach' : 'past you'}</span></>} />
        ))}
      </div>
    </div>
  );
}

export default function EdgeSection({ desk }: SectionProps) {
  const r = useMemo(() => reportOf(desk), [desk]);
  const lines = useMemo(() => cardLines(cardNumbersOf({
    now: desk.now, saved: desk.saved, metaFor: desk.metaFor, follows: desk.follows, record: r.record, graded: r.n,
  })), [desk, r]);
  const day = useMemo(() => dayOf(desk.now), [desk.now]);
  const card = useDeskCard(lines, day);
  const hasNumber = cardHasNumber(lines);
  const gated = r.n < EDGE_MIN_N;
  // (pass 5) nothing graded on either side yet: the room is one quiet line and its tap
  const empty = r.n === 0 && r.mine.n === 0;
  const ex = r.excluded;
  const whyNot = [
    ex.noCall ? `${ex.noCall} settled ${ex.noCall === 1 ? 'watch' : 'watches'} carried no signal when saved` : null,
    ex.legacy ? `${ex.legacy} ${ex.legacy === 1 ? 'was' : 'were'} saved before ${formatDate(SIGNED_SIGNAL_SINCE)} (direction not recorded then)` : null,
    ex.noEstimate ? `${ex.noEstimate} ${ex.noEstimate === 1 ? 'has' : 'have'} no estimate to grade against` : null,
  ].filter(Boolean).join(' · ');

  return (
    <section id="edge" className="ray-saved-section rail ray-enter" aria-label="Your edge">
      <div className="ns-plate" style={{ paddingTop: 18 }}>
        <RoomHead mark={<CalibrationMark size={17} />} title="Your calls" style={{ marginBottom: 16 }}
          help={{ name: 'Your calls', body: <>            A <b>call</b> is the engine&rsquo;s signal as it stood when you saved the lot — comps sitting, say, 12% above
            the ask (saved below market) or below it. Once the lot hammers, the call is graded: <b>called</b> is the
            estimate midpoint moved by the call, <b>miss</b> is the realized price against that (the same realized
            price the Record judges, premium included where the house includes it), a <b>hit</b> is a miss within
            ±{EDGE_HIT_PCT}%. <b>Median miss</b> and <b>bias</b> (which side of your calls the hammers ran) print at {EDGE_MIN_N} calls
            per row. <b>Streak</b> counts hits in a row in hammer order. <b>Engine agreement</b>: of the graded lots the
            engine still reads today, how many it reads on the side you saved. Saves with no signal at the time, saves
            from before {formatDate(SIGNED_SIGNAL_SINCE)} (no direction recorded) and lots with no estimate are never graded; a result the
            house has not finalised is labelled provisional. Nothing here is uploaded.
          </> }}
          sub={r.settled === 0
            ? <>no settled watch yet — calls grade as your watches hammer</>
            : <>{r.n} {r.n === 1 ? 'call' : 'calls'} graded against the hammer · {r.settled} settled {r.settled === 1 ? 'watch' : 'watches'}{r.provisional ? <> · {r.provisional} provisional</> : null}</>}
          actions={hasNumber ? (
            <button type="button" className="ray-toolbar-pill" onClick={card.download} disabled={card.state !== 'ready'}
              title={card.state === 'ready' ? `${CARD_W}×${CARD_H} PNG of the desk card — rendered on this device, never uploaded` : card.state === 'failed' ? 'The card could not be drawn in this browser' : 'Drawing the card…'}
              aria-label="Download the desk card as a PNG">Download PNG</button>
          ) : undefined} />

        {empty ? (
          <p className="ck-outcome-line dk-empty">
            {r.settled === 0
              ? <>No settled watch yet — calls grade as your watches hammer, and <b>My max</b> on a watch grades your own price too.</>
              : <>{r.settled} settled, none graded yet{whyNot ? <> — {whyNot}</> : null}. <b>My max</b> on a live watch grades your own price when it hammers.</>}{' '}
            <a href="#watching" className="dk-empty-tap">Watching</a>
          </p>
        ) : <MyMaxBlock r={r} />}
        {!empty && <div className="ck-reads-head pe-engine-head"><span className="kicker">The engine&rsquo;s call when you saved · {r.n}</span><i className="ck-reads-rule" /></div>}
        {empty ? null : gated ? (
          <p className="ck-outcome-line">
            {r.n === 0
              ? <><b>No call graded yet.</b> The record reads at {EDGE_MIN_N} graded calls.</>
              : <><b>{r.n} {r.n === 1 ? 'call' : 'calls'} graded</b> — medians, hit rate and bias print at {EDGE_MIN_N}.</>}
            {whyNot ? <> {whyNot}.</> : null}
          </p>
        ) : (
          <>
            <CellGrid min={200} className="ck-cells ck-figs">
              <ColorCell dir="ink" stat={pct(r.all.medianMiss ?? 0)} label="Median miss"
                body={`${r.n} calls · realized vs called · ${biasText(r.all) ?? ''}`} href="#settled" />
              <Cell stat={`${Math.round((r.all.hitRate ?? 0) * 100)}%`} statNote={`${r.all.hits} of ${r.n} within ±${EDGE_HIT_PCT}%`} label="Hit rate"
                body={`a hit: the hammer landed within ±${EDGE_HIT_PCT}% of the price your call put it at`} />
              <Cell stat={String(r.streak.current)} statNote={r.streak.current === 1 ? 'hit in a row' : 'hits in a row'} label="Streak"
                body={`best ${r.streak.best} · hammer order, newest last`} />
              <Cell stat={r.agreement.n ? `${r.agreement.agree} of ${r.agreement.n}` : '—'} label="Engine agreement"
                body={r.agreement.n
                  ? `the engine still reads ${r.agreement.n} of these lots; ${r.agreement.agree} on the side you saved`
                  : 'the engine has no current read on these settled lots'} />
            </CellGrid>
            {whyNot && <p className="ck-sig-note">Not graded: {whyNot}.</p>}

            <div className="pe-table" role="table" aria-label="Calls by market">
              <div className="pe-thead kicker" role="row">
                <span role="columnheader">Market</span>
                <span className="pe-num" role="columnheader">Calls</span>
                <span className="pe-num" role="columnheader">Median miss</span>
                <span className="pe-num" role="columnheader">Within ±{EDGE_HIT_PCT}%</span>
                <span role="columnheader">Bias</span>
              </div>
              {r.markets.map(m => <MarketLine key={m.market} row={m} />)}
              {r.markets.length > 1 && <MarketLine row={r.all} all />}
            </div>

            {r.best && (
              <div className="pe-calls">
                <CallCard label="Best call" c={r.best} />
                {r.worst && <CallCard label="Worst call" c={r.worst} />}
              </div>
            )}

            <Months r={r} />
            <Receipts r={r} />
          </>
        )}

        {!gated || empty ? null : r.n > 0 && <Receipts r={r} />}
        {(!empty || hasNumber) && <DeskCard lines={lines} preview={card.preview} state={card.state} hasNumber={hasNumber} />}
      </div>
    </section>
  );
}
