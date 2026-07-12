'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Market, MARKETS } from '../constants';

/**
 * The active market — now URL-backed. Each market has a shareable route
 * (/, /art, /design, /watches, /science, /sports); the lander at that path
 * IS that market. On other pages (Value, Artists, a maker page) the market
 * falls back to the last choice, persisted so Ray opens where you left it.
 * The watchlist deliberately ignores it: your lots are your lots.
 */
const KEY = 'ray-market';

const MARKET_PATH: Record<Market, string> = {
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

export function MarketProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const urlMarket = PATH_MARKET[pathname]; // defined only on a lander route
  const onLander = urlMarket !== undefined;

  const [stored, setStored] = useState<Market>('all');

  // hydrate the last choice for the non-lander pages
  useEffect(() => {
    try {
      const s = localStorage.getItem(KEY) as Market | null;
      if (s && MARKETS.some(m => m.key === s)) setStored(s);
    } catch { /* first visit */ }
  }, []);

  // landing on /watches etc. remembers that as the choice
  useEffect(() => {
    if (urlMarket) {
      setStored(urlMarket);
      try { localStorage.setItem(KEY, urlMarket); } catch { /* private mode */ }
    }
  }, [urlMarket]);

  const market = onLander ? urlMarket : stored;

  const setMarket = (m: Market) => {
    setStored(m);
    try { localStorage.setItem(KEY, m); } catch { /* private mode */ }
    // on a lander, the market is the URL — navigate so it stays shareable
    if (onLander && m !== market) router.push(MARKET_PATH[m] || '/');
  };

  return (
    <MarketContext.Provider value={{ market, setMarket }}>
      {children}
    </MarketContext.Provider>
  );
}
