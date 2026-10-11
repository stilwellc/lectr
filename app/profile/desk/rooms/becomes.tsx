'use client';
/**
 * WHAT ELSE THIS PAGE BECOMES — the ghost desk (lifted from page.tsx
 * unchanged): what the rooms below the fold hold once there is data. Signed
 * out it carries the split head; a signed-in empty desk gets the two CTAs.
 * Rendered only while the desk is empty (never on a live desk).
 */
import React from 'react';
import Link from 'next/link';
import { useDeskInternals, type DeskInternals } from '../provider';
import type { SectionProps, SectionMeta, DeskData } from '../types';

export function when(_desk: DeskData, i: DeskInternals): boolean { return !i.deskView; }
export function meta(): SectionMeta | null { return null; }

export default function Becomes(_p: SectionProps) {
  const { signedOutView } = useDeskInternals();
  const ghost = (
    <div className="ck-ghost" aria-hidden>
      <div className="ck-ghost-row"><span className="kicker">Watching</span><span>your live lots · signals + bids tracked to the hammer</span></div>
      <div className="ck-ghost-row"><span className="kicker">Your record</span><span>every settled watch judged vs its estimate — your eye, measured</span></div>
      <div className="ck-ghost-row"><span className="kicker">Collection</span><span>the pieces you own, appraised against the live market nightly</span></div>
    </div>
  );
  if (signedOutView) {
    return (
      <section className="rail ray-enter" style={{ paddingTop: 34, paddingBottom: 8 }}>
        <div className="ns-plate" style={{ paddingTop: 18 }}>
          <div className="ns-split" style={{ marginBottom: 6 }}>
            <h2 className="ray-h2" style={{ margin: 0 }}>What else this page becomes</h2>
            <p>Watch lots to the hammer, keep your track record, and hold your collection against the engine&rsquo;s live appraisal. Private to you, synced everywhere.</p>
          </div>
          {ghost}
        </div>
      </section>
    );
  }
  return (
    <section className="rail ray-enter" style={{ paddingTop: 34 }}>
      <div className="ns-plate" style={{ paddingTop: 18 }}>
        <h2 className="ray-h2" style={{ margin: 0 }}>What else this page becomes</h2>
        {ghost}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', padding: '26px 0 24px' }}>
          <Link href="/value" className="ray-call-btn ray-call-btn-primary" style={{ textDecoration: 'none', display: 'inline-block' }}>
            Start with today&rsquo;s below-market lots
          </Link>
          <Link href="/" className="ray-call-btn ray-call-btn-quiet" style={{ textDecoration: 'none', display: 'inline-block' }}>
            Browse the markets
          </Link>
        </div>
      </div>
    </section>
  );
}
