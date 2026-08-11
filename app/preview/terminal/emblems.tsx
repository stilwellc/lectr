import type { Market } from '../../constants';
import { MARKET_GLYPHS } from '../../components/MarketIcon';

/**
 * TERMINAL EMBLEM — the lander pills render the same bespoke constructed
 * line-mark system as everywhere else (see MARKET_GLYPHS in MarketIcon), just
 * a touch finer to sit inside a pill. One icon language across the whole app.
 */
export default function TerminalEmblem({ market, size = 15 }: { market: Market; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {MARKET_GLYPHS[market]}
    </svg>
  );
}
