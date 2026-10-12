'use client';
/** the small instruments the desk's rooms share — the glossary term, the
 *  at-save call cell, the saved-delta caption (lifted from page.tsx) */
import React from 'react';
import type { AuctionLot } from '../../../types';
import { signalCallOf, type SavedMeta } from '../../../lib/account';
import { sigInk, sigText, type LiveSignal } from '../derive';
import { signalMagnitude } from '../../../lib/comps';

/** the at-save CALL's magnitude through THE one formatter (comps.signalMagnitude
 *  — "+38%", "3.2×" past 2×, "−50%"): signed by the direction recorded at save
 *  time (the signed-signal law); a legacy save with no direction prints "±" */
export function callText(call: { dir: 'below' | 'above' | 'unknown'; pct: number }): string {
  const m = signalMagnitude(call.dir === 'above' ? 'Above Market' : 'Below Market', Math.round(call.pct));
  return call.dir === 'unknown' ? m.replace(/^[+−-]/, '±') : m;
}

/* ── THE GLOSSARY — the cockpit's measured jargon, tappable. Terms live in
   captions and heads, never inside an ellipsized cell. ── */
export const GLOSSARY: Record<string, string> = {
  'signal now': 'The engine’s live read on the lot — its comp median against the current ask. Below Market prints +% mint: the comps sit above the price on the block.',
  'delta saved': 'How the signal moved since the day you saved the lot, in percentage points. “Flipped” means it crossed to the other side of market — directions compare only for saves that recorded one.',
  'vs estimate': 'The realized all-in price against the house estimate midpoint — the one yardstick every settled watch is judged by. All-in = hammer plus buyer’s premium.',
  'appraisal': 'The median its comparable sales currently trade at — our read from the data, not a formal appraisal. Pieces without a usable comp pool carry at their bought price.',
  'judged': 'A watch grades once it settles with a published price and carried an estimate to be judged against — no estimate, no judgment.',
};
export function Term({ k, children }: { k: keyof typeof GLOSSARY; children: React.ReactNode }) {
  return (
    <span className="ck-term" tabIndex={0}>
      {children}
      <span className="ck-term-tip" role="tooltip">{GLOSSARY[k]}</span>
    </span>
  );
}

/** the at-save call rendered honestly: legacy saves lost direction → neutral */
export function CallCell({ meta }: { meta: SavedMeta | undefined }) {
  const call = signalCallOf(meta);
  if (!call) return <span className="num" style={{ color: 'var(--color-text-faint)' }}>—</span>;
  if (call.dir === 'unknown') {
    return (
      <span className="num" style={{ color: 'var(--color-text-muted)' }}
        title="Saved before signals recorded their direction — magnitude only.">
        {callText(call)}
      </span>
    );
  }
  return (
    <span className="num" style={{ color: call.dir === 'below' ? 'var(--color-up)' : 'var(--color-down-text)', fontWeight: 600 }}>
      {callText(call)}
    </span>
  );
}

/** What changed on a watched lot since the save (cards view caption). */
export function SavedDelta({ lot, meta, sig }: { lot: AuctionLot; meta?: SavedMeta; sig: LiveSignal | null }) {
  const call = signalCallOf(meta);
  const bits: React.ReactNode[] = [];
  if (call && sig) {
    const sameAxis = (call.dir === 'below' && sig.label === 'Below Market') || (call.dir === 'above' && sig.label === 'Above Market');
    if (call.dir === 'unknown') {
      bits.push(<span key="s">signal now <b style={{ color: sigInk(sig.label) }}>{sigText(sig)}</b></span>);
    } else if (!sameAxis) {
      bits.push(<span key="s">signal flipped since you saved · now <b style={{ color: sigInk(sig.label) }}>{sigText(sig)}</b></span>);
    } else if (Math.round(sig.pct) !== Math.round(call.pct)) {
      bits.push(
        <span key="s">
          signal {callText(call)} <span aria-hidden>↝</span>{' '}
          <b style={{ color: sigInk(sig.label) }}>{sigText(sig)}</b> since you saved
        </span>
      );
    }
  }
  if (meta?.bidCount != null && (lot.bidCount || 0) > meta.bidCount) {
    const n = (lot.bidCount || 0) - meta.bidCount;
    bits.push(<span key="b">+{n} {n === 1 ? 'bid' : 'bids'} since you saved</span>);
  }
  if (!bits.length) return null;
  return (
    <div className="ray-saved-delta">
      {bits.map((b, i) => <React.Fragment key={i}>{i > 0 && ' · '}{b}</React.Fragment>)}
    </div>
  );
}
