'use client';
/**
 * THE SECTION BAR (THE DESK v4, Oct 29 2026) — the slim sticky row that
 * takes over from the cockpit once it has scrolled off (the Robinhood
 * detail-page bar): one line of the groups with their figures — Today ·
 * Watching 8 · For you 24 · Week 31 · Record +44% · Collection 2 · Names 6 ·
 * More — the group under the reading line underlined, each a jump() to the
 * group's first room (its fold opens on landing, fold.tsx). While the
 * cockpit is on screen the bar stays under the nav (an IntersectionObserver
 * on the cockpit): at the top of the page the cockpit IS the bar. Phone:
 * one scrolling row, 44px tall, the current group kept in view.
 *
 * Its real height is measured into --dt-h on .ck-page (and the root, whose
 * scroll-padding keeps Tab / j-k focus out from under the chrome) while it
 * shows and 0 while it hides, so every landing and every sticky ledger head
 * sits just under it — the way the tab bar did (tabs.tsx, Oct 20, retired).
 * The desk's in-page #room links route through jump() here too (one
 * delegated listener, lifted from tabs.tsx): the browser's own fragment
 * scroll can't open a fold.
 */
import React, { useEffect, useRef, useState } from 'react';
import { JUMP_EVENT, jump } from '../rail';
import { tabOf } from './sections';

export interface BarItem {
  /** the group (a DeskTab id, or 'more' for the closed rooms) — the band's data-group */
  id: string;
  label: string;
  /** the group's figure (its namesake room's count: 8 watches, +44%) */
  count?: React.ReactNode;
  /** signed ink for a measured delta (lamp law: only a real sign) */
  tone?: 'up' | 'down';
  /** where the tap lands: the group's first room (or the More band) */
  target: string;
}

const toneInk = (t?: 'up' | 'down') => (t === 'up' ? 'var(--color-up)' : t === 'down' ? 'var(--color-down-text)' : undefined);

/** the nav's real height — the bar hangs under it */
const navHeight = () => document.querySelector<HTMLElement>('.ray-artist-nav')?.offsetHeight ?? 64;
/** (pass 7) the desk has ended: its foot band (Account) has scrolled off above
 *  the nav — the bar has nothing left to point at and stands down over the
 *  site footer (it used to ride over "Every estimate, read against every hammer.") */
const pastDesk = () => { const foot = document.querySelector<HTMLElement>('.dt-band-foot'); return !!foot && foot.getBoundingClientRect().bottom <= navHeight(); };

export function SectionBar({ items }: { items: BarItem[] }) {
  const ref = useRef<HTMLElement | null>(null);
  const [show, setShow] = useState(false);
  const [cur, setCur] = useState<string | null>(null);
  // the groups whose band has a height (a band that rendered nothing is hidden — no item for it)
  const [live, setLive] = useState<ReadonlySet<string> | null>(null);
  // the ink under the current item: left / width, so it slides between items
  const [ink, setInk] = useState<{ left: number; width: number } | null>(null);
  const key = items.map(t => t.id).join('|');

  // shown once the cockpit has scrolled off under the nav; hidden while any of it is on screen
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.top = `${navHeight()}px`;
    const cockpit = document.querySelector<HTMLElement>('.ck-cockpit') ?? document.querySelector<HTMLElement>('.dt-head');
    if (!cockpit || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      ([e]) => setShow(!e.isIntersecting && e.boundingClientRect.top < 0 && !pastDesk()),
      { rootMargin: `-${navHeight()}px 0px 0px 0px`, threshold: 0 },
    );
    io.observe(cockpit);
    return () => io.disconnect();
  }, [key]);

  // the bar's real height → --dt-h while it shows, 0 while it hides (scroll-margin, sticky ledger heads)
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const page = el.closest<HTMLElement>('.ck-page') ?? document.documentElement;
    const root = document.documentElement;
    const set = () => {
      const h = show ? `${Math.round(el.offsetHeight)}px` : '0px';
      page.style.setProperty('--dt-h', h); root.style.setProperty('--dt-h', h);
    };
    set();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(set) : null;
    ro?.observe(el);
    return () => { ro?.disconnect(); root.style.removeProperty('--dt-h'); page.style.removeProperty('--dt-h'); };
  }, [show]);

  // a jump names the current group at once; the scroll read stands down while
  // the smooth scroll travels (else it drags the ink back through every band on the way)
  const hold = useRef(0);
  // the group under the reading line (the last band whose top has passed the chrome), or the one just jumped to
  useEffect(() => {
    let raf = 0;
    const read = () => {
      raf = 0;
      const bar = ref.current;
      // the scroll fallback for the observer: the cockpit back on screen hides
      // the bar, the cockpit gone above shows it — on every browser, every scroll
      const cockpit = document.querySelector<HTMLElement>('.ck-cockpit');
      if (cockpit) {
        const r = cockpit.getBoundingClientRect();
        if (r.bottom > navHeight() || pastDesk()) setShow(false); else if (r.top < 0) setShow(true);
      }
      const line = navHeight() + (show && bar ? bar.offsetHeight : 0) + 24;
      let c: string | null = null, last = -Infinity;
      const seen = new Set<string>();
      // bands and the pair's columns alike; two columns sharing a top keep the first
      for (const band of Array.from(document.querySelectorAll<HTMLElement>('#dt-panel [data-group]'))) {
        const r = band.getBoundingClientRect();
        if (r.height <= 0) continue;
        seen.add(band.dataset.group ?? '');
        if (r.top <= line && r.top > last) { c = band.dataset.group ?? null; last = r.top; }
      }
      setLive(prev => (prev && prev.size === seen.size && Array.from(seen).every(g => prev.has(g)) ? prev : seen));
      if (Date.now() < hold.current) return;
      setCur(c ?? items.find(t => seen.has(t.id))?.id ?? null);
    };
    const on = () => { if (!raf) raf = requestAnimationFrame(read); };
    const onJump = (e: Event) => {
      const id = (e as CustomEvent<{ id: string }>).detail?.id;
      if (!id) return;
      // (pass 5) a landing below the cockpit shows the bar NOW and writes its
      // height, synchronously — the jump's re-anchor (rail.tsx settleOn) reads
      // the scroll-margin right after this event, and a bar that appeared a
      // frame later left the room's head 44px under it
      const el = document.getElementById(id);
      const bar = ref.current;
      if (el && bar && !el.closest('.dt-head')) {
        const h = `${Math.round(bar.offsetHeight)}px`;
        (bar.closest<HTMLElement>('.ck-page') ?? document.documentElement).style.setProperty('--dt-h', h);
        document.documentElement.style.setProperty('--dt-h', h);
        setShow(true);
      }
      // the band that holds the landing (a room, an anchor in one, the More band itself)
      const band = el?.closest<HTMLElement>('[data-group]');
      const g = band?.dataset.group ?? tabOf(id);
      if (g && items.some(t => t.id === g)) { setCur(g); hold.current = Date.now() + 900; }
    };
    read();
    window.addEventListener('scroll', on, { passive: true });
    window.addEventListener('resize', on);
    window.addEventListener(JUMP_EVENT, onJump);
    return () => {
      window.removeEventListener('scroll', on); window.removeEventListener('resize', on); window.removeEventListener(JUMP_EVENT, onJump);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [key, show]); // eslint-disable-line react-hooks/exhaustive-deps

  // the ink slides to the current item (left / width measured from its pill)
  useEffect(() => {
    const bar = ref.current;
    const pill = cur ? bar?.querySelector<HTMLElement>(`.dk-sbar-item[data-id="${cur}"]`) : null;
    if (!pill) { setInk(null); return; }
    const set = () => setInk({ left: pill.offsetLeft + 12, width: Math.max(0, pill.offsetWidth - 24) });
    set();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(set) : null;
    ro?.observe(pill);
    return () => ro?.disconnect();
  }, [cur, live, show]);

  // phone: the current group centres in the scrolling row whenever it changes
  useEffect(() => {
    const bar = ref.current;
    if (!bar || !show || !cur) return;
    const pill = bar.querySelector<HTMLElement>(`.dk-sbar-item[data-id="${cur}"]`);
    const row = pill?.parentElement;
    if (!pill || !row || row.scrollWidth <= row.clientWidth) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const left = pill.offsetLeft - (row.clientWidth - pill.offsetWidth) / 2;
    row.scrollTo({ left: Math.max(0, Math.min(left, row.scrollWidth - row.clientWidth)), behavior: reduce ? 'auto' : 'smooth' });
  }, [cur, show]);

  // every in-page #room link on the desk: through jump(), so a folded or
  // closed room opens and the landing sits under the chrome (a fragment
  // scroll fires before a closed room exists)
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('.ck-page a[href^="#"]');
      if (!a) return;
      let id = '';
      try { id = decodeURIComponent((a.getAttribute('href') || '').slice(1)); } catch { return; }
      // a tab hash (#tab-watching) lands through the page's own hashchange
      if (!id || id.startsWith('tab-')) return;
      if (document.getElementById(id) || tabOf(id)) { e.preventDefault(); jump(id); }
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  // ← / → / Home / End walk the items when the bar has focus (the tablist
  // pattern the old tab bar kept): the focus moves and the desk lands there
  const shown = live ? items.filter(t => live.has(t.id)) : items;
  const onKey = (e: React.KeyboardEvent) => {
    const k = e.key;
    if (k !== 'ArrowRight' && k !== 'ArrowLeft' && k !== 'Home' && k !== 'End') return;
    if (!shown.length) return;
    e.preventDefault();
    const at = Math.max(0, shown.findIndex(t => t.id === ((document.activeElement as HTMLElement | null)?.dataset.id ?? cur)));
    const n = k === 'Home' ? shown[0] : k === 'End' ? shown[shown.length - 1] : shown[(at + (k === 'ArrowRight' ? 1 : shown.length - 1)) % shown.length];
    ref.current?.querySelector<HTMLElement>(`.dk-sbar-item[data-id="${n.id}"]`)?.focus();
    // the focus stays on the bar (the next arrow must land here too); Enter / a tap still focus the room
    jump(n.target, { focus: false });
  };
  if (!items.length) return null;
  return (
    <nav ref={ref} className="dk-sbar" data-show={show || undefined} inert={!show} aria-label="Sections of your desk">
      <div className="dk-sbar-in rail" onKeyDown={onKey}>
        {shown.map(t => (
          <button key={t.id} type="button" className="dk-sbar-item" data-id={t.id} tabIndex={cur === t.id ? 0 : -1}
            aria-current={cur === t.id ? 'location' : undefined} onClick={() => jump(t.target)}>
            {t.label}
            {t.count != null && <><span className="sr-only">, </span><b style={{ color: cur === t.id ? undefined : toneInk(t.tone) }}>{t.count}</b></>}
          </button>
        ))}
        {ink && <i className="dk-sbar-ink" aria-hidden style={{ left: ink.left, width: ink.width }} />}
      </div>
    </nav>
  );
}
