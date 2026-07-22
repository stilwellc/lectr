import type { Market } from '../constants';

/**
 * MarketIcon — one monoline glyph per vertical, drawn in the same 1.8px
 * round-cap stroke family as the rest of the pen-weight ramp. Collectibles = the whole grid, Art = framed
 * gesture, Design = chair in profile, Watches = dial with crown, Sports = the
 * trophy, Science = the flask, Pop Culture = the star on the walk of fame.
 * currentColor so each context tints them.
 */
const GLYPHS: Record<Market, React.ReactNode> = {
  all: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.6" />
      <rect x="13" y="4" width="7" height="7" rx="1.6" />
      <rect x="4" y="13" width="7" height="7" rx="1.6" />
      <rect x="13" y="13" width="7" height="7" rx="1.6" />
    </>
  ),
  art: (
    <>
      <rect x="4" y="4.5" width="16" height="15" rx="1.8" />
      <path d="M7.5 15.5c1.6-3.4 3.4-5 5-5s2.9 1.2 4 2.6" />
      <circle cx="9.2" cy="9" r="1.1" />
    </>
  ),
  design: (
    <>
      <path d="M7.5 4.5V20" />
      <path d="M7.5 13.5H17" />
      <path d="M17 13.5V20" />
      <path d="M7.5 9h7" />
    </>
  ),
  watches: (
    <>
      <circle cx="11.4" cy="12" r="7.3" />
      <path d="M11.4 8.3V12l2.7 1.7" />
      <path d="M19.9 10.4h1.4v3.2h-1.4" />
    </>
  ),
  sports: (
    <>
      <path d="M7.5 4.5h9v4.8a4.5 4.5 0 0 1-9 0z" />
      <path d="M7.5 6H5a3 3 0 0 0 3 3.4" />
      <path d="M16.5 6H19a3 3 0 0 1-3 3.4" />
      <path d="M12 13.8v3.4" />
      <path d="M8.5 19.5h7" />
    </>
  ),
  science: (
    <>
      <path d="M10 4.5v4.2l-4.2 7.9a1.9 1.9 0 0 0 1.7 2.9h9a1.9 1.9 0 0 0 1.7-2.9L14 8.7V4.5" />
      <path d="M8.8 4.5h6.4" />
      <path d="M7.9 13.2h8.2" />
    </>
  ),
  culture: (
    <>
      <path d="M12 3.6l2.5 5.1 5.6.8-4.05 3.95.96 5.57L12 16.4l-5.01 2.63.96-5.57L3.9 9.5l5.6-.8z" />
    </>
  ),
};

export default function MarketIcon({ market, size = 20 }: { market: Market; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {GLYPHS[market]}
    </svg>
  );
}
