'use client';
/**
 * WHAT ELSE THIS PAGE BECOMES — the cold desk's SECTION INDEX (Oct 11
 * review, R3#2/#3): one row per room this desk doesn't have yet, each row
 * the tap that starts filling it (desk/sections FILLS — Watch buttons on
 * this page, /value, tonight's closers, /receipts). Signed out and signed
 * in alike get the taps (the signed-out branch used to print ghost rows and
 * no button). Rendered only while rooms are missing — never on a full desk.
 */
import React from 'react';
import Link from 'next/link';
import { RoomHead } from '../../head';
import { jump } from '../../rail';
import { unfilledSections } from '../sections';
import { useDesk, useDeskInternals, type DeskInternals } from '../provider';
import type { SectionProps, SectionMeta, DeskData } from '../types';

export function when(desk: DeskData, i: DeskInternals): boolean { return unfilledSections(desk, i).length > 0; }
export function meta(): SectionMeta | null { return null; }

function Tap({ href, label }: { href: string; label: string }) {
  return href.startsWith('#')
    ? <a href={href} className="ck-index-tap" onClick={e => { e.preventDefault(); jump(href.slice(1)); }}>{label} <span aria-hidden>→</span></a>
    : <Link href={href} className="ck-index-tap">{label} <span aria-hidden>→</span></Link>;
}

export default function Becomes(_p: SectionProps) {
  const { desk } = useDesk();
  const i = useDeskInternals();
  const rooms = unfilledSections(desk, i);
  if (!rooms.length) return null;
  const cold = !i.deskView && desk.recs.length === 0 && desk.follows.length === 0;
  return (
    <section id="becomes" className="ray-saved-section rail ray-enter ck-becomes" aria-label="What else this page becomes">
      <div className="ns-plate" style={{ paddingTop: 18 }}>
        <RoomHead title="What else this page becomes" style={{ marginBottom: 6 }}
          sub={cold
            ? 'Every room below fills from one tap. Private to you, synced everywhere once you sign in.'
            : `${rooms.length} ${rooms.length === 1 ? 'room' : 'rooms'} not on this desk yet — each fills from one tap.`} />
        <div className="ck-index" role="list">
          {rooms.map(s => {
            const M = s.mark;
            return (
              <div key={s.id} className="ck-index-row" role="listitem" id={`becomes-${s.id}`}>
                <span className="ck-index-k">{M && <span className="ray-sect-mark ck-index-mark" aria-hidden><M size={13} /></span>}{s.label}</span>
                <span className="ck-index-what">{s.fill!.text} <span className="ck-index-how">· {s.fill!.how}</span></span>
                <Tap href={s.fill!.tap.href} label={s.fill!.tap.label} />
              </div>
            );
          })}
        </div>
        {cold && (
          <div className="ck-index-ctas">
            <Link href="/value" className="ray-call-btn ray-call-btn-primary" style={{ textDecoration: 'none', display: 'inline-block' }}>
              Start with today&rsquo;s below-market lots
            </Link>
            <Link href="/" className="ray-call-btn ray-call-btn-quiet" style={{ textDecoration: 'none', display: 'inline-block' }}>
              Browse the markets
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}
