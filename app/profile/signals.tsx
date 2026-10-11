'use client';
/**
 * YOUR SIGNALS (Oct 11 2026, /profile redesign) — everything that tunes
 * "Lots you may like", in one room, each part managed where it is shown:
 *
 *   Follows          chips by kind, each removable (signed in: the same
 *                    saved_searches remove; signed out: the device list),
 *                    with Undo, and + Add → the quick start picker
 *   Saved searches   AlertsInbox, contents unchanged (digest, +N more,
 *                    quiet fold, delete, Mark all read, orphan strip)
 *   On this device   what recs-signals learned in this browser — opened
 *                    lots, subject pages, searches, More like this / Not
 *                    for me — as a dotted ledger with Clear. Never sent.
 */
import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import type { AuctionLot } from '../types';
import { useFollows, type Follow, type FollowKind } from '../lib/follows';
import { useSavedSearches, useAlerts } from '../lib/alerts';
import { useInterests, priceText } from '../lib/interests';
import { MARKETS } from '../constants';
import { useSignals } from '../lib/use-recs';
import { clearSignals } from '../lib/recs-signals';
import AlertsInbox from '../components/AlertsInbox';
import QuickStart from '../components/QuickStart';
import { SignalMark } from '../components/marks';
import { craftTitle } from '../utils';
import { HelpChip } from './help';

const KIND_ORDER: FollowKind[] = ['maker', 'entity', 'cat', 'house'];
const KIND_LABEL: Record<FollowKind, string> = { maker: 'Makers & players', entity: 'Subjects', cat: 'Categories', house: 'Houses' };

/** what the reader STATED in the quick start — markets + price range —
 *  shown where it tunes the picks, and editable in place (Edit → the
 *  same quick start). Absent until the quick start has been finished once. */
function Stated({ onEdit }: { onEdit: () => void }) {
  const it = useInterests();
  if (!it.at && !it.markets.length && it.minUsd == null && it.maxUsd == null) return null;
  const mk = it.markets.map(m => MARKETS.find(x => x.key === m)?.label ?? m);
  const price = priceText(it.minUsd != null || it.maxUsd != null ? { minUsd: it.minUsd, maxUsd: it.maxUsd } : null);
  return (
    <div className="ck-sig-stated">
      <span className="ck-sig-k">Markets</span>
      <span className="ck-sig-v">{mk.length ? mk.join(' · ') : 'any'}</span>
      <span className="ck-sig-k">Price</span>
      <span className="ck-sig-v">{price ?? 'any'}</span>
      <button type="button" className="ck-warn-btn ck-sig-edit" aria-haspopup="dialog" onClick={onEdit}
        aria-label="Edit the markets and price range you stated">Edit</button>
    </div>
  );
}

export function FollowChips({ book, onAdd }: { book: readonly AuctionLot[]; onAdd?: () => void }) {
  const { follows, toggle, ready } = useFollows();
  const [undo, setUndo] = useState<Follow | null>(null);
  const [adding, setAdding] = useState(false);
  const groups = useMemo(() => KIND_ORDER.map(k => ({ k, fs: follows.filter(f => f.kind === k) })).filter(g => g.fs.length), [follows]);
  if (!ready) return null;
  const add = () => { if (onAdd) onAdd(); else setAdding(true); };
  return (
    <div className="ck-sig-block">
      <div className="ck-reads-head"><span className="kicker">Follows{follows.length ? ` · ${follows.length}` : ''}</span><i className="ck-reads-rule" /></div>
      {groups.length === 0 && (
        <p className="ck-sig-note">Nothing followed yet. Follow a maker, player, subject, category or house and its live lots lead your picks.</p>
      )}
      <Stated onEdit={add} />
      {/* every kind on one wrapping line — the kind a small prefix, not a row */}
      <div className="ck-sig-groups">
      {groups.map(g => (
        <div key={g.k} className="ck-sig-group">
          <span className="ck-sig-k">{KIND_LABEL[g.k]}</span>
          <div className="ck-sig-chips">
            {g.fs.map(f => (
              <button key={`${f.kind}:${f.key}`} type="button" className="ray-toolbar-pill ck-sig-chip"
                aria-label={`Unfollow ${f.label}`} title={`Unfollow ${f.label}`}
                onClick={() => { void toggle(f); setUndo(f); }}>
                {f.label}<span aria-hidden className="ck-sig-x">×</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      </div>
      <div className="ck-sig-actions">
        <button type="button" className="ray-toolbar-pill ck-sig-add" aria-haspopup="dialog" onClick={add}>+ Add</button>
        <Link href="/makers" className="ck-away-link" style={{ fontSize: 13 }}>Browse makers and players</Link>
        {undo && (
          <span role="status" className="ck-sig-note" style={{ margin: 0 }}>
            Unfollowed {undo.label}.{' '}
            <button type="button" className="ray-toolbar-reset" onClick={() => { void toggle(undo); setUndo(null); }}>Undo</button>
          </span>
        )}
      </div>
      {adding && (
        <div style={{ marginTop: 14 }}>
          <QuickStart book={book} mode="edit" surface="profile" onClose={() => setAdding(false)} />
        </div>
      )}
    </div>
  );
}

const ago = (t: number) => {
  const d = Math.floor((Date.now() - t) / 864e5);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
};

/** the on-device ledger: counts, the most recent things learned, Clear */
export function OnDevice() {
  const store = useSignals();
  const [cleared, setCleared] = useState(false);
  const s = useMemo(() => {
    if (!store) return null;
    const n = (k: string) => store.ev.filter(e => e.k === k).length;
    const recent = [
      ...store.ev.map(e => ({ t: e.t, what: e.k === 'search' ? `searched “${e.label || e.id}”` : e.k === 'entity' ? `opened ${e.label || e.id}` : `looked at ${e.lot ? craftTitle(e.lot.title, e.lot.auctionHouse) : e.label || 'a lot'}` })),
      ...store.marks.map(m => ({ t: m.t, what: `${m.k === 'more' ? 'More like' : 'Not for me:'} ${m.lot ? craftTitle(m.lot.title, m.lot.auctionHouse) : 'a lot'}` })),
    ].sort((a, b) => b.t - a.t).slice(0, 5);
    return {
      lots: n('lot') + n('comps'), pages: n('entity'), searches: n('search'),
      more: store.marks.filter(m => m.k === 'more').length, less: store.marks.filter(m => m.k === 'less').length,
      recent, any: store.ev.length + store.marks.length > 0,
    };
  }, [store]);
  if (!s) return null;
  const figs: [string, number][] = [['Lots opened', s.lots], ['Subject pages', s.pages], ['Searches', s.searches], ['More like this', s.more], ['Not for me', s.less]];
  return (
    <div className="ck-sig-block" id="on-device">
      <div className="ck-reads-head"><span className="kicker">On this device</span><i className="ck-reads-rule" /></div>
      {s.any ? (
        <>
          <div className="ns-byline ck-sig-ledger">
            {figs.map(([k, v]) => <div key={k}><div className="k">{k}</div><div className="v">{v}</div></div>)}
          </div>
          {s.recent.length > 0 && (
            <ul className="ck-sig-recent">
              {s.recent.map((r, i) => <li key={i}><span>{r.what}</span><span className="ck-sig-when">{ago(r.t)}</span></li>)}
            </ul>
          )}
          <p className="ck-sig-note">
            These lean your picks a little; More like this / Not for me steer them at once. They stay in this browser and are never sent to lectr.{' '}
            <button type="button" className="ray-toolbar-reset" onClick={() => { clearSignals(); setCleared(true); }}>Clear all</button>
          </p>
        </>
      ) : (
        <p className="ck-sig-note">
          {cleared ? 'Cleared. Picks now read only what you save, own, follow and search.' : 'Nothing learned here yet.'} The lots and pages you open in this browser, what you type in search, and your More like this / Not for me marks lean your picks — kept on this device only, never sent.
        </p>
      )}
    </div>
  );
}

export default function YourSignals({ book, signedOut }: { book: readonly AuctionLot[]; signedOut: boolean }) {
  const { searches, ready } = useSavedSearches();
  const { unseen } = useAlerts();
  // no saved search and no orphaned matches: the inbox has nothing to show,
  // so its note folds under the follows (one column, no lone sentence)
  const inboxEmpty = ready && searches.length === 0 && unseen === 0;
  const searchesNote = (
    <>
      <div className="ck-reads-head"><span className="kicker">Saved searches</span><i className="ck-reads-rule" /></div>
      <p className="ck-sig-note">
        {signedOut
          ? 'Sign in and the searches you save from any feed are matched nightly against every new lot — the matches land here.'
          : 'No saved searches yet. Save one from any feed’s search and the nightly crawl matches every new lot against it — the matches land here.'}
      </p>
    </>
  );
  return (
    <section id="signals" className="ray-saved-section rail" aria-label="Your signals">
      <div className="ns-plate" style={{ paddingTop: 18 }}>
        <div className="ray-enter" style={{ display: 'flex', alignItems: 'baseline', gap: '4px 14px', flexWrap: 'wrap', marginBottom: 14 }}>
          <h2 className="ray-h2" style={{ margin: 0 }}><span className="ray-sect-mark" aria-hidden><SignalMark size={17} /></span>Your signals</h2>
          <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>what tunes your picks</span>
          <HelpChip name="Your signals">
            Your picks read, in order of weight: what you <b>own</b>, <b>save</b>, <b>follow</b> and <b>search</b>, then what
            you open in this browser. Follows and saved searches live {signedOut ? 'on this device until you sign in, then in your account' : 'in your account'};
            what this device learned never leaves it. Remove anything here and the picks re-read at once.
          </HelpChip>
        </div>
        <div className="ck-sig-grid">
          <div>
            <FollowChips book={book} />
            {inboxEmpty && <div id="inbox" className="ck-sig-block">{searchesNote}</div>}
          </div>
          {inboxEmpty ? (
            <div><OnDevice /></div>
          ) : (
            <div>
              <div id="inbox" className="ck-sig-block">
                <AlertsInbox embedded />
                {ready && searches.length === 0 && searchesNote}
              </div>
              <OnDevice />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
