'use client';

import { MARKETS } from '../constants';
import { useMarket } from '../lib/market';

/**
 * MarketSwitch — the verticals. Art and Design are live; Watches, Sports and
 * Science are announced. Selecting a coming market shows its preview state
 * (the lander handles that); the choice persists across every page.
 */
export default function MarketSwitch({ compact = false }: { compact?: boolean }) {
  const { market, setMarket } = useMarket();
  return (
    <div className={`ray-markets${compact ? ' ray-markets-compact' : ''}`} role="tablist" aria-label="Markets">
      {MARKETS.map(m => (
        <button
          key={m.key}
          role="tab"
          aria-selected={market === m.key}
          className="ray-market-tab"
          data-active={market === m.key}
          data-live={m.live}
          onClick={() => setMarket(m.key)}
        >
          {m.label}
          {!m.live && <span className="ray-market-soon">soon</span>}
        </button>
      ))}
    </div>
  );
}
