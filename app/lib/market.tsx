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
};

const PATH_MARKET: Record<string, Market> = {
  '/': 'all',
  '/collectibles': 'all',
  '/art': 'art',
  '/design': 'design',
  '/watches': 'watches',
  '/science': 'science',
  '/sports': 'sports',
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
    if (onLander && m !== market) window.history.pushState(null, '', MARKET_PATH[m] || '/');
  };

  return (
    <MarketContext.Provider value={{ market, setMarket }}>
      {children}
    </MarketContext.Provider>
  );
}
