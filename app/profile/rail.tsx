'use client';
/**
 * THE SECTION RAIL (Oct 11 2026, /profile redesign) — the desk's in-page
 * index: a sticky pill rail under the site nav (top 64, the nav's height)
 * at EVERY width, scrolling sideways on itself — never on a sticky ancestor.
 * (Oct 11 review: the ≥1160px left-gutter index retired — it revived the
 * spine /value dropped on Aug 29, split the site into two navigation
 * grammars, hid its labels below 1400px and broke the focus order. One rail,
 * in reading order, "Today" first when the band renders.)
 *
 * Every item is a real hash link (#for-you, #watching …): it jumps, stamps
 * the hash (replaceState, so Back leaves the page rather than walking
 * sections), and the active item tracks the scroll. Items follow each
 * section's own null gate — the page passes only what renders.
 *
 * (Oct 11 review fixes) LANDING: a jump scrolls, then re-anchors on its
 * target for ~8s while the rooms above it settle (ResizeObserver — Names'
 * sold-history reads, Your week's columns change height after the jump),
 * unless the reader takes the wheel; it focuses the section (tabindex −1)
 * so j/k continues from there, and the pill it came from reads as current
 * at once (pinned) rather than wherever the scroll happened to be. The rail
 * shows a › affordance when pills run off the edge. A PHONE gets one row:
 * the current room's name and a "Sections" sheet listing every room (Account
 * too) — thirteen pills in a 362px scroller was a dead end.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { HelpChip } from './help';
import { FEEDSHEET_CSS } from '../components/FeedToolbar';

export interface RailItem {
  id: string;
  label: string;
  /** the section's mark (kept on the item for any future glyph use) */
  mark?: React.ReactNode;
  /** the figure beside the label (a count, a signed %, a money total) */
  count?: React.ReactNode;
  /** signed ink for a measured delta (lamp law: only a real sign) */
  tone?: 'up' | 'down';
  /** unseen matches waiting (the inbox dot — ink, never a lamp) */
  dot?: boolean;
  /** the page's grouping (now · picks · desk) — a hairline parts the groups */
  group?: string;
  /** the pill's title — the `g`-chord that lands here ("g then w") */
  hint?: string;
  /** the section has nothing to say on this desk: the pill folds (muted,
   *  no count) but stays reachable — the room is mounted and says so */
  quiet?: boolean;
}

/** the jump's own event — the rail pins the pill as current at once */
export const JUMP_EVENT = 'lectr:jump';
/** how long a landing keeps re-anchoring while the rooms above it settle */
export const SETTLE_MS = 8000;
const INTENTS: (keyof WindowEventMap)[] = ['wheel', 'touchstart', 'keydown', 'pointerdown'];

let stopSettle: (() => void) | null = null;

/** keep `el` anchored at the top of the viewport for `ms` while the page
 *  settles around it (lazily-read rooms above change height) — ends at once
 *  when the reader scrolls, swipes, presses a key or taps */
export function settleOn(el: HTMLElement, ms = SETTLE_MS, startAfter = 0): () => void {
  stopSettle?.();
  let done = false;
  let raf = 0;
  let timer = 0;
  let poll = 0;
  let armed = startAfter <= 0;
  const margin = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
  const check = () => {
    raf = 0;
    if (done || !armed) return;
    const top = el.getBoundingClientRect().top - margin;
    if (Math.abs(top) > 2) window.scrollBy({ top, behavior: 'auto' });
  };
  const queue = () => { if (!raf) raf = requestAnimationFrame(check); };
  const stop = () => {
    if (done) return;
    done = true;
    ro?.disconnect();
    window.clearTimeout(timer); window.clearTimeout(arm); window.clearInterval(poll);
    if (raf) cancelAnimationFrame(raf);
    for (const ev of INTENTS) window.removeEventListener(ev, stop);
    if (stopSettle === stop) stopSettle = null;
  };
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(queue) : null;
  ro?.observe(document.body);
  // a smooth scroll is still travelling for a moment — the first check waits for it
  const arm = window.setTimeout(() => { armed = true; queue(); }, startAfter);
  poll = window.setInterval(queue, 250);
  timer = window.setTimeout(stop, ms);
  for (const ev of INTENTS) window.addEventListener(ev, stop, { passive: true });
  stopSettle = stop;
  return stop;
}

/** focus a section without scrolling it again: the room takes tabindex −1
 *  so j/k continues from its first row (keys.ts reads the focus position) */
export function focusSection(el: HTMLElement): void {
  if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
  try { el.focus({ preventScroll: true }); } catch { el.focus(); }
}

/** scroll a section into view and stamp its hash (replaceState — Back
 *  leaves the page rather than walking sections); then hold the landing
 *  while the page settles and focus the section */
export function jump(id: string, opts: { focus?: boolean } = {}) {
  const el = document.getElementById(id);
  if (!el) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  try { window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}#${id}`); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent(JUMP_EVENT, { detail: { id } }));
  if (opts.focus !== false) focusSection(el);
  settleOn(el, SETTLE_MS, reduce ? 0 : 700);
}

function useActive(ids: string[]): string | null {
  const [active, setActive] = useState<string | null>(null);
  const key = ids.join('|');
  useEffect(() => {
    let raf = 0;
    const read = () => {
      raf = 0;
      const bar = window.innerHeight * 0.34;
      let cur: string | null = null;
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= bar) cur = id;
      }
      setActive(cur);
    };
    const on = () => { if (!raf) raf = requestAnimationFrame(read); };
    read();
    window.addEventListener('scroll', on, { passive: true });
    window.addEventListener('resize', on, { passive: true });
    // sections above grow as data lands (picks, the Today band) — re-read
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(on) : null;
    ro?.observe(document.body);
    return () => { window.removeEventListener('scroll', on); window.removeEventListener('resize', on); ro?.disconnect(); if (raf) cancelAnimationFrame(raf); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return active;
}

/** the pill a jump came from reads as current at once — the scroll read
 *  takes over when the reader moves (or after the landing settles) */
function usePinned(): string | null {
  const [pinned, setPinned] = useState<string | null>(null);
  useEffect(() => {
    let t = 0;
    const clear = () => { setPinned(null); window.clearTimeout(t); };
    const onJump = (e: Event) => {
      const id = (e as CustomEvent<{ id: string }>).detail?.id;
      if (!id) return;
      setPinned(id);
      window.clearTimeout(t);
      t = window.setTimeout(clear, SETTLE_MS);
    };
    window.addEventListener(JUMP_EVENT, onJump);
    for (const ev of INTENTS) window.addEventListener(ev, clear, { passive: true });
    return () => { window.removeEventListener(JUMP_EVENT, onJump); for (const ev of INTENTS) window.removeEventListener(ev, clear); window.clearTimeout(t); };
  }, []);
  return pinned;
}

function useMedia(q: string): boolean {
  const [m, setM] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [q]);
  return m;
}

const toneInk = (t?: 'up' | 'down') => (t === 'up' ? 'var(--color-up)' : t === 'down' ? 'var(--color-down-text)' : undefined);

/** the phone's Sections sheet: every room on this desk (Account too), the
 *  current one marked; tap → jump + close. Reuses the feed sheet grammar. */
function SectionsSheet({ items, current, onPick, onClose }: { items: RailItem[]; current: string | null; onPick: (id: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('[aria-current="true"]') ?? ref.current?.querySelector<HTMLElement>('button');
    first?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    document.addEventListener('keydown', onKey);
    const html = document.documentElement;
    const over = html.style.overflow;
    html.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); html.style.overflow = over; prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="ray-feedsheet-scrim ck-rail-scrim" role="presentation" onClick={onClose}>
      <style dangerouslySetInnerHTML={{ __html: FEEDSHEET_CSS }} />
      <div ref={ref} className="ray-feedsheet ck-rail-sheet" role="dialog" aria-modal="true" aria-label="Sections on this page" onClick={e => e.stopPropagation()}>
        <div className="ray-feedsheet-grip" aria-hidden="true" />
        <div className="ray-feedsheet-body">
          <div className="ray-feedsheet-head">Sections</div>
          <div className="ck-rail-sheet-list" role="list">
            {items.map((it, i) => (
              <React.Fragment key={it.id}>
                {i > 0 && it.group && items[i - 1].group && it.group !== items[i - 1].group && <i className="ck-rail-sheet-sep" aria-hidden />}
                <button type="button" role="listitem" className="ck-rail-sheet-row" aria-current={current === it.id ? 'true' : undefined}
                  data-quiet={it.quiet || undefined} onClick={() => onPick(it.id)}>
                  <span>{it.label}</span>
                  {it.count != null && !it.quiet && <b style={{ color: toneInk(it.tone) }}>{it.count}</b>}
                  {it.quiet && <small>nothing here yet</small>}
                  {it.dot && <i className="ck-rail-dot" aria-label="new matches" />}
                </button>
              </React.Fragment>
            ))}
          </div>
          <p className="ck-rail-sheet-note">Tap a section to jump to it — the address bar follows you.</p>
        </div>
        <div className="ray-feedsheet-foot">
          <button type="button" className="ray-feedsheet-done" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

/** the sticky pill rail. Place it as a direct child of the page-long
 *  wrapper so it stays pinned past every section. */
export function PillRail({ items, help, tail = [] }: { items: RailItem[];
  /** the how-to-read strip behind the rail's (?) — the keys legend */
  help?: React.ReactNode;
  /** rooms with no pill that the phone's Sections sheet still lists (Account) */
  tail?: RailItem[] }) {
  const scrolled = useActive(items.map(i => i.id).concat(tail.map(i => i.id)));
  const pinned = usePinned();
  const active = pinned ?? scrolled;
  const phone = useMedia('(max-width: 639.98px)');
  const touch = useMedia('(hover: none) and (pointer: coarse)');
  const [sheet, setSheet] = useState(false);
  const closeSheet = useCallback(() => setSheet(false), []);
  // keep the active pill in view inside the rail's own sideways scroll
  useEffect(() => {
    if (!active) return;
    const pill = document.querySelector<HTMLElement>(`.ck-rail a[data-id="${active}"]`);
    const rail = pill?.parentElement;
    if (!pill || !rail || rail.scrollWidth <= rail.clientWidth) return;
    const l = pill.offsetLeft - rail.offsetLeft, r = l + pill.offsetWidth;
    // near or past either edge (under the fade): bring it to the middle
    if (l < rail.scrollLeft + 32 || r > rail.scrollLeft + rail.clientWidth - 32) {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      rail.scrollTo({ left: Math.max(0, l - (rail.clientWidth - pill.offsetWidth) / 2), behavior: reduce ? 'auto' : 'smooth' });
    }
  }, [active]);
  // the rail scrolls sideways on itself when its pills outrun the width: a
  // soft fade on the side that has more says so (never a cut pill edge), and
  // a › at the edge scrolls the rail a page
  const railRef = useRef<HTMLDivElement | null>(null);
  const [edge, setEdge] = useState<{ l: boolean; r: boolean }>({ l: false, r: false });
  useEffect(() => {
    const el = railRef.current;
    if (!el) return;
    const read = () => {
      const l = el.scrollLeft > 4, r = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
      setEdge(e => (e.l === l && e.r === r ? e : { l, r }));
    };
    read();
    el.addEventListener('scroll', read, { passive: true });
    window.addEventListener('resize', read, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(read) : null;
    ro?.observe(el);
    return () => { el.removeEventListener('scroll', read); window.removeEventListener('resize', read); ro?.disconnect(); };
  }, [items.length, phone]);
  const page = (dir: 1 | -1) => {
    const el = railRef.current;
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollBy({ left: dir * Math.max(120, el.clientWidth * 0.7), behavior: reduce ? 'auto' : 'smooth' });
  };
  if (items.length < 2) return null;
  const all = items.concat(tail);
  const cur = all.find(i => i.id === active) ?? null;

  if (phone) {
    // PHONE: one row — where you are, and the Sections sheet
    return (
      <nav className="ck-rail-wrap" data-phone="" aria-label="Sections on this page">
        <div className="ck-rail-now rail">
          <span className="ck-rail-here" aria-live="polite">
            {cur ? <>{cur.label}{cur.count != null && !cur.quiet && <b style={{ color: toneInk(cur.tone) }}>{cur.count}</b>}</> : 'Your desk'}
          </span>
          <button type="button" className="ck-rail-pill ck-rail-open" aria-haspopup="dialog" aria-expanded={sheet} onClick={() => setSheet(true)}>
            Sections <b>{all.length}</b>
          </button>
        </div>
        {sheet && <SectionsSheet items={all} current={active} onPick={id => { setSheet(false); window.setTimeout(() => jump(id), 30); }} onClose={closeSheet} />}
      </nav>
    );
  }
  return (
    <nav className="ck-rail-wrap" aria-label="Sections on this page">
      {edge.l && <button type="button" className="ck-rail-more" data-dir="l" aria-label="Earlier sections" onClick={() => page(-1)}>‹</button>}
      <div ref={railRef} className="ck-rail rail" data-fade-l={edge.l || undefined} data-fade-r={edge.r || undefined}>
        {items.map((it, i) => (
          <React.Fragment key={it.id}>
          {i > 0 && it.group && items[i - 1].group && it.group !== items[i - 1].group && <i className="ck-rail-sep" aria-hidden />}
          <a href={`#${it.id}`} data-id={it.id} className="ck-rail-pill" aria-current={active === it.id ? 'true' : undefined}
            data-quiet={it.quiet || undefined} title={it.quiet ? `${it.hint ? `${it.hint} · ` : ''}nothing here yet` : it.hint}
            onClick={e => { e.preventDefault(); jump(it.id); }}>
            {it.label}
            {it.count != null && !it.quiet && <b style={{ color: toneInk(it.tone) }}>{it.count}</b>}
            {it.dot && <i className="ck-rail-dot" aria-label="new matches" />}
          </a>
          </React.Fragment>
        ))}
      </div>
      {edge.r && <button type="button" className="ck-rail-more" data-dir="r" aria-label="More sections" onClick={() => page(1)}>›</button>}
      {/* the keys legend rides outside the scroller, so it never scrolls away;
          on a touch device the chord copy means nothing — the chip says what a tap does */}
      {help && (
        <div className="ck-rail-help">
          <HelpChip name="the keys" stripStyle={{ position: 'absolute', left: 0, right: 0, top: '100%', margin: 0 }}>
            {touch ? <>Tap a pill to jump to its room — the address bar follows you. A room this desk doesn&rsquo;t have yet is listed at the end of the page with the tap that fills it.</> : help}
          </HelpChip>
        </div>
      )}
    </nav>
  );
}

/** a deep link (/profile#settled) arrives before its section exists — the
 *  desk renders after the saves resolve — so land on it once it does.
 *  Returns the hash id when it names NO section that exists after the wait
 *  (the page prints the room's fill line under the rail). */
export function useHashLanding(ready: boolean): string | null {
  const done = React.useRef(false);
  const [missing, setMissing] = useState<string | null>(null);
  useEffect(() => {
    if (!ready || done.current) return;
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!id) { done.current = true; return; }
    let tries = 0;
    let stop: (() => void) | null = null;
    const t = window.setInterval(() => {
      const el = document.getElementById(id);
      if (el) {
        done.current = true;
        window.clearInterval(t);
        // after layout settles (images, the Today band) — instant, no animation
        requestAnimationFrame(() => {
          el.scrollIntoView({ block: 'start', behavior: 'auto' });
          focusSection(el);
          window.dispatchEvent(new CustomEvent(JUMP_EVENT, { detail: { id } }));
          // (desk3) the rooms above a deep link keep growing after it lands —
          // Your week's columns, Names' sold-history reads — and the anchor
          // drifts down the screen. Re-land while the page settles (8s), unless
          // the reader has started scrolling.
          stop = settleOn(el);
        });
      } else if (++tries > 40) { done.current = true; window.clearInterval(t); setMissing(id); }
    }, 150);
    return () => { window.clearInterval(t); stop?.(); };
  }, [ready]);
  return missing;
}
