'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * MethodologyNote — "How Ray calls it." The comps engine is the moat; this
 * makes it visible. A quiet text trigger opens a portal card explaining the
 * gates in plain language.
 */
export default function MethodologyNote({ trigger = 'How Ray calls it' }: { trigger?: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button className="ray-method-trigger" onClick={() => setOpen(true)}>
        <span aria-hidden="true">ⓘ</span> {trigger}
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <div className="ray-ck-overlay" onClick={() => setOpen(false)} role="presentation">
          <div className="ray-method" role="dialog" aria-modal="true" aria-label="How Ray calls it" onClick={e => e.stopPropagation()}>
            <h3>How Ray calls it</h3>
            <p className="ray-method-lede">
              <b style={{ color: 'var(--color-fg)' }}>The Demand Index</b> is how the
              typical sale performs against its own estimate over the trailing twelve
              months. +30% means the median lot hammered 30% above the estimate
              midpoint; 0% means the market pays exactly what the houses ask; below
              zero, lots are clearing under estimate. Because every sale is measured
              against its own ask, a $900 print and a $3M canvas count equally —
              the index can’t be skewed by what happened to come up for sale.
            </p>
            <p className="ray-method-lede">
              <b style={{ color: 'var(--color-fg)' }}>Deal signals</b> flag a lot when
              the median of its true comparables sits at least 20% above the estimate
              midpoint — and a comparable has to earn the name.
            </p>
            <ul>
              <li>
                <b>Same form, always.</b> Works are classified into 26 forms —
                paintings, works on paper, prints, posters, books, photographs,
                editioned objects, stools, benches, chairs, tables, case pieces and
                more. Stools comp stools. A poster never prices a screenprint.
              </li>
              <li>
                <b>Same edition, first.</b> If the exact work has sold three or more
                times, those sales alone make the call — what did <i>this</i> work
                last hammer for.
              </li>
              <li>
                <b>Sized, when measurable.</b> When both works carry dimensions, a
                40-inch bench never comps a ten-footer, and a miniature never
                prices a mural.
              </li>
              <li>
                <b>Confidence, stated.</b> Every call carries a meter (●●●●).
                Very high means this exact work has sold three or more times;
                high means a large tight pool or one full of same-series titles;
                low means the call passed the guards but the evidence is thin.
              </li>
              <li>
                <b>Silent over wrong.</b> Fewer than three true comps, or a pool
                that disagrees with itself, and Ray says nothing at all.
              </li>
            </ul>
            <p className="ray-method-foot">
              The record: every historical call is replayed point-in-time — using
              only sales that had already happened — and flagged lots have
              outperformed unflagged ones on both median result and the rate of
              beating the high estimate. See &ldquo;The record&rdquo; on the Value page.
            </p>
            <p className="ray-method-foot">
              Every figure links to the auction house record it came from. Estimates
              and results are the houses&rsquo; own, converted to USD.
            </p>
            <button className="ray-method-close" onClick={() => setOpen(false)}>Close</button>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
