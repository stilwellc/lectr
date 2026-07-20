'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { ARTISTS, ARTIST_LABEL, MARKETS } from '../constants';
import { useMarket, MARKET_PATH } from '../lib/market';
import { useRayData } from '../hooks/useRayData';
import { craftTitle } from '../utils';
import ArtistAvatar from './ArtistAvatar';

interface Item {
  label: string;
  hint: string;
  path: string;
  kind: 'section' | 'market' | 'maker' | 'lot';
}

/** Any surface can open the palette by dispatching this window event —
 *  the nav's Find-a-maker pill and the ⌘K hint button both use it. */
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
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { market } = useMarket();
  const homePath = MARKET_PATH[market] || '/';
  const { allLots } = useRayData();
  const upcomingLots = useMemo(() => allLots.filter(l => l.status === 'upcoming' && l.title), [allLots]);

  const items = useMemo<Item[]>(() => {
    // "On the block" is scoped to the current lander — the count says only
    // what that feed will actually render.
    const onBlockCount = ARTISTS
      .filter(a => market === 'all' || a.market === market)
      .reduce((s, a) => s + (upcomingCounts[a.slug] || 0), 0);
    return [
      { label: 'Overview', hint: 'the market', path: homePath, kind: 'section' as const },
      { label: 'Value', hint: 'below-market lots', path: '/value', kind: 'section' as const },
      { label: 'Makers', hint: 'the roster, as demand curves', path: '/artists', kind: 'section' as const },
      { label: 'Analytics', hint: 'market-level intelligence', path: '/analytics', kind: 'section' as const },
      { label: `My profile${savedCount > 0 ? ` · ${savedCount}` : ''}`, hint: 'your watchlist', path: '/saved', kind: 'section' as const },
      { label: 'Blog', hint: 'quarterly market notes + how we built the engine', path: '/blog', kind: 'section' as const },
      { label: 'How lectr works', hint: 'the engine, for engineers', path: '/about', kind: 'section' as const },
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
          ? `${a.market} · ${upcomingCounts[a.slug]} live ${upcomingCounts[a.slug] === 1 ? 'lot' : 'lots'}`
          : `${a.market} maker`,
        path: `/${a.slug}`,
        kind: 'maker' as const,
      })),
    ];
  }, [upcomingCounts, savedCount, market, homePath]);

  // Empty-query BROWSE: sections first, then each live market as a microcap
  // header row followed by its makers — the grouped index the nav dropdown
  // used to carry. The market row itself navigates to the lander.
  const browseItems = useMemo<Item[]>(() => {
    const sections = items.filter(i => i.kind === 'section');
    const grouped: Item[] = [];
    for (const m of MARKETS.filter(m => m.live && m.key !== 'all')) {
      const makers = ARTISTS
        .filter(a => a.market === m.key)
        .map(a => items.find(i => i.kind === 'maker' && i.path === `/${a.slug}`))
        .filter(Boolean) as Item[];
      if (!makers.length) continue;
      const marketItem = items.find(i => i.kind === 'market' && i.path === MARKET_PATH[m.key]);
      if (marketItem) grouped.push(marketItem);
      grouped.push(...makers);
    }
    return [...sections, ...grouped];
  }, [items]);

  // THE ARCHIVE TIER — every lot that ever crossed the book, straight from
  // the lots table (trigram-indexed, one ~50ms query). Sold-only: the live
  // book is already searched client-side below, so the two tiers never
  // overlap. Debounced; absent DB config degrades to live-only silently.
  const [archHits, setArchHits] = useState<Item[]>([]);
  useEffect(() => {
    const dbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const dbAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const needle = q.trim();
    if (needle.length < 3 || !dbUrl || !dbAnon) { setArchHits([]); return; }
    let dead = false;
    const t = window.setTimeout(async () => {
      try {
        const words = needle.split(/\s+/).slice(0, 4)
          .map(w => w.replace(/[%,()*\\]/g, ''))
          .filter(Boolean);
        if (!words.length) return;
        const and = `and=(${words.map(w => `title.ilike.*${encodeURIComponent(w)}*`).join(',')})`;
        const res = await fetch(
          `${dbUrl}/rest/v1/lots?${and}&status=eq.sold&select=id,title,artist,sale_date,price_usd,house&order=sale_date.desc.nullslast&limit=8`,
          { headers: { apikey: dbAnon, Authorization: `Bearer ${dbAnon}` } },
        );
        if (!res.ok) return;
        const rows: { id: string; title: string; artist: string | null; sale_date: string | null; price_usd: number | null; house: string | null }[] = await res.json();
        if (dead) return;
        setArchHits(rows.map(r => ({
          label: craftTitle(r.title || r.id),
          hint: [
            r.sale_date ? `hammered ${r.sale_date.slice(0, 4)}` : 'hammered',
            r.price_usd ? `$${Math.round(r.price_usd).toLocaleString()}` : null,
            r.house,
          ].filter(Boolean).join(' · '),
          path: `/lot?id=${encodeURIComponent(r.id)}`,
          kind: 'lot' as const,
        })));
      } catch { /* archive tier is a bonus — never break the palette */ }
    }, 220);
    return () => { dead = true; window.clearTimeout(t); };
  }, [q]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return browseItems;
    const itemMatches = items.filter(i => `${i.label} ${i.hint}`.toLowerCase().includes(needle));
    // Search the live lots too — a collector arrives with a work in mind.
    const lotMatches: Item[] = upcomingLots
      .filter(l => `${craftTitle(l.title)} ${ARTIST_LABEL[l.artist] || l.artist}`.toLowerCase().includes(needle))
      .slice(0, 6)
      .map(l => ({
        label: craftTitle(l.title),
        hint: `${ARTIST_LABEL[l.artist] || l.artist} · on the block`,
        path: `/${l.artist}#on-the-block`,
        kind: 'lot' as const,
      }));
    return [...itemMatches, ...lotMatches, ...archHits];
  }, [items, browseItems, q, upcomingLots, archHits]);
  // While searching, only the first 12 are rendered — keyboard nav + Enter
  // must index into the SAME list, or the highlight vanishes and Enter fires
  // an unseen item. The empty-query browse renders the whole grouped roster
  // (the list scrolls, and the active row is kept in view).
  const browsing = q.trim() === '';
  const shown = browsing ? filtered : filtered.slice(0, 16);

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
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [idx]);

  function go(item: Item) {
    setOpen(false);
    router.push(item.path);
  }

  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div className="ray-ck-overlay" onClick={() => setOpen(false)} role="presentation">
      <div
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
          placeholder="Search a maker, a market, or any lot ever…"
          aria-label="Search"
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(i + 1, shown.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)); }
            else if (e.key === 'Enter' && shown[idx]) go(shown[idx]);
          }}
        />
        <div className="ray-ck-list" role="listbox" ref={listRef}>
          {filtered.length === 0 ? (
            <div className="ray-ck-empty">Nothing matches.</div>
          ) : (
            shown.map((item, i) => {
              // browse mode renders each market row as a microcap group header
              // — still a real option (it opens the lander), still in the
              // keyboard order, just set in the certificate's label voice
              const isHeader = browsing && item.kind === 'market';
              return (
                <button
                  key={`${item.kind}-${item.label}-${item.path}`}
                  role="option"
                  aria-selected={i === idx}
                  className="ray-ck-item"
                  data-active={i === idx}
                  onMouseEnter={() => setIdx(i)}
                  onClick={() => go(item)}
                  style={isHeader ? {
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: '0.14em',
                    textTransform: 'uppercase',
                    color: 'var(--color-text-faint)',
                    marginTop: 6,
                  } : undefined}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}>
                    {item.kind === 'maker' && <ArtistAvatar label={item.label} size={20} />}
                    {item.label}
                  </span>
                  <span className="ray-ck-hint">{item.hint}</span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
