'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useDialogFocus } from './useDialogFocus';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { ARTISTS, MARKETS } from '../constants';
import { drillLabelOf } from '../lib/lot-labels';
import { useMarket, MARKET_PATH } from '../lib/market';
import { useRayData } from '../hooks/useRayData';
import { refLabel } from '../utils';
import { loadRefList, searchSoldEx, type RefRow, type SoldResult } from '../lib/search-index';
import {
  buildPaletteIndex, rankPalette, soldQueryOf, categoryItems, warmPaletteLots,
  type PaletteItem, type PaletteEntity, type PaletteSection,
} from '../lib/palette-search';
import ArtistAvatar from './ArtistAvatar';
import { makerHref, retiredTarget } from '../lib/entity/retired';
import { loadEntities } from '../hooks/useEntities';
import { entityIdOf } from '../lib/entity/live';
import { pageHrefOf } from '../lib/entity/kinds';
import { isOnBlock, localToday } from '../utils';
import { recordSignal } from '../lib/recs-signals';

type Item = PaletteItem;

/** the roster makers — every ARTISTS slug that is a real maker page (the
 *  retired pseudo-makers live on as /sub slices and feeds, never as names) */
const MAKERS = ARTISTS.filter(a => !retiredTarget(a.slug));

/** case- and accent-blind text ("Prouve" finds Prouvé) */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/** a name's match tier for a folded query (lower is better; null = no hit):
 *  0 exact · 1 the name (or one of its words) starts with each word ·
 *  2 every word inside the name · 3 only the hint carries the words */
export function nameTier(label: string, hint: string, needle: string): number | null {
  const l = fold(label);
  if (l === needle) return 0;
  const words = needle.split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const lw = l.split(/[^a-z0-9]+/).filter(Boolean);
  if (words.every(w => lw.some(x => x.startsWith(w)))) return 1;
  if (words.every(w => l.includes(w))) return 2;
  const h = `${l} ${fold(hint)}`;
  return words.every(w => h.includes(w)) ? 3 : null;
}

/** the entity kinds the palette names (makers come from ARTISTS; clean
 *  sub-categories from the drills) */
const SUBKIND_NOUN: Record<string, string> = {
  player: 'player', pokemon: 'Pokémon', film: 'film', mission: 'mission', person: 'person',
  team: 'team', brand: 'brand', franchise: 'franchise', band: 'band', set: 'set',
};
interface EntityHit extends PaletteEntity { market: string }

/** Any surface can open the palette by dispatching this window event —
 *  the nav's Find-a-maker pill and the Terminal's search affordance use it. */
export const OPEN_CK_EVENT = 'lectr:open-ck';

/**
 * CommandK — jump anywhere. ⌘K / Ctrl-K (or the OPEN_CK_EVENT window event)
 * opens a palette over sections and every tracked artist (with live-lot
 * counts); type to filter, arrows to move, Enter to go. With an empty query
 * it is a grouped BROWSE — the full maker roster under microcap market
 * headers. Rendered in a portal above everything.
 */
export default function CommandK({ upcomingCounts, savedCount = 0 }: { upcomingCounts: Record<string, number>; savedCount?: number }) {
  const [open, setOpen] = useState(false);

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

  // THE ARCHIVE (Oct 8): the static search index (scripts/emit-search-index)
  // was built but never wired — the palette only searched live lots while
  // promising the corpus. Refs load when the palette opens; sold hits are
  // fetched per keystroke (debounced; shards are module-cached).
  const [refs, setRefs] = useState<RefRow[]>([]);
  // the archive's answer, tagged with the query it answers (a stale answer
  // never renders under a newer query)
  const [sold, setSold] = useState<(SoldResult & { q: string }) | null>(null);
  useEffect(() => { if (open && !refs.length) loadRefList().then(setRefs).catch(() => {}); }, [open, refs.length]);
  // THE NAMES (Oct 10): players, Pokémon, films, missions, sets — the entity
  // summaries (pages/entities-all.json, module-cached by useEntities). Loaded
  // when the palette first opens; a build without the file just has none.
  const [ents, setEnts] = useState<EntityHit[] | null>(null);
  useEffect(() => {
    if (!open || ents) return;
    let on = true;
    loadEntities('all').then(f => {
      if (!on) return;
      const out: EntityHit[] = [];
      for (const e of f?.entities || []) {
        if (e.kind !== 'player' && e.kind !== 'subject' && e.kind !== 'set') continue;
        const noun = SUBKIND_NOUN[e.subKind || e.kind] || e.kind;
        const mk = MARKETS.find(m => m.key === e.market)?.short;
        out.push({
          id: e.id, label: e.label, market: e.market,
          // a player's sport; everyone else their market (a Pokémon's
          // "discipline" is its median's era, not the name's)
          hint: [noun, e.kind === 'player' && e.discipline ? e.discipline : mk].filter(Boolean).join(' · '),
          path: e.page || pageHrefOf(e.id),
          sold: e.sold || 0,
        });
      }
      setEnts(out);
    }).catch(() => { if (on) setEnts([]); });
    return () => { on = false; };
  }, [open, ents]);
  // live lots per entity (the build's ek stamp), counted only while open
  const liveByEntity = useMemo(() => {
    const m = new Map<string, number>();
    if (!open || !ents?.length) return m;
    const today = localToday();
    for (const l of allLots) {
      if (!isOnBlock(l, today)) continue;
      const id = entityIdOf(l);
      if (id) m.set(id, (m.get(id) || 0) + 1);
    }
    return m;
  }, [open, ents, allLots]);


  const items = useMemo<Item[]>(() => {
    // "On the block" is scoped to the current lander — the count says only
    // what that feed will actually render.
    const onBlockCount = ARTISTS
      .filter(a => market === 'all' || a.market === market)
      .reduce((s, a) => s + (upcomingCounts[a.slug] || 0), 0);
    return [
      { label: 'Overview', hint: 'the market', path: homePath, kind: 'section' as const },
      { label: 'Value', hint: 'below-market lots', path: '/value', kind: 'section' as const },
      { label: 'Makers', hint: 'the roster, as demand curves', path: '/makers', kind: 'section' as const },
      { label: 'Analytics', hint: 'market-level intelligence', path: '/analytics', kind: 'section' as const },
      { label: 'Blog', hint: 'quarterly market notes + how we built the engine', path: '/blog', kind: 'section' as const },
      { label: 'How lectr works', hint: 'the engine, for engineers', path: '/about', kind: 'section' as const },
      // the identity entry sits last among the rooms — same order as the nav bar
      { label: `My profile${savedCount > 0 ? ` · ${savedCount}` : ''}`, hint: 'For you · Watching · Signals', path: '/profile', kind: 'section' as const },
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
      ...MAKERS.map(a => ({
        label: a.label,
        hint: upcomingCounts[a.slug]
          ? `${a.market} · ${upcomingCounts[a.slug]} live ${upcomingCounts[a.slug] === 1 ? 'lot' : 'lots'}`
          : `${a.market} maker`,
        path: makerHref(a.slug),
        kind: 'maker' as const,
      })),
      // Sub-market dossiers — search-only (browseItems never includes 'sub',
      // so the curated empty-query index stays as-is). This is what lets a
      // one-word query like "daytona" land somewhere real instead of
      // "Nothing matches": the model family IS the entry.
      ...Object.values(marketData?.drills || {}).flat().map(d => ({
        label: drillLabelOf(d.slug, d.label),
        hint: `sub-market · ${d.vertical} · ${d.lots.toLocaleString()} lots tracked`,
        path: `/sub/${d.slug.replace(':', '/')}`,
        kind: 'sub' as const,
      })),
      // the retired category pages (Meteorites, Graded Cards, Film & TV …),
      // search-only, linking where each category lives now
      ...categoryItems(upcomingCounts),
    ];
  }, [upcomingCounts, savedCount, market, homePath, marketData]);

  // Empty-query BROWSE: sections first, then each live market as a microcap
  // header row followed by its makers — the grouped index the nav dropdown
  // used to carry. The market row itself navigates to the lander.
  const browseItems = useMemo<Item[]>(() => {
    const sections = items.filter(i => i.kind === 'section');
    const grouped: Item[] = [];
    for (const m of MARKETS.filter(m => m.live && m.key !== 'all')) {
      const makers = MAKERS
        .filter(a => a.market === m.key)
        .map(a => items.find(i => i.kind === 'maker' && i.path === makerHref(a.slug)))
        .filter(Boolean) as Item[];
      const marketItem = items.find(i => i.kind === 'market' && i.path === MARKET_PATH[m.key]);
      if (marketItem) grouped.push(marketItem);
      grouped.push(...makers);
    }
    return [...sections, ...grouped];
  }, [items]);

  // SEARCH (W3, Oct 11 2026) — app/lib/palette-search ranks every source
  // into sections: Go to · Names · On the block · References · Sold archive.
  // The index (names, typo vocabulary) builds when the palette opens; the
  // live book's search text builds in the first idle slot after.
  const index = useMemo(() => {
    if (!open) return null;
    const mk = new Map((ents || []).map(e => [e.id, e.market]));
    return buildPaletteIndex({
      items, ents: ents || [], entMarket: id => mk.get(id),
      liveByEntity, upcomingLots, refs, refLabel,
    });
  }, [open, items, ents, liveByEntity, upcomingLots, refs]);
  useEffect(() => {
    if (!index) return;
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number; cancelIdleCallback?: (h: number) => void };
    if (w.requestIdleCallback) { const h = w.requestIdleCallback(() => warmPaletteLots(index)); return () => w.cancelIdleCallback?.(h); }
    const t = setTimeout(() => warmPaletteLots(index), 200);
    return () => clearTimeout(t);
  }, [index]);
  // the sold archive, per keystroke (debounced; shards + blocks are module-cached)
  const soldQ = index && q.trim().length >= 3 ? soldQueryOf(q, index) : '';
  useEffect(() => {
    if (!open || !soldQ.trim()) { setSold(null); return; }
    let live = true;
    const t = setTimeout(() => {
      searchSoldEx(soldQ, 5)
        .then(r => { if (live) setSold({ ...r, q: soldQ }); })
        .catch(() => { if (live) setSold({ hits: [], total: null, fixed: {}, q: soldQ }); });
    }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [soldQ, open]);
  const soldNow = sold && sold.q === soldQ ? sold : null;
  const soldPending = !!soldQ.trim() && !soldNow;

  const sections = useMemo<PaletteSection[]>(() => {
    if (!index || !q.trim()) return [];
    return rankPalette(q, index, soldNow?.hits || [], soldNow?.total ?? null).sections;
  }, [index, q, soldNow]);

  const browsing = q.trim() === '';
  // keyboard nav + Enter index into the SAME flat list that renders
  const shown = useMemo(() => (browsing ? browseItems : sections.flatMap(s => s.rows)), [browsing, browseItems, sections]);
  // where each section starts in `shown` (PageDown / PageUp jump between them)
  const starts = useMemo(() => {
    const out: number[] = [];
    let at = 0;
    for (const s of sections) { out.push(at); at += s.rows.length; }
    return out;
  }, [sections]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(o => !o);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    }
    const onOpenEvent = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_CK_EVENT, onOpenEvent);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(OPEN_CK_EVENT, onOpenEvent);
    };
  }, []);

  // Tab stays inside the palette; focus returns to the opener on close
  // (the input takes initial focus itself, below)
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useDialogFocus(open, dialogRef, { initial: 'none' });
  useEffect(() => {
    if (open) {
      setQ('');
      setIdx(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  useEffect(() => { setIdx(0); }, [q]);

  // the browse roster overflows the list viewport — keep the keyboard
  // highlight visible as the arrows walk it
  useEffect(() => {
    const el = listRef.current?.querySelector('[data-active="true"]');
    // a section's first row brings its header along
    const grp = el?.parentElement;
    const head = grp?.getAttribute('role') === 'group' && grp.children[1] === el ? grp.children[0] : null;
    head?.scrollIntoView({ block: 'nearest' });
    el?.scrollIntoView({ block: 'nearest' });
  }, [idx]);

  function go(item: Item) {
    // the typed term only (never the pick) — on-device (app/lib/recs-signals)
    if (q.trim().length >= 3) recordSignal('search', q);
    setOpen(false);
    router.push(item.path);
  }

  function renderRow(item: Item, i: number, className: string, style?: React.CSSProperties) {
    return (
      <button
        key={`${item.kind}-${item.label}-${item.path}`}
        id={`ray-ck-opt-${i}`}
        role="option"
        aria-selected={i === idx}
        className={className}
        data-active={i === idx}
        onMouseEnter={() => setIdx(i)}
        onClick={() => go(item)}
        style={style}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}>
          {(item.kind === 'maker' || item.kind === 'entity') && <ArtistAvatar label={item.label} size={20} />}
          {item.label}
        </span>
        <span className="ray-ck-hint">{item.hint}</span>
      </button>
    );
  }

  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div className="ray-ck-overlay" onClick={() => setOpen(false)} role="presentation">
      <div
        ref={dialogRef}
        className="ray-ck"
        role="dialog"
        aria-modal="true"
        aria-label="Jump to"
        style={{ fontVariantNumeric: 'tabular-nums' }}
        onClick={e => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="ray-ck-input"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search a maker, a player, a reference, a live lot, or the sold archive…"
          aria-label="Search"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="go"
          role="combobox"
          aria-expanded="true"
          aria-controls="ray-ck-listbox"
          aria-activedescendant={shown[idx] ? `ray-ck-opt-${idx}` : undefined}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(i + 1, shown.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)); }
            // PageDown / PageUp: the next / previous section's first row
            else if (e.key === 'PageDown' && starts.length) { e.preventDefault(); setIdx(i => starts.find(s => s > i) ?? i); }
            else if (e.key === 'PageUp' && starts.length) { e.preventDefault(); setIdx(i => [...starts].reverse().find(s => s < i) ?? 0); }
            else if (e.key === 'Enter' && shown[idx]) { e.preventDefault(); go(shown[idx]); }
          }}
        />
        <div className="ray-ck-list" role="listbox" id="ray-ck-listbox" ref={listRef}>
          {shown.length === 0 ? (
            <div className="ray-ck-empty">{soldPending ? 'Searching the sold archive…' : 'Nothing matches.'}</div>
          ) : browsing ? (
            shown.map((item, i) => {
              // browse mode renders each market row as a microcap group header
              // — still a real option (it opens the lander), still in the
              // keyboard order, just set in the certificate's label voice
              const isHeader = item.kind === 'market';
              return renderRow(item, i, isHeader ? 'ray-ck-item kicker' : 'ray-ck-item', isHeader ? { marginTop: 6 } : undefined);
            })
          ) : (
            sections.map((sec, si) => (
              <div key={sec.key} role="group" aria-labelledby={`ray-ck-sec-${sec.key}`}>
                <div id={`ray-ck-sec-${sec.key}`} className="kicker" style={{ padding: si ? '12px 14px 4px' : '6px 14px 4px' }}>
                  {sec.title}
                  {sec.count != null && sec.count > sec.rows.length ? ` · ${sec.count.toLocaleString()}` : ''}
                  {sec.key === 'sold' && soldNow && Object.keys(soldNow.fixed).length
                    ? ` · read as ${Object.values(soldNow.fixed).map(w => `“${w}”`).join(' ')}`
                    : ''}
                </div>
                {sec.rows.map((item, ri) => renderRow(item, starts[si] + ri, 'ray-ck-item'))}
              </div>
            ))
          )}
          {!browsing && shown.length > 0 && soldPending && (
            <div className="kicker" style={{ padding: '12px 14px 6px' }}>Searching the sold archive…</div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
