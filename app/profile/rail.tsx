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
 */
import React, { useEffect, useRef, useState } from 'react';
import { HelpChip } from './help';

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
}

/** scroll a section into view and stamp its hash (replaceState — Back
 *  leaves the page rather than walking sections) */
export function jump(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  try { window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}#${id}`); } catch { /* ignore */ }
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

const toneInk = (t?: 'up' | 'down') => (t === 'up' ? 'var(--color-up)' : t === 'down' ? 'var(--color-down-text)' : undefined);

/** the sticky pill rail. Place it as a direct child of the page-long
 *  wrapper so it stays pinned past every section. */
export function PillRail({ items, help }: { items: RailItem[];
  /** the how-to-read strip behind the rail's (?) — the keys legend */
  help?: React.ReactNode }) {
  const active = useActive(items.map(i => i.id));
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
  // soft fade on the side that has more says so (never a cut pill edge)
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
    return () => { el.removeEventListener('scroll', read); window.removeEventListener('resize', read); };
  }, [items.length]);
  if (items.length < 2) return null;
  return (
    <nav className="ck-rail-wrap" aria-label="Sections on this page">
      <div ref={railRef} className="ck-rail rail" data-fade-l={edge.l || undefined} data-fade-r={edge.r || undefined}>
        {items.map((it, i) => (
          <React.Fragment key={it.id}>
          {i > 0 && it.group && items[i - 1].group && it.group !== items[i - 1].group && <i className="ck-rail-sep" aria-hidden />}
          <a href={`#${it.id}`} data-id={it.id} className="ck-rail-pill" aria-current={active === it.id ? 'true' : undefined}
            title={it.hint} onClick={e => { e.preventDefault(); jump(it.id); }}>
            {it.label}
            {it.count != null && <b style={{ color: toneInk(it.tone) }}>{it.count}</b>}
            {it.dot && <i className="ck-rail-dot" aria-label="new matches" />}
          </a>
          </React.Fragment>
        ))}
      </div>
      {/* the keys legend rides outside the scroller, so it never scrolls away */}
      {help && <div className="ck-rail-help"><HelpChip name="the keys" stripStyle={{ position: 'absolute', left: 0, right: 0, top: '100%', margin: 0 }}>{help}</HelpChip></div>}
    </nav>
  );
}

/** a deep link (/profile#settled) arrives before its section exists — the
 *  desk renders after the saves resolve — so land on it once it does */
export function useHashLanding(ready: boolean) {
  const done = React.useRef(false);
  useEffect(() => {
    if (!ready || done.current) return;
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!id) { done.current = true; return; }
    let tries = 0;
    const t = window.setInterval(() => {
      const el = document.getElementById(id);
      if (el) {
        done.current = true;
        window.clearInterval(t);
        // after layout settles (images, the Today band) — instant, no animation
        requestAnimationFrame(() => el.scrollIntoView({ block: 'start', behavior: 'auto' }));
      } else if (++tries > 40) { done.current = true; window.clearInterval(t); }
    }, 150);
    return () => window.clearInterval(t);
  }, [ready]);
}
