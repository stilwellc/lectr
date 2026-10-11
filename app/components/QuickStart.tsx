'use client';
/**
 * QuickStart — "What do you collect?" (Oct 11 2026). A brand-new or
 * signed-out reader becomes personalized picks in three taps: pick a market,
 * tap the names (and categories) you collect from that market's top live
 * entities — or search any name — and, optionally, a price range. The answers
 * are stored as follows (app/lib/follows — on the device signed out, in the
 * account signed in) plus the price range (app/lib/interests); the
 * recommender (app/lib/recs) reads them on the next render, so the picks land
 * the moment the reader finishes.
 *
 * Desktop: an inline panel where the cold state used to be. Phone: a one-line
 * prompt that opens the feed toolbar's bottom sheet (FEEDSHEET_CSS). Built
 * from the existing chips (.ray-toolbar-pill), search (.ray-toolbar-search),
 * avatars and call buttons only.
 *
 * Pure logic + tests: app/lib/quickstart (state, ranking, entity → follow).
 */
import React, { useEffect, useId, useMemo, useReducer, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AuctionLot } from '../types';
import type { Market } from '../constants';
import { isOnBlock, localToday, httpsImg, sizedImg } from '../utils';
import { useFollows, followsDiff, sameFollow, type Follow } from '../lib/follows';
import { useInterests, writeInterests } from '../lib/interests';
import {
  QS_MARKETS, QS_STEPS, canAdvance, initQs, qsReduce, marketLots, topNames, topCats, searchNames,
  type QsOption, type QsStep,
} from '../lib/quickstart';
import { loadEntities, type LoadedEntities } from '../hooks/useEntities';
import { VALUE_FLOORS, VALUE_CEILINGS, fmtCeiling } from '../lib/feed-filters';
import { FEEDSHEET_CSS } from './FeedToolbar';
import { useDialogFocus } from './useDialogFocus';
import ArtistAvatar from './ArtistAvatar';

const STEP_LABEL: Record<QsStep, string> = { markets: 'Markets', names: 'Names', price: 'Price' };
const fmtFloor = (n: number) => (n >= 1000 ? `$${n / 1000}K+` : `$${n}+`);

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return narrow;
}

/** the entities files of the chosen markets (module-cached by useEntities) */
function useEntityFiles(markets: Market[]): Map<Market, LoadedEntities> {
  const [files, setFiles] = useState<Map<Market, LoadedEntities>>(() => new Map());
  const key = markets.join(',');
  useEffect(() => {
    let live = true;
    for (const m of markets) {
      if (files.has(m)) continue;
      void loadEntities(m).then(f => {
        if (!live || !f) return;
        setFiles(prev => (prev.has(m) ? prev : new Map(prev).set(m, f)));
      });
    }
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return files;
}

function Face({ o }: { o: QsOption }) {
  const [dead, setDead] = useState(false);
  const src = o.face && !dead ? sizedImg(httpsImg(o.face), 88) : null;
  if (!src) return <ArtistAvatar label={o.label} size={22} />;
  return (
    <span className="ray-avatar" aria-hidden="true" style={{ width: 22, height: 22, overflow: 'hidden', alignSelf: 'center' }}>
      <img src={src} alt="" width={22} height={22} loading="lazy" decoding="async" referrerPolicy="no-referrer"
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} onError={() => setDead(true)} />
    </span>
  );
}

function PickChip({ o, on, onToggle, face = true }: { o: QsOption; on: boolean; onToggle: (f: Follow) => void; face?: boolean }) {
  return (
    <button
      type="button"
      className="ray-toolbar-pill"
      data-active={on}
      aria-pressed={on}
      aria-label={`${o.label}${o.live ? `, ${o.live} live ${o.live === 1 ? 'lot' : 'lots'}` : ''}`}
      onClick={() => onToggle(o.follow)}
      style={{ alignItems: 'center', gap: 8, paddingLeft: face ? 6 : undefined }}
    >
      {face && <Face o={o} />}
      {o.label}
      {o.live > 0 && <i aria-hidden="true">{o.live}</i>}
    </button>
  );
}

export interface QuickStartProps {
  /** the loaded book (the live lots are cut from it) */
  book: readonly AuctionLot[];
  /** 'cold' = nothing to go on yet (the prompt); 'edit' = "Edit interests" */
  mode: 'cold' | 'edit';
  /** finished or dismissed (edit mode closes; cold mode unmounts once the
   *  follows land and the taste has seeds) */
  onClose?: () => void;
  /** where it sits — only changes the lead sentence */
  surface?: 'profile' | 'home';
}

export default function QuickStart({ book, mode, onClose, surface = 'profile' }: QuickStartProps) {
  const narrow = useNarrow();
  const [sheetOpen, setSheetOpen] = useState(mode === 'edit');
  const opener = useRef<HTMLElement | null>(null);
  const lead = surface === 'home'
    ? 'Tell lectr what you collect and For you fills with live lots tied to it — no account needed.'
    : 'Nothing to go on yet, so nothing is picked. Tell lectr what you collect and lots tied to it land here — no account needed.';

  const close = () => { setSheetOpen(false); onClose?.(); opener.current?.focus(); };

  if (narrow) {
    return (
      <>
        {mode === 'cold' && (
          <div style={{ margin: '10px 0 0' }}>
            <p style={{ fontSize: 13.5, color: 'var(--color-text-muted)', margin: '0 0 12px', lineHeight: 1.55 }}>{lead}</p>
            <button type="button" className="ray-call-btn ray-call-btn-primary" aria-haspopup="dialog"
              onClick={e => { opener.current = e.currentTarget; setSheetOpen(true); }}>
              What do you collect?
            </button>
          </div>
        )}
        {sheetOpen && <QsSheet book={book} onClose={close} />}
      </>
    );
  }
  return (
    <div style={{ marginTop: mode === 'cold' ? 10 : 0 }}>
      {mode === 'cold' && <p style={{ fontSize: 13.5, color: 'var(--color-text-muted)', margin: '0 0 4px', maxWidth: 640, lineHeight: 1.55 }}>{lead}</p>}
      <QsBody book={book} onDone={() => onClose?.()} onCancel={mode === 'edit' ? () => onClose?.() : undefined} />
    </div>
  );
}

/** the phone's bottom sheet around the same body */
function QsSheet({ book, onClose }: { book: readonly AuctionLot[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  useDialogFocus(true, ref, { initial: 'container' });
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = prev; };
  }, [onClose]);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="ray-feedsheet-scrim" role="presentation" onClick={onClose}>
      <style dangerouslySetInnerHTML={{ __html: FEEDSHEET_CSS }} />
      <div ref={ref} className="ray-feedsheet" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        onClick={e => e.stopPropagation()}>
        <div className="ray-feedsheet-grip" aria-hidden="true" />
        <QsBody book={book} sheet titleId={titleId} onDone={onClose} onCancel={onClose} />
      </div>
    </div>,
    document.body,
  );
}

function QsBody({ book, sheet = false, titleId, onDone, onCancel }: {
  book: readonly AuctionLot[]; sheet?: boolean; titleId?: string; onDone: () => void; onCancel?: () => void;
}) {
  const { follows, applyMany, ready } = useFollows();
  const stored = useInterests();
  const [s, dispatch] = useReducer(qsReduce, undefined, () => initQs([], { markets: [], minUsd: null, maxUsd: null }));
  // seed from what the reader already has, once both stores have answered
  // (their device reads land one render after mount)
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const seeded = useRef(false);
  const initial = useRef<Follow[]>([]);
  useEffect(() => {
    if (seeded.current || !mounted || !ready) return;
    seeded.current = true;
    const st = initQs(follows, stored);
    initial.current = st.picked;
    dispatch({ t: 'reset', s: st });
  }, [mounted, ready, follows, stored]);

  // the block, cut once per book
  const pool = useMemo(() => {
    const today = localToday(), now = Date.now();
    return book.filter(l => l.status === 'upcoming' && isOnBlock(l, today, now));
  }, [book]);
  const liveByMarket = useMemo(() => {
    const m = new Map<Market, AuctionLot[]>();
    for (const q of QS_MARKETS) m.set(q.key, marketLots(pool, q.key));
    return m;
  }, [pool]);

  const files = useEntityFiles(s.markets);
  const summaries = useMemo(() => {
    const m = new Map<string, { label: string; face: string | null }>();
    files.forEach(f => { for (const e of f.entities) m.set(e.id, { label: e.label, face: e.face }); });
    return m;
  }, [files]);

  // per chosen market: its top live names + popular categories (only while
  // the names step can show them — the live join reads every lot's subject)
  const options = useMemo(() => {
    if (s.step === 'markets') return [];
    return s.markets.map(m => {
      const lots = liveByMarket.get(m) ?? [];
      return { m, names: topNames(lots, m, id => summaries.get(id), 16), cats: topCats(lots, 6) };
    });
  }, [s.step, s.markets, liveByMarket, summaries]);
  const { liveOf, faceOf } = useMemo(() => {
    const m = new Map<string, QsOption>();
    for (const o of options) for (const x of [...o.names, ...o.cats]) m.set(x.id, x);
    return { liveOf: (id: string) => m.get(id)?.live ?? 0, faceOf: (id: string) => m.get(id)?.face ?? null };
  }, [options]);

  const [q, setQ] = useState('');
  const results = useMemo(() => {
    if (q.trim().length < 2) return [];
    const entries: { id: string; label: string; face: string | null }[] = [];
    files.forEach((f, m) => { if (s.markets.includes(m)) for (const e of f.entities) entries.push({ id: e.id, label: e.label, face: e.face || faceOf(e.id) }); });
    return searchNames(q, entries, liveOf, 8);
  }, [q, files, s.markets, liveOf, faceOf]);

  // every option the reader has seen this pass (a follow only drops when
  // it was on screen and un-tapped)
  const seen = useRef<Follow[]>([]);
  useEffect(() => {
    const add = (f: Follow) => { if (!seen.current.some(x => sameFollow(x, f))) seen.current.push(f); };
    for (const o of options) for (const x of [...o.names, ...o.cats]) add(x.follow);
    for (const r of results) add(r.follow);
  }, [options, results]);

  const isPicked = (f: Follow) => s.picked.some(p => sameFollow(p, f));
  const pick = (f: Follow) => dispatch({ t: 'pick', f });
  // picks that are on no list shown (an earlier follow, a search pick) stay
  // visible — and un-tappable — at the top
  const shownIds = new Set<string>();
  for (const o of options) for (const x of [...o.names, ...o.cats]) shownIds.add(`${x.follow.kind}:${x.follow.key}`);
  const extra = s.picked.filter(p => !shownIds.has(`${p.kind}:${p.key}`));

  const [busy, setBusy] = useState(false);
  const finish = async () => {
    if (!s.picked.length || busy) return;
    setBusy(true);
    try {
      const offered = [...seen.current, ...initial.current];
      await applyMany(followsDiff(follows.filter(f => f.kind !== 'house'), s.picked, offered));
      writeInterests({ markets: s.markets, minUsd: s.minUsd, maxUsd: s.maxUsd, at: new Date().toISOString() });
    } finally { setBusy(false); }
    onDone();
  };

  const n = s.picked.length;
  const headId = useId();
  const body = (
    <>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px 14px', flexWrap: 'wrap' }}>
        <div id={titleId ?? headId} className="ray-feedsheet-head" style={{ paddingBottom: 6 }}>What do you collect?</div>
        <nav aria-label="Quick start steps" style={{ display: 'flex', gap: 2 }}>
          {QS_STEPS.map((st, i) => (
            <button key={st} type="button" className="ray-toolbar-reset" aria-current={s.step === st ? 'step' : undefined}
              onClick={() => dispatch({ t: 'go', step: st })}
              style={{ padding: '4px 6px', fontSize: 12.5, color: s.step === st ? 'var(--color-fg)' : 'var(--color-text-faint)' }}>
              {i > 0 && <span aria-hidden="true" style={{ marginRight: 8, color: 'var(--color-text-faint)' }}>·</span>}
              {STEP_LABEL[st]}{st === 'price' ? ' (optional)' : ''}
            </button>
          ))}
        </nav>
      </div>

      {s.step === 'markets' && (
        <div role="group" aria-label="Markets you collect">
          <p style={{ fontSize: 13.5, color: 'var(--color-text-muted)', margin: '2px 0 12px' }}>Pick one or more markets.</p>
          <div className="ray-feedsheet-chips">
            {QS_MARKETS.map(m => {
              const on = s.markets.includes(m.key);
              const live = liveByMarket.get(m.key)?.length ?? 0;
              return (
                <button key={m.key} type="button" className="ray-toolbar-pill" data-active={on} aria-pressed={on}
                  aria-label={`${m.label}, ${live.toLocaleString()} live lots`} onClick={() => dispatch({ t: 'market', m: m.key })}>
                  {m.label} <i aria-hidden="true">{live.toLocaleString()}</i>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {s.step === 'names' && (
        <div>
          <p style={{ fontSize: 13.5, color: 'var(--color-text-muted)', margin: '2px 0 12px' }}>
            Tap the names you collect — the most lots on the block first. Each one becomes a follow.
          </p>
          <div className="ray-toolbar-search" style={{ marginBottom: 14 }}>
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" /><path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
            <input type="search" value={q} onChange={e => setQ(e.target.value)}
              placeholder="Add any name — a player, maker, Pokémon, film…" aria-label="Search for a name to follow"
              autoComplete="off" spellCheck={false} />
          </div>
          {q.trim().length >= 2 && (
            <div role="group" aria-label="Search results" style={{ marginBottom: 6 }}>
              <div className="ray-feedsheet-chips" aria-live="polite">
                {results.length
                  ? results.map(o => <PickChip key={o.id} o={o} on={isPicked(o.follow)} onToggle={pick} face={!o.id.startsWith('cs:')} />)
                  : <span style={{ fontSize: 13.5, color: 'var(--color-text-muted)' }}>No name in {s.markets.length === 1 ? 'this market' : 'these markets'} matches “{q.trim()}”.</span>}
              </div>
            </div>
          )}
          {extra.length > 0 && (
            <div role="group" aria-label="Already picked">
              <div className="ray-feedsheet-head">Picked</div>
              <div className="ray-feedsheet-chips">
                {extra.map(f => (
                  <button key={`${f.kind}:${f.key}`} type="button" className="ray-toolbar-pill" data-active aria-pressed onClick={() => pick(f)}>
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {options.map(({ m, names, cats }) => {
            const label = QS_MARKETS.find(x => x.key === m)?.label ?? m;
            return (
              <div key={m} role="group" aria-label={`${label} names`}>
                <div className="ray-feedsheet-head">{label}</div>
                {names.length === 0 && cats.length === 0 ? (
                  <p style={{ fontSize: 13.5, color: 'var(--color-text-muted)', margin: 0 }}>Nothing from {label} is on the block right now — search a name above.</p>
                ) : (
                  <div className="ray-feedsheet-chips">
                    {names.map(o => <PickChip key={o.id} o={o} on={isPicked(o.follow)} onToggle={pick} />)}
                    {cats.map(o => <PickChip key={o.id} o={o} on={isPicked(o.follow)} onToggle={pick} face={false} />)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {s.step === 'price' && (
        <div>
          <p style={{ fontSize: 13.5, color: 'var(--color-text-muted)', margin: '2px 0 4px' }}>
            Only see picks in a price range — by the lot&rsquo;s estimate, else its projected hammer or value read (the feed&rsquo;s value filter). Skip it for every price.
          </p>
          <div className="ray-feedsheet-head">At least</div>
          <div className="ray-feedsheet-chips" role="group" aria-label="Lowest price">
            <button type="button" className="ray-toolbar-pill" data-active={s.minUsd == null} aria-pressed={s.minUsd == null} onClick={() => dispatch({ t: 'min', usd: null })}>Any</button>
            {VALUE_FLOORS.map(v => (
              <button key={v} type="button" className="ray-toolbar-pill" data-active={s.minUsd === v} aria-pressed={s.minUsd === v}
                onClick={() => dispatch({ t: 'min', usd: s.minUsd === v ? null : v })}>{fmtFloor(v)}</button>
            ))}
          </div>
          <div className="ray-feedsheet-head">Up to</div>
          <div className="ray-feedsheet-chips" role="group" aria-label="Highest price">
            <button type="button" className="ray-toolbar-pill" data-active={s.maxUsd == null} aria-pressed={s.maxUsd == null} onClick={() => dispatch({ t: 'max', usd: null })}>Any</button>
            {VALUE_CEILINGS.map(v => (
              <button key={v} type="button" className="ray-toolbar-pill" data-active={s.maxUsd === v} aria-pressed={s.maxUsd === v}
                disabled={s.minUsd != null && v <= s.minUsd}
                onClick={() => dispatch({ t: 'max', usd: s.maxUsd === v ? null : v })}>{fmtCeiling(v)}</button>
            ))}
          </div>
        </div>
      )}
    </>
  );

  const primary = s.step === 'markets'
    ? <button type="button" className={sheet ? 'ray-feedsheet-done' : 'ray-call-btn ray-call-btn-primary'} disabled={!canAdvance(s)}
        onClick={() => dispatch({ t: 'next' })} style={!canAdvance(s) ? { opacity: 0.45, cursor: 'default' } : undefined}>
        Next
      </button>
    : <button type="button" className={sheet ? 'ray-feedsheet-done' : 'ray-call-btn ray-call-btn-primary'} disabled={!n || busy}
        onClick={finish} style={!n ? { opacity: 0.45, cursor: 'default' } : undefined}>
        {busy ? 'Saving…' : n ? `Show my picks (${n})` : 'Pick a name first'}
      </button>;
  const secondary = (
    <>
      {s.step !== 'markets' && (
        <button type="button" className={sheet ? 'ray-feedsheet-clear' : 'ray-toolbar-reset'} onClick={() => dispatch({ t: 'back' })}>Back</button>
      )}
      {s.step === 'names' && (
        <button type="button" className={sheet ? 'ray-feedsheet-clear' : 'ray-toolbar-reset'} disabled={!n} onClick={() => dispatch({ t: 'next' })}>{sheet ? 'Price range' : 'Set a price range'}</button>
      )}
      {onCancel && s.step === 'markets' && (
        <button type="button" className={sheet ? 'ray-feedsheet-clear' : 'ray-toolbar-reset'} onClick={onCancel}>Cancel</button>
      )}
    </>
  );

  if (sheet) {
    return (
      <>
        <div className="ray-feedsheet-body">{body}</div>
        <div className="ray-feedsheet-foot">{secondary}{primary}</div>
      </>
    );
  }
  return (
    <section aria-labelledby={headId}>
      <style dangerouslySetInnerHTML={{ __html: FEEDSHEET_CSS }} />
      {body}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginTop: 18 }}>
        {primary}
        {secondary}
        {onCancel && s.step !== 'markets' && <button type="button" className="ray-toolbar-reset" onClick={onCancel}>Cancel</button>}
      </div>
    </section>
  );
}
