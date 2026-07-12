'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { Market, MARKETS } from '../constants';

/**
 * The active market — one choice that the whole instrument honors (home,
 * Value, Artists, Analytics). Persisted so Ray opens where you left it.
 * The watchlist deliberately ignores it: your lots are your lots.
 */
const KEY = 'ray-market';

const MarketContext = createContext<{ market: Market; setMarket: (m: Market) => void }>({
  market: 'all',
  setMarket: () => {},
});

export function useMarket() {
  return useContext(MarketContext);
}

export function MarketProvider({ children }: { children: React.ReactNode }) {
  const [market, setMarketState] = useState<Market>('all');

  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY) as Market | null;
      if (saved && MARKETS.some(m => m.key === saved && m.live)) setMarketState(saved);
    } catch { /* first visit */ }
  }, []);

  const setMarket = (m: Market) => {
    setMarketState(m);
    try { localStorage.setItem(KEY, m); } catch { /* private mode */ }
  };

  return (
    <MarketContext.Provider value={{ market, setMarket }}>
      {children}
    </MarketContext.Provider>
  );
}
