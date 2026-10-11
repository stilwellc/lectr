'use client';
/** the desk's card grid, shared by the picks rooms (Lots you may like, For
 *  your collection): its column count and its loading seat. */
import React, { useEffect, useState } from 'react';

/** how many columns the desk's card grid lays out (1 = the phone row list) */
export function useGridCols(): 1 | 2 | 3 {
  const [c, setC] = useState<1 | 2 | 3>(3);
  useEffect(() => {
    const phone = window.matchMedia('(max-width: 639px)');
    const mid = window.matchMedia('(max-width: 899.98px)');
    const on = () => setC(phone.matches ? 1 : mid.matches ? 2 : 3);
    on();
    phone.addEventListener('change', on); mid.addEventListener('change', on);
    return () => { phone.removeEventListener('change', on); mid.removeEventListener('change', on); };
  }, []);
  return c;
}
/** the picks' loading seat: the shape of what lands, so nothing below jumps */
export function PickSkeleton({ cols, n }: { cols: 1 | 2 | 3; n: number }) {
  return cols === 1 ? (
    <div aria-hidden className="ck-sk-rows">{Array.from({ length: Math.min(n, 4) }, (_, i) => <div key={i} className="ck-sk-row"><i className="ray-sk" /><span><i className="ray-sk" /><i className="ray-sk" /><i className="ray-sk" /></span></div>)}</div>
  ) : (
    <div aria-hidden className="ray-saved-grid ck-picks">{Array.from({ length: Math.min(n, cols) }, (_, i) => <div key={i} className="ck-sk-card"><i className="ray-sk" /><i className="ray-sk" /><i className="ray-sk" /><i className="ray-sk" /></div>)}</div>
  );
}
