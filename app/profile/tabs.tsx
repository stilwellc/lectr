'use client';
/**
 * THE DESK TABS (Oct 20 2026) — the sticky bar that replaced the 14-pill
 * rail, and the one piece of state that decides which rooms mount.
 *
 *   - eight tabs (desk/sections TABS — one job each); the active one comes from the address
 *     bar's hash first (#budget → Watching, #settled → Collection, #tab-record
 *     → Record), then this tab session's last tab, then the desk's default
 *     (Today, or For you when Today has nothing to say)
 *   - a tab writes its OWN hash (#tab-watching) — never a room id, so a
 *     reload opens the tab at its top instead of landing on a room
 *   - any jump() to a room under another tab (a g-chord, a link, the cold
 *     index) fires OPEN_TAB_EVENT; the desk switches tab and the jump lands
 *     once the room mounts (rail.tsx). Plain <a href="#room"> links anywhere
 *     on the desk are routed through jump() too (one delegated listener)
 *   - the sticky bar's real height is measured into --dt-h, so every landing
 *     and every sticky ledger head sits just under it, at every width
 *   - inside a tab with more than one room, a row of room links (NOT sticky:
 *     on a phone the sticky chrome stays one tab grid tall)
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { JUMP_EVENT, OPEN_TAB_EVENT, jump, type RailItem } from './rail';
import { TABS, tabOf, tabHash, type DeskTab, type TabItem } from './desk/sections';

const TAB_KEY = 'lectr-desk-tab';

function hashTab(): DeskTab | null {
  try { return tabOf(decodeURIComponent(window.location.hash.slice(1))); } catch { return null; }
}

function initialTab(fallback: DeskTab | null): DeskTab | null {
  if (typeof window === 'undefined') return fallback;
  const h = hashTab();
  if (h) return h;
  try {
    const t = window.sessionStorage.getItem(TAB_KEY) as DeskTab | null;
    if (t && TABS.some(x => x.id === t)) return t;
  } catch { /* storage blocked */ }
  return fallback;
}

/** the active tab: hash-led, kept for the tab session, switched by any jump.
 *  `fallback` (Today, or For you when Today has nothing) depends on data that
 *  lands after the first paint (the return loop), so it is NOT read once at
 *  mount: the tab is `explicit ?? fallback` until the desk is ready to land,
 *  then the fallback is frozen (it never flips under a reader). The desk
 *  renders client-side only, so reading the hash in the initializer is
 *  hydration-safe. */
const remember = (t: DeskTab) => { try { window.sessionStorage.setItem(TAB_KEY, t); } catch { /* storage blocked */ } };

export function useDeskTab(fallback: DeskTab, ready: boolean): [DeskTab, (t: DeskTab) => void] {
  const [explicit, setExplicit] = useState<DeskTab | null>(() => initialTab(null));
  // freeze the fallback once the desk is ready to land — adjusted during render
  // (React's sanctioned pattern), so there is no extra commit and no flip later
  if (ready && explicit == null) setExplicit(fallback);
  const tab = explicit ?? fallback;
  const setTab = useCallback((t: DeskTab) => {
    setExplicit(t);
    remember(t);
    try { window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}#${tabHash(t)}`); } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    const onOpen = (e: Event) => {
      const t = tabOf((e as CustomEvent<{ id: string }>).detail?.id);
      if (t) { setExplicit(t); remember(t); }   // the jump writes the room's own hash
    };
    const onHash = () => {
      let id = '';
      try { id = decodeURIComponent(window.location.hash.slice(1)); } catch { /* ignore */ }
      const t = tabOf(id);
      if (!t) return;
      setExplicit(t); remember(t);
      if (!id.startsWith('tab-')) jump(id);            // a room's hash: land on it
    };
    // every in-page #room link on the desk: route through jump() so a room
    // under another tab opens its tab and lands (the browser's own fragment
    // scroll fires before the room exists)
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('.ck-page a[href^="#"]');
      if (!a) return;
      let id = '';
      try { id = decodeURIComponent((a.getAttribute('href') || '').slice(1)); } catch { return; }
      if (!id || id.startsWith('tab-')) return;
      if (document.getElementById(id) || tabOf(id)) { e.preventDefault(); jump(id); }
    };
    window.addEventListener(OPEN_TAB_EVENT, onOpen);
    window.addEventListener('hashchange', onHash);
    document.addEventListener('click', onClick);
    return () => {
      window.removeEventListener(OPEN_TAB_EVENT, onOpen);
      window.removeEventListener('hashchange', onHash);
      document.removeEventListener('click', onClick);
    };
  }, []);
  return [tab, setTab];
}

/** the room under the reading line (or the one just jumped to), for aria-current on the room row */
function useCurrentRoom(ids: string[]): string | null {
  const [cur, setCur] = useState<string | null>(null);
  const key = ids.join('|');
  useEffect(() => {
    let raf = 0;
    const read = () => {
      raf = 0;
      const line = window.innerHeight * 0.34;
      let c: string | null = null;
      for (const id of ids) { const el = document.getElementById(id); if (el && el.getBoundingClientRect().top <= line) c = id; }
      setCur(c ?? ids[0] ?? null);
    };
    const on = () => { if (!raf) raf = requestAnimationFrame(read); };
    const onJump = (e: Event) => { const id = (e as CustomEvent<{ id: string }>).detail?.id; if (id && ids.includes(id)) setCur(id); };
    read();
    window.addEventListener('scroll', on, { passive: true });
    window.addEventListener(JUMP_EVENT, onJump);
    return () => { window.removeEventListener('scroll', on); window.removeEventListener(JUMP_EVENT, onJump); if (raf) cancelAnimationFrame(raf); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return cur;
}

/** a room pill named like its tab says what the room is instead (its head's own words) */
const PILL_NAME: Record<string, string> = { watching: 'On the block', 'for-you': 'Lots you may like', names: 'Names calendar', collection: 'Your collection', record: 'Your record' };

const toneInk = (t?: 'up' | 'down') => (t === 'up' ? 'var(--color-up)' : t === 'down' ? 'var(--color-down-text)' : undefined);

export function DeskTabs({ tabs, active, onPick, help }: {
  tabs: TabItem[];
  active: DeskTab;
  onPick: (t: DeskTab) => void;
  help?: React.ReactNode;
}) {
  const cur = tabs.find(t => t.id === active);
  const rooms: RailItem[] = cur?.items ?? [];
  const here = useCurrentRoom(rooms.map(r => r.id));
  const barRef = useRef<HTMLElement | null>(null);
  // the sticky bar's real height → --dt-h (scroll-margin, sticky heads, the tab-top landing)
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const page = el.closest<HTMLElement>('.ck-page') ?? document.documentElement;
    // the root carries it too: html's scroll-padding keeps Tab / j-k focus out from under the sticky chrome (WCAG 2.4.11)
    const root = document.documentElement;
    const set = () => { const h = `${Math.round(el.offsetHeight)}px`; page.style.setProperty('--dt-h', h); root.style.setProperty('--dt-h', h); };
    set();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(set) : null;
    ro?.observe(el);
    return () => { ro?.disconnect(); root.style.removeProperty('--dt-h'); };
  }, []);
  const pick = (t: DeskTab) => {
    onPick(t);
    // land at the tab's top, just under the sticky chrome — not wherever the last tab was scrolled to
    requestAnimationFrame(() => {
      const bar = barRef.current;
      // the first thing under the bar: the room links when the tab has them, else the panel
      const panel = (bar?.nextElementSibling as HTMLElement | null) ?? document.getElementById('dt-panel');
      if (!bar || !panel) return;
      const top = parseFloat(getComputedStyle(bar).top) || 64;   // the sticky offset IS the nav's height
      const stick = top + bar.offsetHeight;
      const y = panel.getBoundingClientRect().top + window.scrollY - stick;
      if (window.scrollY > y) window.scrollTo({ top: Math.max(0, y), behavior: 'auto' });
    });
  };
  // ← / → / Home / End walk the tabs when the bar has focus (the WAI tablist pattern)
  const onKey = (e: React.KeyboardEvent) => {
    const k = e.key;
    if (k !== 'ArrowRight' && k !== 'ArrowLeft' && k !== 'Home' && k !== 'End') return;
    e.preventDefault();
    const i = tabs.findIndex(t => t.id === active);
    const n = k === 'Home' ? tabs[0] : k === 'End' ? tabs[tabs.length - 1] : tabs[(i + (k === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    // a transition: holding → through eight tabs never commits every tab's rooms in between
    React.startTransition(() => pick(n.id));
    requestAnimationFrame(() => document.getElementById(`dt-tab-${n.id}`)?.focus());
  };
  return (
    <>
      <nav ref={barRef} id="desk-tabs" className="dt-wrap" aria-label="Your desk">
        <div className="dt-bar rail">
          <div className="dt-tabs" role="tablist" aria-label="Desk tabs" onKeyDown={onKey}>
            {tabs.map(t => (
              <button key={t.id} id={`dt-tab-${t.id}`} type="button" role="tab" className="dt-tab" data-id={t.id}
                aria-selected={t.id === active} aria-controls="dt-panel" tabIndex={t.id === active ? 0 : -1}
                data-empty={t.empty || undefined} onClick={() => pick(t.id)}>
                <span className="dt-tab-label">{t.label}</span>
                {t.count != null && !t.empty && <><span className="sr-only">, </span><b style={{ color: t.id === active ? undefined : toneInk(t.tone) }}>{t.count}</b></>}
                {t.dot && <><i className="dt-dot" aria-hidden="true" /><span className="sr-only">, new matches</span></>}
                {t.news != null && (() => {
                  const what = t.id === 'today' ? 'results to confirm' : t.id === 'watching' ? 'live bids past your max' : 'settled since your last visit';
                  return <span className="dt-news" title={`${t.news} ${what}`}>{t.news}<span className="sr-only"> {what}</span></span>;
                })()}
                {t.empty && <span className="sr-only">, nothing here yet</span>}
              </button>
            ))}
          </div>
          {help && <div className="dt-help">{help}</div>}
        </div>
      </nav>
      {rooms.length > 1 && (
        <div className="dt-rooms rail" role="group" aria-label={`Rooms in ${cur?.label ?? 'this tab'}`}>
          {rooms.map(r => {
            // a room named like its tab says what it is instead ("Watching" under Watching → "On the block")
            const label = r.label === cur?.label ? (PILL_NAME[r.id] ?? r.label) : r.label;
            return (
              <a key={r.id} href={`#${r.id}`} className="dt-room" data-quiet={r.quiet || undefined}
                title={r.quiet ? `${r.hint ? `${r.hint} · ` : ''}nothing here yet` : r.hint}
                aria-current={here === r.id ? 'location' : undefined}
                onClick={e => { e.preventDefault(); jump(r.id); }}>
                {label}
                {r.count != null && !r.quiet && <><span className="sr-only">, </span><b style={{ color: toneInk(r.tone) }}>{r.count}</b></>}
              </a>
            );
          })}
        </div>
      )}
    </>
  );
}
