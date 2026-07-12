'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ARTISTS, ARTIST_LABEL } from '../constants';

export default function ArtistNav({ activeSlug, savedCount = 0, upcomingCounts = {} }: { activeSlug: string | null; savedCount?: number; upcomingCounts?: Record<string, number> }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const activeLabel = activeSlug === 'saved'
    ? `Saved${savedCount > 0 ? ` (${savedCount})` : ''}`
    : activeSlug === 'analytics'
      ? 'Analytics'
      : activeSlug
        ? (ARTIST_LABEL[activeSlug] || activeSlug)
        : 'Overview';

  useEffect(() => {
    if (!open) return;
    // Move focus into the menu — land on the active item (or the first one).
    // preventScroll keeps the window from moving; scroll the menu container instead.
    const item =
      dropdownRef.current?.querySelector<HTMLButtonElement>('.ray-artist-dropdown-item[data-active="true"]') ||
      dropdownRef.current?.querySelector<HTMLButtonElement>('.ray-artist-dropdown-item');
    if (item && dropdownRef.current) {
      item.focus({ preventScroll: true });
      dropdownRef.current.scrollTop = Math.max(0, item.offsetTop - 48);
    }
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
          font-family: var(--font-serif), serif;
          font-style: italic;
          font-weight: 500;
          font-size: 21px;
          line-height: 1;
          letter-spacing: 0.01em;
          color: var(--color-accent-wine-text);
          text-decoration: none;
          white-space: nowrap;
          padding: 6px 0;
          margin: -6px 0;
          transition: opacity var(--duration-fast) var(--ease-signature);
        }
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
          background: color-mix(in srgb, var(--color-accent-wine) 6%, transparent);
          color: var(--color-accent-wine-text);
        }
        /* NOTE: keep this style block free of quotes and angle brackets.
           React HTML-escapes them in server-rendered style text, but the
           browser keeps the escaped entity literally inside a raw-text
           element - the text node then differs between server and client
           and hydration fails. */
        .ray-artist-dropdown-item[data-active=true] {
          color: var(--color-accent-wine-text);
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
          padding: 8px 16px 4px;
          font-family: var(--font-sans), sans-serif;
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.15em;
          text-transform: uppercase;
          color: var(--color-text-faint);
          border-bottom: 1px solid var(--color-border);
        }
        @media (max-width: 768px) {
          .ray-artist-nav { top: 0; }
        }
      `}</style>

      <div className="ray-artist-nav-inner rail">
        <a href="/" className="ray-wordmark" aria-label="Ray — home">Ray</a>

        {/* Desktop quick links — one click to each room; the dropdown stays
            the artist index. Hidden on mobile where the dropdown covers all. */}
        <nav className="ray-nav-links" aria-label="Sections">
          <button className="ray-nav-link" data-active={activeSlug === null} onClick={() => navigate('/')}>Overview</button>
          <button className="ray-nav-link" data-active={activeSlug === 'analytics'} onClick={() => navigate('/analytics')}>Analytics</button>
          <button className="ray-nav-link" data-active={activeSlug === 'saved'} onClick={() => navigate('/saved')}>
            Saved{savedCount > 0 ? ` · ${savedCount}` : ''}
          </button>
        </nav>

        <div className="ray-artist-select-wrap">
        <button
          ref={triggerRef}
          className="ray-artist-select-btn glass glass-pill glass-quiet"
          onClick={() => setOpen(o => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`Navigate Ray — currently: ${activeLabel}`}
        >
          <span>{activeLabel}</span>
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
          <div className="ray-artist-dropdown glass glass-noblur" role="menu" aria-label="Navigate Ray" ref={dropdownRef}>
            <button
              role="menuitem"
              className="ray-artist-dropdown-item"
              data-active={activeSlug === null ? 'true' : 'false'}
              onClick={() => navigate('/')}
            >
              Overview
            </button>
            <button
              role="menuitem"
              className="ray-artist-dropdown-item"
              data-active={activeSlug === 'saved' ? 'true' : 'false'}
              onClick={() => navigate('/saved')}
            >
              Saved{savedCount > 0 ? ` (${savedCount})` : ''}
            </button>
            <button
              role="menuitem"
              className="ray-artist-dropdown-item"
              data-active={activeSlug === 'analytics' ? 'true' : 'false'}
              onClick={() => navigate('/analytics')}
            >
              Analytics
            </button>
            <div className="ray-artist-dropdown-label" role="presentation">Artists</div>
            {ARTISTS.map(a => (
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
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
