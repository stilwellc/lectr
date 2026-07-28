'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { MARKETS } from '../constants';
import { useMarket, MARKET_PATH } from '../lib/market';
import MarketIcon from './MarketIcon';
import { OPEN_CK_EVENT } from './CommandK';

/**
 * M16 + R9 — THE MOBILE DOCK. A fixed bottom bar under 900px (CSS-gated:
 * .lectr-dock displays only <900px, so one mount serves every width) in
 * mobile's ONE true-glass material. Exactly three affordances — no 5-tab
 * app cliché:
 *   [⌘K search pill]  — opens the CommandK palette (full-sheet on phones)
 *   [current market]  — reveals the market pill row (scrolls to it), or
 *                       walks home to the market's lander from inner pages
 *   [Saved · n]       — the watchlist
 * Sits at z 90, UNDER every scrim/sheet/modal (200+), so it never rides
 * inside them; the page shell pads its bottom (globals) so no content or
 * colophon line is ever covered.
 */
export default function MobileDock({ savedCount = 0 }: { savedCount?: number }) {
  const { market } = useMarket();
  const router = useRouter();
  const meta = MARKETS.find(m => m.key === market);
  const marketLabel = market === 'all' ? 'Market' : meta?.label || 'Market';

  const openCk = () => {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(OPEN_CK_EVENT));
  };

  const openMarkets = () => {
    // the pill row lives on the landers — reveal it in place when present,
    // otherwise walk to the active market's lander (where it is).
    const row = document.querySelector('.ray-markets-compact, .ray-markets');
    if (row) {
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      router.push(MARKET_PATH[market] || '/');
    }
  };

  return (
    <nav className="lectr-dock" aria-label="Quick actions">
      <button type="button" className="lectr-dock-search" onClick={openCk} aria-label="Search — makers, markets, live lots">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.35-4.35" />
        </svg>
        <span>Search</span>
        <kbd className="ray-nav-kbd" aria-hidden="true">&#8984;K</kbd>
      </button>
      <button type="button" className="lectr-dock-chip" data-market={market} onClick={openMarkets} aria-label={`Markets — ${marketLabel} active`}>
        <MarketIcon market={market} size={15} />
        <span>{marketLabel}</span>
      </button>
      <Link href="/saved" className="lectr-dock-chip" aria-label={savedCount > 0 ? `Saved — ${savedCount} lots` : 'Saved'}>
        <svg viewBox="0 0 12 14" width="12" height="14" fill="none" aria-hidden="true">
          <path d="M1 1.5C1 1.22386 1.22386 1 1.5 1H10.5C10.7761 1 11 1.22386 11 1.5V12.5C11 12.6894 10.8862 12.8625 10.7096 12.9472C10.533 13.0319 10.3239 13.0136 10.1646 12.8994L6 9.91421L1.83541 12.8994C1.67614 13.0136 1.46698 13.0319 1.29037 12.9472C1.11377 12.8625 1 12.6894 1 12.5V1.5Z" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        <span>Saved</span>
        {savedCount > 0 && <i>{savedCount}</i>}
      </Link>
    </nav>
  );
}
