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
import { useSavedSearches } from '../lib/alerts';
import { useSignals } from '../lib/use-recs';
import { clearSignals, unmarkLot } from '../lib/recs-signals';
import AlertsInbox from '../components/AlertsInbox';
import QuickStart from '../components/QuickStart';
import { SignalMark } from '../components/marks';
import { craftTitle } from '../utils';
import { HelpChip } from './help';

const KIND_ORDER: FollowKind[] = ['maker', 'entity', 'cat', 'house'];
const KIND_LABEL: Record<FollowKind, string> = { maker: 'Makers & players', entity: 'Subjects', cat: 'Categories', house: 'Houses' };

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
        <p className="ck-sig-note">Nothing followed yet. Follow a maker, player, subject, category or house and its live lots lead your picks.</p>
      )}
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
          {cleared ? 'Cleared. Picks now read only what you save, own, follow and search.' : 'Nothing learned here yet.'} The lots and pages you open in this browser, what you search, and your More like this / Not for me marks lean your picks. lectr keeps that record in this browser and never uploads it.
        </p>
      )}
    </div>
  );
}

export default function YourSignals({ book, signedOut }: { book: readonly AuctionLot[]; signedOut: boolean }) {
  const { searches, ready } = useSavedSearches();
  return (
    <section id="signals" className="ray-saved-section rail" aria-label="Your signals">
      <div className="ns-plate" style={{ paddingTop: 18 }}>
        <div className="ray-enter" style={{ display: 'flex', alignItems: 'baseline', gap: '4px 14px', flexWrap: 'wrap', marginBottom: 14 }}>
          <h2 className="ray-h2" style={{ margin: 0 }}><span className="ray-sect-mark" aria-hidden><SignalMark size={17} /></span>Your signals</h2>
          <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>what tunes your picks</span>
          <HelpChip name="Your signals">
            Your picks read, in order of weight: what you <b>own</b>, <b>save</b>, <b>follow</b> and <b>search</b>, then what
            you open in this browser. Follows and saved searches live {signedOut ? 'on this device until you sign in, then in your account' : 'in your account'};
            what this device learned is kept in this browser and never uploaded (the pages themselves load from lectr,
            like any site). Remove anything here and the picks re-read at once.
          </HelpChip>
        </div>
        <div className="ck-sig-grid">
          <div>
            <FollowChips book={book} />
            <OnDevice />
          </div>
          <div id="inbox" className="ck-sig-block">
            <AlertsInbox embedded />
            {ready && searches.length === 0 && (
              <>
                <div className="ck-reads-head"><span className="kicker">Saved searches</span><i className="ck-reads-rule" /></div>
                <p className="ck-sig-note">
                  {signedOut
                    ? 'Sign in and the searches you save from any feed are matched nightly against every new lot — the matches land here.'
                    : 'No saved searches yet. Save one from any feed’s search and the nightly crawl matches every new lot against it — the matches land here.'}
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
