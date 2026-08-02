'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { ARTISTS, MARKETS } from '../constants';
import { useMarket, MARKET_PATH } from '../lib/market';
import CommandK, { OPEN_CK_EVENT } from './CommandK';
import Flick from './Flick';
import { useAuth } from '../lib/account';
import { useUnseenAlertCount } from '../lib/alerts';

export default function ArtistNav({ activeSlug, savedCount = 0, upcomingCounts = {}, lastCrawl }: { activeSlug: string | null; savedCount?: number; upcomingCounts?: Record<string, number>; lastCrawl?: string }) {
  const [open, setOpen] = useState(false);
  const [lit, setLit] = useState(false);
  const [query, setQuery] = useState('');
  // the sheet's "All makers" disclosure — collapsed on every open
  const [showAll, setShowAll] = useState(false);
  const { authEnabled, user, openLogin } = useAuth();
  const unseenAlerts = useUnseenAlertCount();
  // On phones the maker finder is a full-screen sheet (portaled to <body> to
  // escape the nav's backdrop-filter containing block), not a cramped dropdown.
  const [isMobile, setIsMobile] = useState(false);
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
  const dropdownRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const on = () => setIsMobile(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  // Lock the page behind the mobile sheet so the body doesn't scroll under it.
  useEffect(() => {
    if (!(open && isMobile)) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open, isMobile]);

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

  // The sheet's resting state — the five busiest makers by live lots. When
  // nothing is live the list is empty and only "Browse all makers" renders.
  const topMakers = useMemo(() =>
    ARTISTS
      .filter(a => (upcomingCounts[a.slug] || 0) > 0)
      .sort((a, b) => (upcomingCounts[b.slug] || 0) - (upcomingCounts[a.slug] || 0))
      .slice(0, 5),
    [upcomingCounts]);

  // The sheet (the only surface `open` still gates — the desktop finder now
  // opens CommandK): reset the filter, and let Escape or the scrim dismiss.
  // No focus-steal on open — the keyboard must not pop over the list.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setShowAll(false);
    if (dropdownRef.current) dropdownRef.current.scrollTop = 0;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  function navigate(path: string) {
    setOpen(false);
    router.push(path);
  }

  // The primary sections — the same rooms the desktop top bar links to. On
  // mobile they lead the full-screen menu so it is a real nav, not just a
  // maker finder.
  const sections = [
    { label: 'Overview', path: homePath, active: activeSlug === null },
    { label: 'Value', path: '/value', active: activeSlug === 'value' },
    { label: 'Makers', path: '/makers', active: activeSlug === 'artists' },
    { label: 'Analytics', path: '/analytics', active: activeSlug === 'analytics' },
    // ONE identity entry: signed in (or auth unconfigured) → My profile;
    // signed out → the sheet's Sign in row stands alone instead.
    ...((!authEnabled || user) ? [{ label: `My profile${savedCount > 0 ? ` · ${savedCount}` : ''}`, path: '/profile', active: activeSlug === 'saved' }] : []),
    { label: 'Blog', path: '/blog', active: activeSlug === 'blog' },
  ];

  // Shared finder pieces — the filter input and the grouped maker list — reused
  // by the desktop dropdown and the mobile full-screen sheet.
  const filterInput = (
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
            ?.querySelector<HTMLButtonElement>('button.ray-artist-dropdown-item')
            ?.focus({ preventScroll: true });
        }
      }}
    />
  );
  const groupList = (
    <>
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
    </>
  );

  return (
    <>
    <div className="ray-artist-nav">
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
          font-size: 12.5px;
          font-weight: 500;
          letter-spacing: 0.04em;
          cursor: pointer;
        }
        .ray-artist-dropdown-item {
          display: block;
          width: 100%;
          padding: 10px 16px;
          font-family: var(--font-sans), sans-serif;
          font-size: 12.5px;
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
          font-size: 12.5px;
          font-weight: 600;
          color: var(--color-bg);
          background: var(--color-fg);
          border-radius: 100px;
          padding: 1px 7px;
          margin-left: 8px;
        }
        .ray-artist-dropdown-label {
          display: block;
          width: 100%;
          padding: 8px 16px 4px;
          font-family: var(--font-sans), sans-serif;
          font-size: 12.5px;
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
          font-size: 12.5px;
          font-weight: 500;
          letter-spacing: 0.04em;
          color: var(--color-fg);
          background: var(--color-bg-elevated);
          border: none;
          border-bottom: 1px solid var(--color-border);
          outline: none;
        }
        .ray-artist-dropdown-filter::placeholder { color: var(--color-text-faint); }
        .ray-nav-burger { display: none; }
        .ray-nav-search { display: none; }
        @media (max-width: 768px) {
          .ray-artist-nav { top: 0; }
          /* the maker-only trigger gives way to a real menu button on phones */
          .ray-artist-select-wrap { display: none; }
          /* search + menu cluster on the right; the search carries the auto so
             the two sit side by side with the inner flex gap between them */
          .ray-nav-search {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            margin-left: auto;
            padding: 8px 8px;
            min-height: 42px;
            background: none;
            border: none;
            color: var(--color-fg);
            cursor: pointer;
          }
          .ray-nav-search svg { width: 21px; height: 21px; }
          .ray-nav-burger {
            display: inline-flex;
            align-items: center;
            gap: 7px;
            padding: 8px 12px;
            min-height: 42px;
            background: none;
            border: none;
            color: var(--color-fg);
            font-family: var(--font-sans), sans-serif;
            font-size: 13.5px;
            font-weight: 600;
            letter-spacing: 0.02em;
            cursor: pointer;
          }
          .ray-nav-burger svg { width: 20px; height: 20px; }
        }
        /* Mobile maker finder — a full-screen sheet, portaled to body so it
           escapes the nav backdrop-filter. Large rows, a big search field,
           comfortable touch targets. NOTE: this block must stay free of
           quotes, apostrophes and angle brackets (raw-text hydration). */
        @keyframes rayScrimIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes raySheetIn { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }
        .ray-maker-scrim {
          position: fixed;
          inset: 0;
          z-index: 300;
          background: rgba(15, 14, 10, 0.62);
          -webkit-backdrop-filter: blur(6px);
          backdrop-filter: blur(6px);
          animation: rayScrimIn 160ms var(--ease-signature) both;
        }
        .ray-maker-sheet {
          position: fixed;
          inset: 0;
          z-index: 301;
          display: flex;
          flex-direction: column;
          background: var(--color-bg);
          animation: raySheetIn 240ms var(--ease-signature) both;
        }
        .ray-maker-sheet-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 18px calc(14px);
          padding-top: calc(14px + env(safe-area-inset-top, 0px));
          border-bottom: 1px solid var(--color-border);
          flex: none;
        }
        .ray-maker-sheet-title {
          font-family: var(--font-sans), sans-serif;
          font-size: 17px;
          font-weight: 700;
          letter-spacing: -0.01em;
          color: var(--color-fg);
        }
        .ray-maker-sheet-close {
          border: none;
          background: none;
          color: var(--color-fg);
          font-family: var(--font-sans), sans-serif;
          font-size: 16px;
          font-weight: 600;
          padding: 8px 4px;
          margin: -8px -4px;
          min-height: 44px;
          cursor: pointer;
        }
        .ray-maker-sheet .ray-artist-dropdown-filter {
          position: static;
          flex: none;
          font-size: 16px;
          padding: 15px 18px;
          letter-spacing: 0;
        }
        .ray-maker-sheet-list {
          flex: 1;
          overflow-y: auto;
          -webkit-overflow-scrolling: touch;
          overscroll-behavior: contain;
          padding-bottom: env(safe-area-inset-bottom, 0px);
        }
        .ray-maker-sheet .ray-artist-dropdown-item {
          font-size: 15px;
          padding: 15px 20px;
          min-height: 54px;
          letter-spacing: 0;
        }
        .ray-maker-sheet .ray-artist-dropdown-label {
          position: sticky;
          top: 0;
          z-index: 1;
          font-size: 11.5px;
          padding: 14px 20px 8px;
          letter-spacing: 0.16em;
          background: var(--color-bg);
        }
        .ray-maker-sheet .ray-artist-count {
          font-size: 13.5px;
          padding: 2px 9px;
        }
        .ray-maker-sheet-nav {
          display: flex;
          flex-direction: column;
          border-bottom: 1px solid var(--color-border);
          padding: 4px 0 6px;
        }
        .ray-maker-navitem {
          display: flex;
          align-items: center;
          width: 100%;
          text-align: left;
          padding: 15px 20px;
          min-height: 54px;
          border: none;
          background: transparent;
          cursor: pointer;
          font-family: var(--font-sans), sans-serif;
          font-size: 17px;
          font-weight: 600;
          letter-spacing: -0.01em;
          color: var(--color-fg);
        }
        .ray-maker-navitem[data-active=true] { color: var(--color-fg); }
        .ray-maker-sheet-sub {
          padding: 18px 20px 4px;
          font-family: var(--font-sans), sans-serif;
          font-size: 11.5px;
          font-weight: 600;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: var(--color-text-faint);
        }
      `}</style>

      <div className="ray-artist-nav-inner rail">
        <a href={homePath} onClick={e => { e.preventDefault(); navigate(homePath); }} className="ray-wordmark" aria-label="lectr — home">
          {/* the script mark stands alone — the mark IS the name; its upward tilt is intentional */}
          <img className={`ray-mark-r${lit ? ' lectr-on' : ''}`} src="/brand/lectr-nav.png" alt="lectr" />
        </a>

        {/* Desktop quick links — one click to each room; the dropdown stays
            the artist index. Hidden on mobile where the dropdown covers all. */}
        <nav className="ray-nav-links" aria-label="Sections">
          <button className="ray-nav-link" data-active={activeSlug === null} onClick={() => navigate(homePath)}>Overview</button>
          <button className="ray-nav-link ray-nav-link-value" data-active={activeSlug === 'value'} onClick={() => navigate('/value')}>Value</button>
          <button className="ray-nav-link" data-active={activeSlug === 'artists'} onClick={() => navigate('/makers')}>Makers</button>
          <button className="ray-nav-link" data-active={activeSlug === 'analytics'} onClick={() => navigate('/analytics')}>Analytics</button>
          <button className="ray-nav-link" data-active={activeSlug === 'blog'} onClick={() => navigate('/blog')}>Blog</button>
          {(!authEnabled || user) ? (
            <button className="ray-nav-link" data-active={activeSlug === 'saved'} onClick={() => navigate('/profile')} title={user?.email || undefined}>
              My profile{savedCount > 0 ? ` · ${savedCount}` : ''}
              {unseenAlerts > 0 && (
                // butter marker: the nightly crawl left unread search matches
                <span aria-label={`${unseenAlerts} new matches`} style={{
                  display: 'inline-block', width: 5, height: 5, borderRadius: '50%',
                  background: 'var(--color-butter)', marginLeft: 6, verticalAlign: '2px',
                }} />
              )}
            </button>
          ) : (
            <button className="ray-nav-link" onClick={openLogin}>Sign in</button>
          )}
        </nav>


        {/* ONE search on desktop — the pill IS the search (opens the CommandK
            palette, which browses the full roster by market when empty and
            searches the archive when typed). The old separate "Search ⌘K"
            hint button did the exact same thing; folded into this pill's ⌘K
            badge so there's a single, unambiguous affordance. */}
        <div className="ray-artist-select-wrap">
        <button
          className="ray-artist-select-btn glass glass-pill glass-quiet"
          onClick={() => window.dispatchEvent(new Event(OPEN_CK_EVENT))}
          aria-haspopup="dialog"
          aria-label="Search — find a maker or a past lot"
        >
          <span>Find a maker</span>
          <kbd className="ray-nav-kbd" aria-hidden="true">&#8984;K</kbd>
        </button>
        </div>

        {/* Mobile-only search — icon that opens the same CommandK palette as the
            desktop pill and ⌘K. Sits just left of the menu button; the two
            cluster on the right (this one carries the margin-left:auto). */}
        <button
          className="ray-nav-search"
          aria-label="Search"
          onClick={() => window.dispatchEvent(new Event(OPEN_CK_EVENT))}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
        </button>

        {/* Mobile-only menu button — opens the full-screen nav sheet (sections
            + maker finder). Desktop uses the links + Find a maker above. */}
        <button
          className="ray-nav-burger"
          aria-label="Open menu"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen(o => !o)}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
          <span>Menu</span>
        </button>
      </div>

    </div>

      {/* The mobile bottom tab bar was retired — the hamburger sheet now
          carries every section, so the bar was redundant chrome. */}

      {open && isMobile && typeof document !== 'undefined' && createPortal(
        <div className="ray-maker-scrim" onClick={() => setOpen(false)} role="presentation">
          <div
            className="ray-maker-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            onClick={e => e.stopPropagation()}
          >
            <div className="ray-maker-sheet-head">
              <span className="ray-maker-sheet-title">Menu</span>
              <button className="ray-maker-sheet-close" onClick={() => setOpen(false)}>Done</button>
            </div>
            <div className="ray-maker-sheet-list" ref={dropdownRef}>
              <nav className="ray-maker-sheet-nav" aria-label="Sections">
                {sections.map(s => (
                  <button
                    key={s.path}
                    className="ray-maker-navitem"
                    data-active={s.active ? 'true' : 'false'}
                    onClick={() => navigate(s.path)}
                  >
                    {s.label}
                  </button>
                ))}
                {authEnabled && !user && (
                  /* signed-out only — for signed-in users the account (and
                     sign-out) lives on My profile, not in the menu */
                  <button
                    className="ray-maker-navitem"
                    onClick={() => { openLogin(); setOpen(false); }}
                  >
                    Sign in
                  </button>
                )}
              </nav>
              <div className="ray-maker-sheet-sub">Find a maker</div>
              {filterInput}
              {/* the full ~38-row roster only unrolls once the user TYPES —
                  the resting sheet stays two screens shorter. Empty state:
                  the five busiest makers by live lots, then the full index. */}
              {query.trim() ? groupList : (
                <>
                  {topMakers.map(a => (
                    <button
                      key={a.slug}
                      role="menuitem"
                      className="ray-artist-dropdown-item"
                      data-active={activeSlug === a.slug ? 'true' : 'false'}
                      onClick={() => navigate(`/${a.slug}`)}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                    >
                      <span>{a.label}</span>
                      <span className="ray-artist-count">{upcomingCounts[a.slug]}</span>
                    </button>
                  ))}
                  {/* the disclosure — unrolls the full grouped roster IN the
                      sheet; the down Flick flips while it is open */}
                  <button
                    role="menuitem"
                    className="ray-artist-dropdown-item"
                    aria-expanded={showAll}
                    onClick={() => setShowAll(s => !s)}
                    style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 600, color: 'var(--color-fg)' }}
                  >
                    All makers{' '}
                    <Flick
                      size={11}
                      style={{
                        marginLeft: 0,
                        transform: showAll ? 'scaleY(-1) rotate(180deg)' : 'scaleY(-1)',
                        transition: 'transform var(--duration-fast) var(--ease-signature)',
                      }}
                    />
                  </button>
                  {showAll && groupList}
                  <button
                    role="menuitem"
                    className="ray-artist-dropdown-item"
                    onClick={() => navigate('/makers')}
                    style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 600, color: 'var(--color-fg)' }}
                  >
                    Browse all makers <Flick size={11} style={{ marginLeft: 0 }} />
                  </button>
                </>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      <CommandK upcomingCounts={upcomingCounts} savedCount={savedCount} />
    </>
  );
}
