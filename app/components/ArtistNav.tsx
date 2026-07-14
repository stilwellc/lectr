'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ARTISTS, MARKETS } from '../constants';
import { useMarket, MARKET_PATH } from '../lib/market';
import CommandK from './CommandK';

export default function ArtistNav({ activeSlug, savedCount = 0, upcomingCounts = {}, lastCrawl }: { activeSlug: string | null; savedCount?: number; upcomingCounts?: Record<string, number>; lastCrawl?: string }) {
  const [open, setOpen] = useState(false);
  const [lit, setLit] = useState(false);
  const [query, setQuery] = useState('');
  const router = useRouter();
  const { market } = useMarket();
  // Every "home" affordance resolves to the active market's lander — the
  // watches user who bounces home never sees Picasso unless she asks.
  const homePath = MARKET_PATH[market] || '/';

  // The switch-on ritual — once per session the mark warms from dim to full.
  // Client-only: sessionStorage guard, class added after mount so SSR markup
  // stays identical. Keyframes (lectrSwitchOn) live in globals.css behind a
  // prefers-reduced-motion gate; without them the class is a no-op.
  useEffect(() => {
    try {
      if (!sessionStorage.getItem('lectr-lit')) {
        sessionStorage.setItem('lectr-lit', '1');
        setLit(true);
      }
    } catch {
      // sessionStorage unavailable (private mode edge cases) — skip the ritual.
    }
  }, []);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);

  // Type-to-filter over the maker index. Group headers stay visible while
  // any of their makers match; empty groups drop out.
  const filteredGroups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return MARKETS
      .filter(m => m.live && m.key !== 'all')
      .map(m => ({
        market: m,
        makers: ARTISTS.filter(a =>
          a.market === m.key && (!needle || a.label.toLowerCase().includes(needle))
        ),
      }))
      .filter(g => g.makers.length > 0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    // Focus lands on the filter input — the menu is a finder now.
    setQuery('');
    filterRef.current?.focus({ preventScroll: true });
    if (dropdownRef.current) dropdownRef.current.scrollTop = 0;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function handleScroll() { setOpen(false); }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
      window.removeEventListener('scroll', handleScroll);
    };
  }, [open]);

  function navigate(path: string) {
    setOpen(false);
    router.push(path);
  }

  return (
    <>
    <div className="ray-artist-nav" ref={ref}>
      <style>{`
        .ray-artist-nav {
          position: sticky;
          top: 0;
          z-index: 40;
          background: var(--color-nav-bg);
          backdrop-filter: blur(30px);
          -webkit-backdrop-filter: blur(30px);
          border-bottom: 1px solid var(--color-border);
          padding-block: 8px;
        }
        .ray-artist-nav-inner {
          position: relative;
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .ray-wordmark {
          display: inline-flex;
          align-items: center;
          gap: 9px;
          font-family: var(--font-sans), sans-serif;
          font-weight: 750;
          font-size: 18px;
          line-height: 1;
          letter-spacing: -0.02em;
          color: var(--color-fg);
          text-decoration: none;
          white-space: nowrap;
          padding: 6px 0;
          margin: -6px 0;
          transition: opacity var(--duration-fast) var(--ease-signature);
        }
        .ray-mark-r { display: block; height: 26px; width: auto; }
        .ray-mark-r.lectr-on { animation: lectrSwitchOn 480ms var(--ease-signature) 1 both; }
        .ray-wordmark:hover,
        .ray-wordmark:focus-visible { opacity: 0.68; }
        .ray-artist-select-wrap {
          position: relative;
          flex: 1;
        }
        /* On wide screens the selector stays a compact control pinned to the
           right, back-link on the left, instead of stretching into a big empty
           bar. Mobile keeps the full-width tap target. NOTE: no apostrophes,
           quotes or angle brackets in this block - React escapes them server
           side and hydration of the raw-text style element then fails. */
        @media (min-width: 769px) {
          .ray-artist-select-wrap {
            flex: 0 0 auto;
            width: clamp(240px, 24vw, 320px);
            margin-left: auto;
          }
        }
        .ray-artist-select-btn {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 16px;
          color: var(--color-fg);
          font-family: var(--font-sans), sans-serif;
          font-size: 12px;
          font-weight: 500;
          letter-spacing: 0.04em;
          cursor: pointer;
        }
        /* Higher specificity on purpose - position must beat the
           position: relative from .glass regardless of stylesheet order.
           NOTE: keep this style block free of quotes, apostrophes and
           angle brackets; React escapes them server-side and hydration
           of raw-text elements then fails. */
        @keyframes rayDropIn {
          from { opacity: 0; transform: translateY(-6px); }
          to { opacity: 1; transform: none; }
        }
        .ray-artist-select-wrap .ray-artist-dropdown {
          animation: rayDropIn 200ms var(--ease-signature) both;
          position: absolute;
          left: 0;
          right: 0;
          top: 100%;
          margin-top: 4px;
          max-height: 400px;
          overflow-y: auto;
          scrollbar-width: none;
          z-index: 100;
          /* Opaque on purpose. backdrop-filter cannot work here - the
             sticky nav above is itself a backdrop root, so glass blur
             samples nothing and page text would ghost through the menu. */
          background: var(--color-bg-elevated);
        }
        .ray-artist-dropdown::-webkit-scrollbar { display: none; }
        .ray-artist-dropdown-item {
          display: block;
          width: 100%;
          padding: 10px 16px;
          font-family: var(--font-sans), sans-serif;
          font-size: 12px;
          font-weight: 500;
          letter-spacing: 0.04em;
          color: var(--color-text-muted);
          text-decoration: none;
          border: none;
          background: transparent;
          text-align: left;
          cursor: pointer;
          transition: background var(--duration-fast) var(--ease-signature), color var(--duration-fast) var(--ease-signature);
          border-bottom: 1px solid var(--color-border);
        }
        .ray-artist-dropdown-item:last-child { border-bottom: none; }
        .ray-artist-dropdown-item:hover {
          background: var(--color-hover-item);
          color: var(--color-fg);
        }
        /* NOTE: keep this style block free of quotes and angle brackets.
           React HTML-escapes them in server-rendered style text, but the
           browser keeps the escaped entity literally inside a raw-text
           element - the text node then differs between server and client
           and hydration fails. */
        .ray-artist-dropdown-item[data-active=true] {
          color: var(--color-fg);
          background: var(--color-hover-item);
          font-weight: 600;
        }
        .ray-artist-count {
          font-size: 12px;
          font-weight: 600;
          color: var(--color-bg);
          background: var(--color-fg);
          border-radius: 100px;
          padding: 1px 7px;
          margin-left: 8px;
        }
        .ray-artist-dropdown-divider {
          height: 1px;
          background: var(--color-border);
          margin: 0;
          border: none;
        }
        .ray-artist-dropdown-label {
          display: block;
          width: 100%;
          padding: 8px 16px 4px;
          font-family: var(--font-sans), sans-serif;
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.15em;
          text-transform: uppercase;
          color: var(--color-text-faint);
          border: none;
          border-bottom: 1px solid var(--color-border);
          background: transparent;
          text-align: left;
          cursor: pointer;
          transition: background var(--duration-fast) var(--ease-signature), color var(--duration-fast) var(--ease-signature);
        }
        .ray-artist-dropdown-label:hover,
        .ray-artist-dropdown-label:focus-visible {
          background: var(--color-hover-item);
          color: var(--color-fg);
        }
        .ray-artist-dropdown-filter {
          position: sticky;
          top: 0;
          z-index: 1;
          display: block;
          width: 100%;
          padding: 10px 16px;
          font-family: var(--font-sans), sans-serif;
          font-size: 12px;
          font-weight: 500;
          letter-spacing: 0.04em;
          color: var(--color-fg);
          background: var(--color-bg-elevated);
          border: none;
          border-bottom: 1px solid var(--color-border);
          outline: none;
        }
        .ray-artist-dropdown-filter::placeholder { color: var(--color-text-faint); }
        @media (max-width: 768px) {
          .ray-artist-nav { top: 0; }
        }
      `}</style>

      <div className="ray-artist-nav-inner rail">
        <a href={homePath} className="ray-wordmark" aria-label="lectr — home">
          {/* the script mark stands alone — the mark IS the name; its upward tilt is intentional */}
          <img className={`ray-mark-r${lit ? ' lectr-on' : ''}`} src="/brand/lectr-nav.png" alt="lectr" />
        </a>

        {/* Desktop quick links — one click to each room; the dropdown stays
            the artist index. Hidden on mobile where the dropdown covers all. */}
        <nav className="ray-nav-links" aria-label="Sections">
          <button className="ray-nav-link" data-active={activeSlug === null} onClick={() => navigate(homePath)}>Overview</button>
          <button className="ray-nav-link ray-nav-link-value" data-active={activeSlug === 'value'} onClick={() => navigate('/value')}>Value</button>
          <button className="ray-nav-link" data-active={activeSlug === 'artists'} onClick={() => navigate('/artists')}>Makers</button>
          <button className="ray-nav-link" data-active={activeSlug === 'analytics'} onClick={() => navigate('/analytics')}>Analytics</button>
          <button className="ray-nav-link" data-active={activeSlug === 'saved'} onClick={() => navigate('/saved')}>
            Saved{savedCount > 0 ? ` · ${savedCount}` : ''}
          </button>
        </nav>

        {lastCrawl && (
          <span className="ray-fresh" title="Data refreshes with the daily crawl">
            <span className="ray-fresh-dot" aria-hidden="true" />
            Live · updated {lastCrawl}
          </span>
        )}

        <button
          className="ray-ck-hintbtn"
          aria-label="Open jump palette (Command K)"
          onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}
        >
          Search &#8984;K
        </button>

        <div className="ray-artist-select-wrap">
        <button
          ref={triggerRef}
          className="ray-artist-select-btn glass glass-pill glass-quiet"
          onClick={() => setOpen(o => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
        >
          <span>Find a maker</span>
          <span style={{
            fontSize: 12,
            opacity: 0.4,
            transform: open ? 'rotate(180deg)' : 'rotate(0)',
            transition: 'transform var(--duration-fast) var(--ease-signature)',
          }}>
            &#9660;
          </span>
        </button>

        {open && (
          <div className="ray-artist-dropdown glass glass-noblur" role="menu" aria-label="Find a maker" ref={dropdownRef}>
            <input
              ref={filterRef}
              className="ray-artist-dropdown-filter"
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Filter makers…"
              aria-label="Filter makers"
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  const first = filteredGroups[0]?.makers[0];
                  if (query.trim() && first) navigate(`/${first.slug}`);
                } else if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  dropdownRef.current
                    ?.querySelector<HTMLButtonElement>('.ray-artist-dropdown-item')
                    ?.focus({ preventScroll: true });
                }
              }}
            />
            {filteredGroups.length === 0 && (
              <div className="ray-artist-dropdown-item" style={{ color: 'var(--color-text-faint)', cursor: 'default' }}>
                No maker matches
              </div>
            )}
            {filteredGroups.map(({ market: m, makers }) => (
              <React.Fragment key={m.key}>
                <button
                  role="menuitem"
                  className="ray-artist-dropdown-label"
                  onClick={() => navigate(MARKET_PATH[m.key])}
                >
                  {m.label}
                </button>
                {makers.map(a => (
                  <button
                    key={a.slug}
                    role="menuitem"
                    className="ray-artist-dropdown-item"
                    data-active={activeSlug === a.slug ? 'true' : 'false'}
                    onClick={() => navigate(`/${a.slug}`)}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                  >
                    <span>{a.label}</span>
                    {(upcomingCounts[a.slug] || 0) > 0 && (
                      <span className="ray-artist-count">{upcomingCounts[a.slug]}</span>
                    )}
                  </button>
                ))}
              </React.Fragment>
            ))}
          </div>
        )}
        </div>
      </div>

    </div>

      {/* Mobile bottom tab bar — a SIBLING of the nav: backdrop-filter on the
          nav would otherwise become the containing block for position:fixed
          and pin the bar to the top. */}
      <nav className="ray-tabbar" aria-label="Sections">
        <button className="ray-tab" data-active={activeSlug === null} onClick={() => navigate(homePath)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 16l5-6 4 4 6-8" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M3 21h18" strokeLinecap="round" />
          </svg>
          Overview
        </button>
        <button className="ray-tab" data-active={activeSlug === 'value'} onClick={() => navigate('/value')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M19 5L5 19" strokeLinecap="round" />
            <circle cx="7.5" cy="7.5" r="2.6" />
            <circle cx="16.5" cy="16.5" r="2.6" />
          </svg>
          Value
        </button>
        <button className="ray-tab" data-active={activeSlug === 'artists'} onClick={() => navigate('/artists')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="8" r="3.4" />
            <path d="M5 20c1.4-3.4 4-5 7-5s5.6 1.6 7 5" strokeLinecap="round" />
          </svg>
          Makers
        </button>
        <button className="ray-tab" data-active={activeSlug === 'analytics'} onClick={() => navigate('/analytics')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 20V10M12 20V4M19 20v-7" strokeLinecap="round" />
          </svg>
          Analytics
        </button>
        <button className="ray-tab" data-active={activeSlug === 'saved'} onClick={() => navigate('/saved')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 3h12v18l-6-4.2L6 21V3z" strokeLinejoin="round" />
          </svg>
          Saved{savedCount > 0 ? ` · ${savedCount}` : ''}
        </button>
      </nav>

      <CommandK upcomingCounts={upcomingCounts} />
    </>
  );
}
