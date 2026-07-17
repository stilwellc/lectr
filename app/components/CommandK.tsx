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

/**
 * CommandK — jump anywhere. ⌘K / Ctrl-K opens a palette over sections and
 * every tracked artist (with live-lot counts); type to filter, arrows to
 * move, Enter to go. Rendered in a portal above everything.
 */
export default function CommandK({ upcomingCounts }: { upcomingCounts: Record<string, number> }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
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
      { label: 'Saved', hint: 'your watchlist', path: '/saved', kind: 'section' as const },
      { label: 'Notes from the desk', hint: 'quarterly market notes + how we built the engine', path: '/blog', kind: 'section' as const },
      { label: 'How it works', hint: 'the engine, for engineers', path: '/about', kind: 'section' as const },
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
          ? `${a.market} · ${upcomingCounts[a.slug]} live lots`
          : `${a.market} maker`,
        path: `/${a.slug}`,
        kind: 'maker' as const,
      })),
    ];
  }, [upcomingCounts, market, homePath]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    const itemMatches = items.filter(i => `${i.label} ${i.hint}`.toLowerCase().includes(needle));
    // Search the live lots too — a collector arrives with a work in mind.
    const lotMatches: Item[] = upcomingLots
      .filter(l => `${craftTitle(l.title)} ${ARTIST_LABEL[l.artist] || l.artist}`.toLowerCase().includes(needle))
      .slice(0, 8)
      .map(l => ({
        label: craftTitle(l.title),
        hint: `${ARTIST_LABEL[l.artist] || l.artist} · on the block`,
        path: `/${l.artist}#on-the-block`,
        kind: 'lot' as const,
      }));
    return [...itemMatches, ...lotMatches];
  }, [items, q, upcomingLots]);
  // only the first 12 are rendered — keyboard nav + Enter must index into the
  // SAME list, or the highlight vanishes and Enter fires an unseen item.
  const shown = filtered.slice(0, 12);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(o => !o);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQ('');
      setIdx(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  useEffect(() => { setIdx(0); }, [q]);

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
          placeholder="Search a maker, market, or lot…"
          aria-label="Search"
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(i + 1, shown.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)); }
            else if (e.key === 'Enter' && shown[idx]) go(shown[idx]);
          }}
        />
        <div className="ray-ck-list" role="listbox">
          {filtered.length === 0 ? (
            <div className="ray-ck-empty">Nothing matches.</div>
          ) : (
            shown.map((item, i) => (
              <button
                key={`${item.kind}-${item.label}-${item.path}`}
                role="option"
                aria-selected={i === idx}
                className="ray-ck-item"
                data-active={i === idx}
                onMouseEnter={() => setIdx(i)}
                onClick={() => go(item)}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}>
                  {item.kind === 'maker' && <ArtistAvatar label={item.label} size={20} />}
                  {item.label}
                </span>
                <span className="ray-ck-hint">{item.hint}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
