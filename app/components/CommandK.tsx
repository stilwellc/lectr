'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { ARTISTS } from '../constants';

interface Item {
  label: string;
  hint: string;
  path: string;
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

  const items = useMemo<Item[]>(() => [
    { label: 'Overview', hint: 'the market', path: '/' },
    { label: 'Value', hint: 'below-market lots', path: '/value' },
    { label: 'Analytics', hint: 'market-level intelligence', path: '/analytics' },
    { label: 'Saved', hint: 'your watchlist', path: '/saved' },
    ...ARTISTS.map(a => ({
      label: a.label,
      hint: upcomingCounts[a.slug] ? `${upcomingCounts[a.slug]} live lots` : 'artist',
      path: `/${a.slug}`,
    })),
  ], [upcomingCounts]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter(i => `${i.label} ${i.hint}`.toLowerCase().includes(needle));
  }, [items, q]);

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
        onClick={e => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="ray-ck-input"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Jump to an artist or section…"
          aria-label="Search"
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(i + 1, filtered.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)); }
            else if (e.key === 'Enter' && filtered[idx]) go(filtered[idx]);
          }}
        />
        <div className="ray-ck-list" role="listbox">
          {filtered.length === 0 ? (
            <div className="ray-ck-empty">Nothing matches.</div>
          ) : (
            filtered.slice(0, 12).map((item, i) => (
              <button
                key={item.path}
                role="option"
                aria-selected={i === idx}
                className="ray-ck-item"
                data-active={i === idx}
                onMouseEnter={() => setIdx(i)}
                onClick={() => go(item)}
              >
                <span>{item.label}</span>
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
