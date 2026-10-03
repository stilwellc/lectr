'use client';

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useDialogFocus } from './useDialogFocus';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { ARTISTS, ARTIST_LABEL, MARKETS } from '../constants';
import { useMarket, MARKET_PATH } from '../lib/market';
import { useRayData } from '../hooks/useRayData';
import { craftTitle, formatPrice, refLabel } from '../utils';
import { foldText } from '../lib/search-tokens';
import { loadRefList, loadSearchMeta, matchRefs, refHref, searchSold, type RefRow, type SoldHit } from '../lib/search-index';
import ArtistAvatar from './ArtistAvatar';

type Kind = 'section' | 'market' | 'maker' | 'sub' | 'ref' | 'lot' | 'sold';

interface Item {
  label: string;
  hint: string;
  path: string;
  kind: Kind;
}

/** Any surface can open the palette by dispatching this window event —
 *  the nav's search pill and the Terminal's search affordance use it. */
export const OPEN_CK_EVENT = 'lectr:open-ck';

/** what the palette searches — the nav button, the input and its label all
 *  say the same thing (audit Oct 3: the pill said "Find a maker" while the
 *  palette searched lots) */
export const SEARCH_SCOPE = 'makers, references, live lots and sold results';

const GROUP_LABEL: Record<string, string> = {
  ref: 'References',
  nav: 'Makers, markets and pages',
  lot: 'On the block',
  sold: 'Sold',
};
const groupOf = (k: Kind) => (k === 'ref' ? 'ref' : k === 'lot' ? 'lot' : k === 'sold' ? 'sold' : 'nav');

const CK_CSS = `
.ray-ck-item > span:first-child{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ray-ck-hint{flex:none;max-width:48%;overflow:hidden;text-overflow:ellipsis}
.ray-ck-group{padding:12px 14px 4px;font-size:12px;font-weight:500;color:var(--color-text-muted)}
.ray-ck-status{padding:8px 14px 10px;font-size:12px;color:var(--color-text-muted)}
@media (max-width:520px){.ray-ck-item{flex-direction:column;align-items:flex-start;gap:2px}.ray-ck-hint{max-width:100%}}
`;

/** label-match strength: whole label > label prefix > word prefix > anywhere > hint only */
function score(item: Item, words: string[]): number {
  const lab = foldText(item.label);
  const q = words.join(' ');
  if (lab === q) return 100;
  if (lab.startsWith(q)) return 80;
  if (words.every(w => lab.split(/[^a-z0-9]+/).some(t => t.startsWith(w)))) return 60;
  if (words.every(w => lab.includes(w))) return 40;
  return 10;
}

/**
 * CommandK — jump anywhere. ⌘K / Ctrl-K (or the OPEN_CK_EVENT window event)
 * opens a palette over the pages, every tracked maker, the watch reference
 * book, the sub-market dossiers, the live lots, and — from the first
 * keystroke — the sold archive (a sharded title index, app/lib/search-index.ts).
 * Reference numbers parse: '5711', 'Patek 5711', '126720VTNR', 'Rolex 1675'
 * land on the /ref dossier first. Enter opens the top result.
 *
 * Keystrokes typed in the instant between ⌘K and the input mounting are
 * buffered into the query (they used to land on the page and be lost, so a
 * fast "⌘K 5711 ↵" opened the Overview).
 */
export default function CommandK({ upcomingCounts, savedCount = 0 }: { upcomingCounts: Record<string, number>; savedCount?: number }) {
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  useLayoutEffect(() => { openRef.current = open; }, [open]);

  // a browser Back/Forward while the palette is open must not strand it over
  // the destination page (audit-navbugs defect 5)
  useEffect(() => {
    const close = () => setOpen(false);
    window.addEventListener('popstate', close);
    return () => window.removeEventListener('popstate', close);
  }, []);
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { market } = useMarket();
  const homePath = MARKET_PATH[market] || '/';
  const { allLots, market: marketData } = useRayData();
  const upcomingLots = useMemo(() => allLots.filter(l => l.status === 'upcoming' && l.title), [allLots]);

  // the reference book + sold index load when the palette first opens
  const [refs, setRefs] = useState<RefRow[]>([]);
  const [refsReady, setRefsReady] = useState(false);
  useEffect(() => {
    if (!open || refsReady) return;
    let dead = false;
    loadRefList().then(r => { if (!dead) { setRefs(r); setRefsReady(true); } });
    loadSearchMeta();
    return () => { dead = true; };
  }, [open, refsReady]);

  const items = useMemo<Item[]>(() => {
    // "On the block" is scoped to the current lander — the count says only
    // what that feed will actually render.
    const onBlockCount = ARTISTS
      .filter(a => market === 'all' || a.market === market)
      .reduce((s, a) => s + (upcomingCounts[a.slug] || 0), 0);
    const marketLabel = (k: string) => MARKETS.find(m => m.key === k)?.label || k;
    return [
      { label: 'Overview', hint: 'the market', path: homePath, kind: 'section' as const },
      { label: 'Value', hint: 'the value desk — Flags, the Gap, Sleepers', path: '/value', kind: 'section' as const },
      { label: 'Makers', hint: 'the roster, as demand curves', path: '/makers', kind: 'section' as const },
      { label: 'References', hint: 'every watch reference with a dossier', path: '/ref', kind: 'section' as const },
      { label: 'Analytics', hint: 'market-level intelligence', path: '/analytics', kind: 'section' as const },
      { label: 'The record', hint: 'every call graded against its hammer', path: '/receipts', kind: 'section' as const },
      { label: 'Blog', hint: 'quarterly market notes + how we built the engine', path: '/blog', kind: 'section' as const },
      { label: 'How lectr works', hint: 'the engine, for engineers', path: '/about', kind: 'section' as const },
      { label: 'Glossary', hint: 'the desk’s words in plain language', path: '/glossary', kind: 'section' as const },
      // the identity entry sits last among the rooms — same order as the nav bar
      { label: `My profile${savedCount > 0 ? ` · ${savedCount}` : ''}`, hint: 'your watchlist', path: '/profile', kind: 'section' as const },
      {
        label: onBlockCount > 0 ? `On the block · ${onBlockCount}` : 'On the block',
        hint: 'the live feed',
        path: homePath === '/' ? '/#on-the-block' : `${homePath}#on-the-block`,
        kind: 'section' as const,
      },
      ...MARKETS.map(m => ({
        label: m.label,
        hint: m.tagline,
        path: MARKET_PATH[m.key],
        kind: 'market' as const,
      })),
      ...ARTISTS.map(a => ({
        label: a.label,
        hint: upcomingCounts[a.slug]
          ? `${marketLabel(a.market)} · ${upcomingCounts[a.slug]} live ${upcomingCounts[a.slug] === 1 ? 'lot' : 'lots'}`
          : `${marketLabel(a.market)} maker`,
        path: `/makers/${a.slug}`,
        kind: 'maker' as const,
      })),
      // Sub-market dossiers — search-only (browseItems never includes 'sub').
      // The model family IS the entry: "daytona" lands somewhere real.
      ...Object.values(marketData?.drills || {}).flat().map(d => ({
        label: d.label,
        hint: `sub-market · ${marketLabel(d.vertical)} · ${d.lots.toLocaleString()} lots`,
        path: `/sub/${d.slug.replace(':', '/')}`,
        kind: 'sub' as const,
      })),
    ];
  }, [upcomingCounts, savedCount, market, homePath, marketData]);

  // Empty-query BROWSE: sections first, then each live market as a microcap
  // header row followed by its makers. The market row navigates to the lander.
  const browseItems = useMemo<Item[]>(() => {
    const sections = items.filter(i => i.kind === 'section');
    const grouped: Item[] = [];
    for (const m of MARKETS.filter(m => m.live && m.key !== 'all')) {
      const makers = ARTISTS
        .filter(a => a.market === m.key)
        .map(a => items.find(i => i.kind === 'maker' && i.path === `/makers/${a.slug}`))
        .filter(Boolean) as Item[];
      if (!makers.length) continue;
      const marketItem = items.find(i => i.kind === 'market' && i.path === MARKET_PATH[m.key]);
      if (marketItem) grouped.push(marketItem);
      grouped.push(...makers);
    }
    return [...sections, ...grouped];
  }, [items]);

  // ── the sold archive: async, debounced, newest-wins ──
  const [sold, setSold] = useState<{ q: string; hits: SoldHit[] } | null>(null);
  const [soldBusy, setSoldBusy] = useState(false);
  useEffect(() => {
    const needle = q.trim();
    if (!open || needle.length < 2) { setSold(null); setSoldBusy(false); return; }
    let dead = false;
    setSoldBusy(true);
    const t = setTimeout(() => {
      searchSold(q, 6).then(hits => {
        if (dead) return;
        setSold({ q, hits });
        setSoldBusy(false);
      });
    }, 110);
    return () => { dead = true; clearTimeout(t); };
  }, [q, open]);

  const filtered = useMemo(() => {
    const needle = foldText(q.trim());
    if (!needle) return browseItems;
    // Tokenized AND-match, not contiguous substring: "rolex daytona" /
    // "nakashima table" are words that never sit adjacent in a label.
    const words = needle.split(/\s+/);
    const hits = (hay: string) => { const h = foldText(hay); return words.every(w => h.includes(w)); };

    // 1 · references — a typed reference number goes straight to its dossier
    const refItems: Item[] = matchRefs(q, refs, refLabel, 5).map(h => ({
      label: `${ARTIST_LABEL[h.row.maker] || h.row.maker} ${refLabel(h.row.ref)}`,
      hint: `${h.row.n.toLocaleString()} sales · median ${formatPrice(h.row.med)}`,
      path: refHref(h.row),
      kind: 'ref' as const,
    }));
    const exactRef = matchRefs(q, refs, refLabel, 1)[0]?.how === 'exact';

    // 2 · pages, markets, makers, sub-markets — best label match first
    const itemMatches = items
      .filter(i => hits(`${i.label} ${i.hint}`))
      .map((i, n) => ({ i, s: score(i, words), n }))
      .sort((a, b) => b.s - a.s || a.n - b.n)
      .map(x => x.i);

    // 3 · live lots — a collector arrives with a work in mind
    const lotMatches: Item[] = upcomingLots
      .filter(l => hits(`${craftTitle(l.title)} ${ARTIST_LABEL[l.artist] || l.artist}`))
      .slice(0, 6)
      .map(l => ({
        label: craftTitle(l.title),
        hint: `${ARTIST_LABEL[l.artist] || l.artist} · on the block`,
        path: `/lot?id=${encodeURIComponent(l.id)}`,
        kind: 'lot' as const,
      }));

    // 4 · sold — only the answer for THIS query (a stale answer never shows)
    const soldItems: Item[] = sold && sold.q === q
      ? sold.hits.map(h => ({
        label: craftTitle(h.title),
        hint: `${formatPrice(h.price)} · ${h.house} · ${h.date.slice(0, 7)}`,
        path: `/lot?id=${encodeURIComponent(h.id)}`,
        kind: 'sold' as const,
      }))
      : [];

    // a strong page/maker label match outranks a loose reference-name match;
    // a reference NUMBER always leads
    const strongNav = itemMatches.length > 0 && score(itemMatches[0], words) >= 80;
    const head = exactRef || !strongNav ? [...refItems, ...itemMatches.slice(0, 8)] : [...itemMatches.slice(0, 8), ...refItems];
    return [...head, ...lotMatches, ...soldItems];
  }, [items, browseItems, q, upcomingLots, refs, sold]);

  // Searching renders the first 24 — keyboard nav + Enter index into the SAME
  // list. The empty-query browse renders the whole grouped roster.
  const browsing = q.trim() === '';
  const shown = browsing ? filtered : filtered.slice(0, 24);
  const soldPending = !browsing && q.trim().length >= 2 && (soldBusy || !sold || sold.q !== q);

  // Enter pressed before any result exists (the sold index still loading) is
  // held and fires on the first result — never on a stale list.
  const [enterHeld, setEnterHeld] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(o => !o);
        return;
      }
      if (e.key === 'Escape') { setOpen(false); return; }
      // the keystroke buffer: while open, any printable key that did not land
      // in the input (it had not mounted / focused yet) is routed into it
      if (openRef.current && inputRef.current && document.activeElement !== inputRef.current
        && e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setQ(prev => prev + e.key);
        inputRef.current.focus({ preventScroll: true });
      }
    }
    const onOpenEvent = () => setOpen(true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener(OPEN_CK_EVENT, onOpenEvent);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener(OPEN_CK_EVENT, onOpenEvent);
    };
  }, []);

  // Tab stays inside the palette; focus returns to the opener on close
  // (the input takes initial focus itself, below — synchronously, before
  // paint, so the first keystroke after ⌘K already lands in it)
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useDialogFocus(open, dialogRef, { initial: 'none' });
  useLayoutEffect(() => {
    if (open) {
      setQ('');
      setIdx(0);
      setEnterHeld(false);
      inputRef.current?.focus({ preventScroll: true });
    }
  }, [open]);

  useEffect(() => { setIdx(0); }, [q]);

  useEffect(() => {
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [idx]);

  function go(item: Item) {
    setOpen(false);
    router.push(item.path);
  }

  useEffect(() => {
    if (!enterHeld || !refsReady) return;
    if (shown.length) { setEnterHeld(false); go(shown[0]); }
    else if (!soldPending) setEnterHeld(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enterHeld, shown, soldPending, refsReady]);

  if (!open || typeof document === 'undefined') return null;

  // option rows, with a group label wherever the group changes (search only)
  const rows: React.ReactNode[] = [];
  let lastGroup = '';
  shown.forEach((item, i) => {
    const g = groupOf(item.kind);
    if (!browsing && g !== lastGroup) {
      rows.push(<div key={`g-${g}-${i}`} className="ray-ck-group" role="presentation">{GROUP_LABEL[g]}</div>);
      lastGroup = g;
    }
    // browse mode renders each market row as a group header — still a real
    // option (it opens the lander), still in the keyboard order
    const isHeader = browsing && item.kind === 'market';
    rows.push(
      <button
        key={`${item.kind}-${item.label}-${item.path}`}
        id={`ray-ck-opt-${i}`}
        role="option"
        type="button"
        tabIndex={-1}
        aria-selected={i === idx}
        className={isHeader ? 'ray-ck-item kicker' : 'ray-ck-item'}
        data-active={i === idx}
        onMouseEnter={() => setIdx(i)}
        onClick={() => go(item)}
        style={isHeader ? { marginTop: 6 } : undefined}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}>
          {item.kind === 'maker' && <ArtistAvatar label={item.label} size={20} />}
          {item.label}
        </span>
        <span className="ray-ck-hint">{item.hint}</span>
      </button>,
    );
  });

  return createPortal(
    <div className="ray-ck-overlay" onClick={() => setOpen(false)} role="presentation">
      <style href="ray-ck-extra" precedence="default">{CK_CSS}</style>
      <div
        ref={dialogRef}
        className="ray-ck"
        role="dialog"
        aria-modal="true"
        aria-label="Search lectr"
        style={{ fontVariantNumeric: 'tabular-nums' }}
        onClick={e => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          autoFocus
          className="ray-ck-input"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search a maker, a reference (5711), a live or sold lot…"
          aria-label={`Search ${SEARCH_SCOPE}`}
          role="combobox"
          aria-expanded="true"
          aria-autocomplete="list"
          aria-controls="ray-ck-listbox"
          aria-activedescendant={shown[idx] ? `ray-ck-opt-${idx}` : undefined}
          autoComplete="off"
          spellCheck={false}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(i + 1, shown.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)); }
            else if (e.key === 'Enter') {
              e.preventDefault();
              // the reference book decides what a number like '5711' means —
              // until it has loaded, hold the Enter rather than guess
              if (!refsReady && !browsing) setEnterHeld(true);
              else if (shown[idx]) go(shown[idx]);
              else if (soldPending) setEnterHeld(true);
            }
          }}
        />
        <div className="ray-ck-list" role="listbox" id="ray-ck-listbox" aria-label="Results" ref={listRef}>
          {rows}
          {!browsing && soldPending && (
            <div className="ray-ck-status" role="status">Searching the sold archive&hellip;</div>
          )}
          {!browsing && !soldPending && shown.length === 0 && (
            <div className="ray-ck-empty" role="status">Nothing matches &ldquo;{q.trim()}&rdquo; in {SEARCH_SCOPE}.</div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
