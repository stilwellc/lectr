'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Market, MARKETS } from '../constants';

/**
 * The active market — now URL-backed. Each market has a shareable route
 * (/, /art, /design, /watches, /science, /sports); the lander at that path
 * IS that market. On other pages (Value, Artists, a maker page) the market
 * falls back to the last choice, persisted so Ray opens where you left it.
 * The watchlist deliberately ignores it: your lots are your lots.
 */
const KEY = 'ray-market';

export const MARKET_PATH: Record<Market, string> = {
  all: '/',
  art: '/art',
  design: '/design',
  watches: '/watches',
  science: '/science',
  sports: '/sports',
  culture: '/culture',
};

const PATH_MARKET: Record<string, Market> = {
  '/': 'all',
  '/collectibles': 'all',
  '/art': 'art',
  '/design': 'design',
  '/watches': 'watches',
  '/science': 'science',
  '/sports': 'sports',
  '/culture': 'culture',
};

const MarketContext = createContext<{ market: Market; setMarket: (m: Market) => void }>({
  market: 'all',
  setMarket: () => {},
});

export function useMarket() {
  return useContext(MarketContext);
}

// The lander titles, mirrored from each route's metadata — pushState market
// switches move the URL under the mounted board, so the document title has to
// be kept honest by hand (a real navigation would have Next do it).
const MARKET_TITLE: Record<Market, string> = {
  all: 'lectr — auction intelligence',
  art: 'Art — lectr',
  design: 'Design — lectr',
  watches: 'Watches — lectr',
  science: 'Science — lectr',
  sports: 'Sports — lectr',
  culture: 'Pop Culture — lectr',
};

export function MarketProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // static hosting can surface the file path (/watches.html) or a trailing
  // slash — normalize so a deep link still reads as its market
  const normPath = pathname.replace(/\.html$/, '').replace(/\/+$/, '') || '/';
  const urlMarket = PATH_MARKET[normPath]; // defined only on a lander route
  const onLander = urlMarket !== undefined;

  const [stored, setStored] = useState<Market>('all');

  // hydrate the last choice for the non-lander pages
  useEffect(() => {
    try {
      const s = localStorage.getItem(KEY) as Market | null;
      if (s && MARKETS.some(m => m.key === s)) setStored(s);
    } catch { /* first visit */ }
  }, []);

  // landing on /watches etc. remembers that as the choice. Landing on /
  // still DISPLAYS the total market (URL is truth for display) but no
  // longer stomps the stored vertical choice.
  useEffect(() => {
    if (urlMarket && urlMarket !== 'all') {
      setStored(urlMarket);
      try { localStorage.setItem(KEY, urlMarket); } catch { /* private mode */ }
    }
  }, [urlMarket]);

  const market = onLander ? urlMarket : stored;

  // THE TAPE PRINTS — a pushState'd market switch leaves the title behind, so
  // keep it read true (covers back/forward too; harmlessly re-asserts the
  // metadata title on a real navigation).
  useEffect(() => {
    if (onLander) document.title = MARKET_TITLE[urlMarket];
  }, [onLander, urlMarket]);

  // SCROLL LEDGER (audit-navbugs defect 2): the lander's market switch moves
  // the URL under the mounted board via raw pushState, and the browser's own
  // popstate restore then lands at the wrong offset (measured: old
  // scrollHeight minus viewport — the footer). We keep our own book: stamp
  // the CURRENT entry's scroll into history.state at scroll-end, restore it
  // explicitly on popstate (double-rAF, after the board re-reads). Spread
  // preserves Next's internal state; entries without a stamp are left to the
  // browser untouched.
  useEffect(() => {
    let t = 0;
    const stamp = () => {
      try { window.history.replaceState({ ...window.history.state, __lectrScroll: window.scrollY }, ''); } catch { /* ignore */ }
    };
    const onScroll = () => {
      if (t) window.clearTimeout(t);
      t = window.setTimeout(() => { t = 0; stamp(); }, 250);
    };
    stamp();
    window.addEventListener('scroll', onScroll, { passive: true });
    const onPop = (e: PopStateEvent) => {
      const y = e.state && typeof e.state.__lectrScroll === 'number' ? e.state.__lectrScroll as number : null;
      if (y == null) return;
      requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, y)));
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('popstate', onPop);
      if (t) window.clearTimeout(t);
    };
  }, []);

  const setMarket = (m: Market) => {
    setStored(m);
    try { localStorage.setItem(KEY, m); } catch { /* private mode */ }
    // On a lander, the market is the URL — but every market route re-exports
    // the same page component, so a router.push would remount the whole board
    // for nothing (needle re-parks at −80°, numerals restart from 0, the call
    // plate blanks). Instead the URL moves UNDER the mounted board: Next 14.1
    // patches history.pushState to sync the app router (usePathname updates,
    // the segment tree is untouched, popstate restores the same way), so the
    // switch lands as a prop change and every instrument re-reads in place.
    if (onLander && m !== market) window.history.pushState({ __lectrScroll: window.scrollY }, '', MARKET_PATH[m] || '/');
  };

  return (
    <MarketContext.Provider value={{ market, setMarket }}>
      {children}
    </MarketContext.Provider>
  );
}
