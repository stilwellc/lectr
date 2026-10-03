'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../lib/account';
import { supabase } from '../../lib/supabase';
import { track } from '../../lib/analytics';

/**
 * THE PRO FAKE DOOR — measures demand before anything is built. Nothing here
 * is for sale and the card says so the moment it is pressed. A signed-in
 * press writes ONE row per account to public.pro_interest (migration 0008)
 * with an optional price point; a signed-out press opens the sign-in sheet
 * and completes after the round trip. No email capture, no waitlist.
 */
const PRICES = [10, 20, 40] as const;
type Price = (typeof PRICES)[number];
const PENDING_KEY = 'lectr-pending-pro';

const CSS = `
.lectr-pro { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 18px 36px; align-items: start; }
@media (max-width: 760px) { .lectr-pro { grid-template-columns: minmax(0, 1fr); } }
.lectr-pro ul { margin: 0; padding: 0; list-style: none; }
.lectr-pro li { padding: 9px 0; border-bottom: 1px solid var(--hairline); font-size: 13.5px; line-height: 1.45; color: var(--color-text-secondary); }
.lectr-pro li:last-child { border-bottom: none; }
.lectr-pro li b { color: var(--color-fg); font-weight: 600; }
.lectr-pro-prices { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 14px; padding: 0; border: none; }
.lectr-pro-prices legend { font-size: 12.5px; color: var(--color-text-muted); margin-bottom: 8px; padding: 0; }
.lectr-pro-price { min-height: 40px; padding: 0 16px; border-radius: 999px; border: 1px solid var(--color-border); background: none; color: var(--color-fg); font: inherit; font-size: 13.5px; font-variant-numeric: tabular-nums; cursor: pointer; }
.lectr-pro-price[aria-pressed="true"] { background: var(--color-fg); color: var(--color-bg); border-color: var(--color-fg); }
.lectr-pro-note { font-size: 13px; line-height: 1.5; color: var(--color-text-secondary); margin: 12px 0 0; }
.lectr-pro-err { font-size: 12.5px; color: var(--color-down-text); margin: 10px 0 0; }
`;

export default function ProCard() {
  const { authEnabled, user, authReady, openLogin } = useAuth();
  const [price, setPrice] = useState<Price | null>(null);
  const [recorded, setRecorded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const record = useCallback(async (p: Price | null) => {
    if (!supabase || !user) return;
    setBusy(true); setErr(null);
    const { error } = await supabase.from('pro_interest').upsert(
      { user_id: user.id, price_point: p, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    );
    setBusy(false);
    if (error) { setErr('Couldn’t record that — try again.'); return; }
    if (!recorded) track('pro_interest');
    setRecorded(true);
  }, [user, recorded]);

  // returning visitor: show what they already said
  useEffect(() => {
    if (!supabase || !user) return;
    let dead = false;
    supabase.from('pro_interest').select('price_point').eq('user_id', user.id).maybeSingle()
      .then(({ data }) => {
        if (dead || !data) return;
        setRecorded(true);
        const p = data.price_point as number | null;
        setPrice(PRICES.includes(p as Price) ? (p as Price) : null);
      });
    return () => { dead = true; };
  }, [user]);

  // a press made while signed out completes after the sign-in round trip
  useEffect(() => {
    if (!user) return;
    let pend: string | null = null;
    try { pend = localStorage.getItem(PENDING_KEY); localStorage.removeItem(PENDING_KEY); } catch { /* private mode */ }
    if (pend == null) return;
    const p = Number(pend);
    const choice = PRICES.includes(p as Price) ? (p as Price) : null;
    // deferred a tick: the replay is an external event (the OAuth round trip
    // finishing), not render-derived state
    Promise.resolve().then(() => { setPrice(choice); record(choice); });
    // record is intentionally not a dependency: replay exactly once per sign-in
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  if (!authEnabled || !authReady) return null;

  const press = () => {
    if (!user) {
      try { localStorage.setItem(PENDING_KEY, price == null ? '' : String(price)); } catch { /* private mode */ }
      openLogin();
      return;
    }
    record(price);
  };
  const pick = (p: Price) => {
    const next = price === p ? null : p;
    setPrice(next);
    if (recorded && user) record(next); // already counted: keep the price point current
  };

  return (
    <section className="rail ray-enter" aria-label="lectr Pro" style={{ paddingBlock: '34px 48px' }}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="ns-plate" style={{ paddingTop: 18 }}>
        <div className="ns-split" style={{ marginBottom: 16 }}>
          <h2 className="ray-h2" style={{ margin: 0 }}>Pro</h2>
          <p>Three tools for people who bid every week. None of them exist yet.</p>
        </div>
        <div className="lectr-pro">
          <ul>
            <li><b>Alert ladders.</b> Step alerts on a watched lot: at your price, at the value floor, in the last hour.</li>
            <li><b>Max-bid ladders.</b> Walk-away prices at three confidence levels, with the buyer&rsquo;s premium already in.</li>
            <li><b>CSV export.</b> Your watchlist, record and collection, with lectr&rsquo;s reads, as a spreadsheet.</li>
          </ul>
          <div>
            <fieldset className="lectr-pro-prices">
              <legend>What would it be worth a month? (optional)</legend>
              {PRICES.map(p => (
                <button key={p} type="button" className="lectr-pro-price" aria-pressed={price === p} onClick={() => pick(p)} disabled={busy}>
                  ${p}/mo
                </button>
              ))}
            </fieldset>
            {!recorded ? (
              <button className="ray-call-btn ray-call-btn-primary" style={{ border: 'none', cursor: 'pointer' }} onClick={press} disabled={busy}>
                I&rsquo;d pay for this
              </button>
            ) : null}
            {recorded && (
              <p className="lectr-pro-note" role="status">
                <b>Not built yet. We&rsquo;re measuring interest.</b> Your vote is counted once for this account{price ? `, at $${price}/mo` : ''}. Nothing is charged and nothing will be emailed.
              </p>
            )}
            {!recorded && !user && (
              <p className="lectr-pro-note">Sign in to vote. One vote per account.</p>
            )}
            {err && <p className="lectr-pro-err" role="alert">{err}</p>}
          </div>
        </div>
      </div>
    </section>
  );
}
