'use client';
/**
 * YOUR RECORD — the figures row (once), the receipt, the timeline (lifted
 * from page.tsx unchanged).
 */
import React from 'react';
import Link from 'next/link';
import { RecordMark } from '../../../components/marks';
import { CellGrid, Cell, ColorCell } from '../../../components/cells';
import { formatPrice, formatDate, craftTitle, fmtSignedPct } from '../../../utils';
import { RoomHead } from '../../head';
import { useDeskInternals, type DeskInternals } from '../provider';
import type { SectionProps, SectionMeta, DeskData } from '../types';
import { Term } from './shared';

/** THE RECORD TIMELINE — every judged call in hammer order around the
    estimate line: mint beat it, coral missed it. Height rides a sqrt scale
    clamped at ±300% so one runaway outcome can't flatten the sequence.
    Each bar deep-links to its lot; the receipts stay attached. */
export function RecordTimeline({ series }: { series: { id: string; d: string; pct: number; title: string }[] }) {
  if (series.length < 5) return null;
  const HALF = 52;
  const h = (pct: number) => Math.max(2, Math.round(Math.sqrt(Math.min(Math.abs(pct), 300) / 300) * HALF));
  return (
    <div className="ck-rec-tl">
      <span className="kicker">Call by call</span>
      <div className="ck-rec-tl-band" role="list" aria-label={`${series.length} judged calls in hammer order`}>
        {series.map(x => {
          const flat = Math.round(x.pct) === 0;
          const up = x.pct > 0;
          return (
            <Link key={x.id} href={`/lot?id=${encodeURIComponent(x.id)}`} className="ck-rec-tl-bar" role="listitem"
              aria-label={`${fmtSignedPct(Math.round(x.pct))} vs estimate, ${formatDate(x.d)}`}
              title={`${craftTitle(x.title)} — ${fmtSignedPct(Math.round(x.pct))} vs estimate · ${formatDate(x.d)}`}>
              <i style={{
                height: h(x.pct),
                background: flat ? 'var(--color-text-faint)' : up ? 'var(--color-up)' : 'var(--color-down-text)',
                ...(up || flat ? { bottom: '50%' } : { top: '50%' }),
              }} />
            </Link>
          );
        })}
      </div>
      <span className="ck-rec-tl-cap">each judged call in hammer order · above the line beat its estimate</span>
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
  const { record, recordLedByAppraisal, collection, upcoming, summary, settledCount } = i;
  return (
    <section id="record" className="ray-saved-section rail ray-enter" aria-label="Your record">
      <div className="ns-plate" style={{ paddingTop: 18 }}>
        <RoomHead mark={<RecordMark size={17} />} title="Your record" style={{ marginBottom: 16 }}
          help={{ name: 'Your record', body: <>                    <b>Appraised vs bought</b>: the engine&rsquo;s appraisal of your pieces against what you paid — only pieces with a
            recorded price enter the read. <b>Your record</b>: each settled watch judged against its estimate, median, all-in.
            The signed figure is green only when it is a real gain, red only when it is a real loss; with no signed read
            yet it stays ink. <b>Collection</b>: pieces held, at the engine&rsquo;s appraisal — pieces without a usable comp
            pool carry at their bought price. <b>On the block</b>: your live watches, at estimate midpoint over the lots
            that carry one. <b>Settled</b>: every watch that has hammered — the line-item receipts are under History.
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
              label="Appraised vs bought"
              body={`${formatPrice(collection.totalAppraised)} vs ${formatPrice(collection.totalPaid)} bought`}
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
          {collection.rows.length > 0 && (
            <Cell
              stat={collection.rows.length.toLocaleString()}
              statNote={collection.rows.length === 1 ? 'piece held' : 'pieces held'}
              label="Collection"
              body={collection.appraisedN > 0
                ? `${formatPrice(collection.totalAppraised)} at appraisal`
                : `Not appraised yet · 0 of ${collection.rows.length} ${collection.rows.length === 1 ? 'piece has' : 'pieces have'} comps`}
              href="#collection"
            />
          )}
          {upcoming.length > 0 && (
            <Cell
              stat={upcoming.length.toLocaleString()}
              statNote="watching, live"
              label="On the block"
              body={summary.totalEst > 0 ? `${formatPrice(summary.totalEst)} at est. midpoint${summary.flagged > 0 ? ` · ${summary.flagged} below market` : ''}` : 'tracked to the hammer'}
              href="#watching"
            />
          )}
          {settledCount > 0 && (
            <Cell
              stat={settledCount.toLocaleString()}
              statNote={settledCount === 1 ? 'settled watch' : 'settled watches'}
              label="Settled"
              body={record ? `${record.n} judged · ${formatPrice(record.realized)} realized` : 'awaiting judgment'}
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
                {record.n} {record.n === 1 ? 'watch' : 'watches'} <Term k="judged">judged</Term> <Term k="vs estimate">vs estimate</Term> · median, all-in · {formatPrice(record.realized)} realized ·{' '}
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
