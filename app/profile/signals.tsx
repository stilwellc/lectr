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
import { clearSignals, unmarkLot } from '../lib/recs-signals';
import AlertsInbox from '../components/AlertsInbox';
import QuickStart from '../components/QuickStart';
import { SignalMark } from '../components/marks';
import { craftTitle } from '../utils';
import { RoomHead } from './head';

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
  const { follows, toggle, applyMany, ready } = useFollows();
  // every chip removed since the last Undo — one Undo brings them all back
  // (R4 P3-13: it used to restore only the last)
  const [undo, setUndo] = useState<Follow[]>([]);
  const [adding, setAdding] = useState(false);
  const groups = useMemo(() => KIND_ORDER.map(k => ({ k, fs: follows.filter(f => f.kind === k) })).filter(g => g.fs.length), [follows]);
  if (!ready) return null;
  const add = () => { if (onAdd) onAdd(); else setAdding(true); };
  return (
    <div className="ck-sig-block">
      <div className="ck-reads-head"><span className="kicker">Follows{follows.length ? ` · ${follows.length}` : ''}</span><i className="ck-reads-rule" /></div>
      {groups.length === 0 && (
        <p className="ck-sig-note">Nothing followed yet — a maker, player, subject, category or house you follow leads your picks.</p>
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
                onClick={() => { void toggle(f); setUndo(u => [...u.filter(x => !(x.kind === f.kind && x.key === f.key)), f]); }}>
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
        {undo.length > 0 && (
          <span role="status" className="ck-sig-note" style={{ margin: 0 }}>
            Unfollowed {undo.length === 1 ? undo[0].label : `${undo.length}: ${undo.map(f => f.label).join(', ')}`}.{' '}
            <button type="button" className="ray-toolbar-reset" onClick={() => { void applyMany({ add: undo, drop: [] }); setUndo([]); }}>Undo</button>
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

const MARKS_SHOWN = 5;

/** the on-device ledger: counts, every mark (each removable), the most
 *  recent things learned, Clear */
export function OnDevice() {
  const store = useSignals();
  const [cleared, setCleared] = useState(false);
  const [allMarks, setAllMarks] = useState(false);
  const s = useMemo(() => {
    if (!store) return null;
    const n = (k: string) => store.ev.filter(e => e.k === k).length;
    const recent = store.ev
      .map(e => ({ t: e.t, what: e.k === 'search' ? `searched “${e.label || e.id}”` : e.k === 'entity' ? `opened ${e.label || e.id}` : `looked at ${e.lot ? craftTitle(e.lot.title, e.lot.auctionHouse) : e.label || 'a lot'}` }))
      .sort((a, b) => b.t - a.t).slice(0, 5);
    // every mark, newest first, each removable on its own (R4 P2-5: after a
    // reload the pick's Undo is gone and a "Not for me" lot never returns —
    // this is where one mark is taken back without clearing everything)
    const marks = store.marks
      .map(m => ({ id: m.id, t: m.t, what: `${m.k === 'more' ? 'More like this:' : 'Not for me:'} ${m.lot ? craftTitle(m.lot.title, m.lot.auctionHouse) : 'a lot'}` }))
      .sort((a, b) => b.t - a.t);
    return {
      lots: n('lot') + n('comps'), pages: n('entity'), searches: n('search'),
      more: store.marks.filter(m => m.k === 'more').length, less: store.marks.filter(m => m.k === 'less').length,
      recent, marks, any: store.ev.length + store.marks.length > 0,
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
          {s.marks.length > 0 && (
            <ul className="ck-sig-recent" aria-label="Your More like this / Not for me marks">
              {(allMarks ? s.marks : s.marks.slice(0, MARKS_SHOWN)).map(m => (
                <li key={m.id}>
                  <span>{m.what}</span>
                  <span className="ck-sig-when">
                    {ago(m.t)} ·{' '}
                    <button type="button" className="ray-toolbar-reset" aria-label={`Remove mark — ${m.what}`} onClick={() => unmarkLot(m.id)}>Remove</button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {s.marks.length > MARKS_SHOWN && (
            <p className="ck-sig-note" style={{ margin: '8px 0 0' }}>
              <button type="button" className="ray-toolbar-reset" aria-expanded={allMarks} onClick={() => setAllMarks(v => !v)}>
                {allMarks ? 'Show fewer marks' : `Show all ${s.marks.length} marks`}
              </button>
            </p>
          )}
          {s.recent.length > 0 && (
            <ul className="ck-sig-recent">
              {s.recent.map((r, i) => <li key={i}><span>{r.what}</span><span className="ck-sig-when">{ago(r.t)}</span></li>)}
            </ul>
          )}
          <p className="ck-sig-note">
            These lean your picks a little; More like this / Not for me steer them at once. This record lives in this
            browser and is never uploaded. The pages you open and the searches you run still reach lectr’s servers the
            way any page view does — search loads its index in pieces named by the first letters you type, and a feed
            search shows in the address bar.{' '}
            <button type="button" className="ray-toolbar-reset" onClick={() => { clearSignals(); setCleared(true); }}>Clear all</button>
          </p>
        </>
      ) : (
        <p className="ck-sig-note">
          {cleared ? 'Cleared. Picks now read only what you save, own, follow and search.' : 'Nothing learned here yet — what you open, search and mark in this browser leans your picks; that record stays in this browser.'}
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
          ? 'Sign in and a search you save from any feed is matched nightly against every new lot — matches land here.'
          : 'None yet — save a search from any feed and every new lot is matched against it nightly.'}
      </p>
    </>
  );
  return (
    <section id="signals" className="ray-saved-section rail" aria-label="Your signals">
      <div className="ns-plate" style={{ paddingTop: 18 }}>
        <RoomHead className="ray-enter" mark={<SignalMark size={17} />} title="Your signals" style={{ marginBottom: 6 }}
          help={{ name: 'Your signals', body: <>            Your picks read, in order of weight: what you <b>own</b>, <b>save</b>, <b>follow</b> and <b>search</b>, then what
            you open in this browser. Follows and saved searches live {signedOut ? 'on this device until you sign in, then in your account' : 'in your account'};
            what this device learned is kept in this browser and never uploaded (the pages themselves load from lectr,
            like any site). Remove anything here and the picks re-read at once.
          </> }}
          sub="What tunes your picks — remove anything here and they re-read at once" />
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
