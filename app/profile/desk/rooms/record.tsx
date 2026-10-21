'use client';
/**
 * YOUR RECORD — the figures row (once), the receipt, the timeline (lifted
 * from page.tsx unchanged).
 */
import React, { useState } from 'react';
import Link from 'next/link';
import { RecordMark } from '../../../components/marks';
import { CellGrid, Cell, ColorCell } from '../../../components/cells';
import { formatDate, craftTitle, fmtSignedPct } from '../../../utils';
import { fmtFace } from '../../../lib/lot-face';
import { RoomHead } from '../../head';
import { useDeskInternals, type DeskInternals } from '../provider';
import type { SectionProps, SectionMeta, DeskData } from '../types';
import { Term } from './shared';

/** THE RECORD TIMELINE — every judged call in hammer order around the
    estimate line: mint beat it, coral missed it. Height rides a sqrt scale
    clamped at ±300% so one runaway outcome can't flatten the sequence.
    Each bar deep-links to its lot; the receipts stay attached. */
export function RecordTimeline({ series }: { series: { id: string; d: string; pct: number; title: string }[] }) {
  // (R2 e) a 12×108px bar is no tap target: a tap REVEALS the call under the
  // band (title · % · date · Open the lot) instead of leaving the page
  const [picked, setPicked] = useState<string | null>(null);
  if (series.length < 5) return null;
  const HALF = 52;
  const h = (pct: number) => Math.max(2, Math.round(Math.sqrt(Math.min(Math.abs(pct), 300) / 300) * HALF));
  const sel = picked ? series.find(x => x.id === picked) ?? null : null;
  return (
    <div className="ck-rec-tl">
      <span className="kicker">Call by call</span>
      <div className="ck-rec-tl-band" role="group" aria-label={`${series.length} judged calls in hammer order`}>
        {series.map(x => {
          const flat = Math.round(x.pct) === 0;
          const up = x.pct > 0;
          return (
            <button key={x.id} type="button" className="ck-rec-tl-bar" aria-pressed={picked === x.id}
              aria-label={`${fmtSignedPct(Math.round(x.pct))} vs estimate, ${formatDate(x.d)} — ${craftTitle(x.title)}`}
              title={`${craftTitle(x.title)} — ${fmtSignedPct(Math.round(x.pct))} vs estimate · ${formatDate(x.d)}`}
              onClick={() => setPicked(p => (p === x.id ? null : x.id))}>
              <i style={{
                height: h(x.pct),
                background: flat ? 'var(--color-text-faint)' : up ? 'var(--color-up)' : 'var(--color-down-text)',
                ...(up || flat ? { bottom: '50%' } : { top: '50%' }),
              }} />
            </button>
          );
        })}
      </div>
      <span className="ck-rec-tl-cap">
        {sel
          ? <>{craftTitle(sel.title)} · <b style={{ color: Math.round(sel.pct) > 0 ? 'var(--color-up)' : Math.round(sel.pct) < 0 ? 'var(--color-down-text)' : 'var(--color-fg)' }}>{fmtSignedPct(Math.round(sel.pct))}</b> vs estimate · {formatDate(sel.d)} · <Link href={`/lot?id=${encodeURIComponent(sel.id)}`} className="ck-away-link">Open the lot</Link></>
          : <>each judged call in hammer order · above the line beat its estimate · tap a bar for the lot</>}
      </span>
    </div>
  );
}

export function when(_desk: DeskData, i: DeskInternals): boolean { return i.deskView && i.hasRecordRoom; }
export function meta(_desk: DeskData, i: DeskInternals): SectionMeta | null {
  if (!when(_desk, i)) return null;
  const med = i.record && i.record.med != null ? Math.round(i.record.med) : null;
  return { id: 'record', label: 'Record', count: med != null ? fmtSignedPct(med) : undefined, tone: med != null && med > 0 ? 'up' : med != null && med < 0 ? 'down' : undefined };
}

export default function RecordRoom(_p: SectionProps) {
  const i = useDeskInternals();
  const { record, recordLedByAppraisal, collection, settledCount } = i;
  return (
    <section id="record" className="ray-saved-section rail ray-enter" aria-label="Your record">
      <div className="ns-plate" style={{ paddingTop: 18 }}>
        <RoomHead mark={<RecordMark size={17} />} title="Your record" style={{ marginBottom: 16 }}
          help={{ name: 'Your record', body: <>                    <b>Marked vs bought</b>: the engine&rsquo;s mark on your pieces against what you paid — only pieces the engine
            appraised that also carry a bought price enter the read, n stated. <b>Your record</b>: each settled watch judged against its estimate, median, all-in.
            The signed figure is green only when it is a real gain, red only when it is a real loss; with no signed read
            yet it stays ink.  <b>Settled</b>: every watch that has hammered — the line-item receipts are under History.
          </> }}
          sub={!record && settledCount > 0 ? <>{settledCount} settled · awaiting judgment</> : null} />
        {/* THE DESK IN FIGURES — one forced-color cell carries the
            desk's signed read (collection.deltaPct / record.med exactly
            as computed; zero or none → ink abstention); the quiet cells
            are counts the page prints nowhere else now */}
        <CellGrid min={200} className="ck-cells ck-figs">
          {/* the lead is a MEASUREMENT: appraised vs bought only once ≥1
              piece with a bought price has a comp-based appraisal;
              until then the record's median vs estimate leads */}
          {recordLedByAppraisal && collection.deltaPct != null ? (
            <ColorCell
              dir={collection.deltaPct > 0 ? 'up' : collection.deltaPct < 0 ? 'down' : 'ink'}
              stat={fmtSignedPct(collection.deltaPct)}
              label="Marked vs bought"
              body={`${fmtFace(collection.totalAppraised)} marked vs ${fmtFace(collection.appraisedPaid)} bought · ${collection.appraisedPaidN} of ${collection.rows.length} ${collection.rows.length === 1 ? 'piece' : 'pieces'}`}
              href="#collection"
            />
          ) : record && record.med != null ? (
            <ColorCell
              dir={record.med > 0 ? 'up' : record.med < 0 ? 'down' : 'ink'}
              stat={fmtSignedPct(Math.round(record.med))}
              label="Your record"
              body={`${record.n} judged · median vs estimate`}
              href="#settled"
            />
          ) : (
            <ColorCell dir="ink" stat="—" label="Your record" body="No signed read yet" />
          )}
          {/* (Oct 20 audit, one job per tab) the Collection and On-the-block cells
              left: their figures lead their own tabs */}
          {settledCount > 0 && (
            <Cell
              stat={settledCount.toLocaleString()}
              statNote={settledCount === 1 ? 'settled watch' : 'settled watches'}
              label="Settled"
              body={record ? `${record.n} judged · ${fmtFace(record.realized)} realized` : 'awaiting judgment'}
              href="#settled"
            />
          )}
        </CellGrid>
        {record && record.med != null && (
          <div className="ck-record" style={{ marginTop: 26 }}>
            <div className="ck-record-lead">
              <span className="kicker">Median vs estimate</span>
              {/* the display figure prints once: when the lead cell above
                  already carries this median, the line below is enough */}
              {recordLedByAppraisal && (
                <span className="ck-record-fig" style={{ color: record.med > 0 ? 'var(--color-up)' : record.med < 0 ? 'var(--color-down-text)' : 'var(--color-fg)' }}>
                  {fmtSignedPct(Math.round(record.med))}
                </span>
              )}
              <span className="ck-record-s">
                {record.n} {record.n === 1 ? 'watch' : 'watches'} <Term k="judged">judged</Term> <Term k="vs estimate">vs estimate</Term> · median, all-in · {fmtFace(record.realized)} realized ·{' '}
                <a href="#settled" className="ck-away-link">receipts below</a>
              </span>
            </div>
            {record.split ? (
              <div className="ck-record-split">
                <span className="kicker">Flagged vs the rest</span>
                <span className="ck-record-splitline">
                  saved while flagged below market{' '}
                  <b style={{ color: (record.split.flagged ?? 0) > 0 ? 'var(--color-up)' : (record.split.flagged ?? 0) < 0 ? 'var(--color-down-text)' : 'var(--color-fg)' }}>{fmtSignedPct(Math.round(record.split.flagged ?? 0))}</b>{' '}
                  ({record.split.flaggedN}) · saved while showing above market{' '}
                  <b style={{ color: (record.split.rest ?? 0) > 0 ? 'var(--color-up)' : (record.split.rest ?? 0) < 0 ? 'var(--color-down-text)' : 'var(--color-fg)' }}>{fmtSignedPct(Math.round(record.split.rest ?? 0))}</b>{' '}
                  ({record.split.restN}) — vs estimate, all-in
                </span>
              </div>
            ) : (
              <div className="ck-record-split">
                <span className="kicker">Flagged vs the rest</span>
                <span className="ck-record-splitline" style={{ color: 'var(--color-text-muted)' }}
                  title="Saves with no live signal at save time count toward neither side; direction recorded since Aug 2026.">
                  publishes once 3 flagged-below and 3 above-market saves settle
                </span>
              </div>
            )}
            <RecordTimeline series={record.series} />
          </div>
        )}
      </div>
    </section>
  );
}
