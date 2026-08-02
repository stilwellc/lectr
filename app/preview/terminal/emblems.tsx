import type { Market } from '../../constants';

/**
 * TERMINAL EMBLEMS — richer, more recognizable little line illustrations of
 * what each vertical actually IS, drawn as a jeweler's monoline (1.6px round
 * caps, currentColor so each context tints them). These are a Terminal-only
 * upgrade of the pill's left glyph: the shared MarketSwitch renders the plainer
 * MarketIcon everywhere else and only swaps to these when the Terminal passes
 * its opt-in `emblems` flag — so no other route changes.
 *
 * Total market = a portfolio grid, Art = a framed painting, Design = a chair in
 * profile, Watches = a wristwatch (dial + lugs + strap), Sports = a two-handled
 * trophy on its plinth, Science = a rocket, Pop Culture = a five-point star.
 */

const PILL: Record<Market, React.ReactNode> = {
  // portfolio grid — four framed holdings, one accented
  all: (
    <>
      <rect x="3.6" y="3.6" width="7.4" height="7.4" rx="1.4" />
      <rect x="13" y="3.6" width="7.4" height="7.4" rx="1.4" />
      <rect x="3.6" y="13" width="7.4" height="7.4" rx="1.4" />
      <rect x="13" y="13" width="7.4" height="7.4" rx="1.4" />
      <path d="M15 17.4l1.6-1.9 1.4 1.2 1.4-1.7" />
    </>
  ),
  // framed painting on the wall — mountain + sun landscape inside the frame
  art: (
    <>
      <rect x="3.8" y="4.2" width="16.4" height="14" rx="1.4" />
      <path d="M6.4 15.4l3.1-4 2.2 2.6 2.3-3.3 3.4 4.7" />
      <circle cx="9" cy="8.4" r="1.15" />
      <path d="M8.6 18.2v1.9M15.4 18.2v1.9" />
    </>
  ),
  // mid-century lounge chair in profile — seat, angled back, splayed leg
  design: (
    <>
      <path d="M6.4 12.6l1.4-6.4a1.5 1.5 0 0 1 1.5-1.2h1.1" />
      <path d="M6.4 12.6h8.6" />
      <path d="M14.8 12.6l1.6-1.1" />
      <path d="M7.2 12.6L5.6 19M13.9 12.6L15.6 19" />
      <path d="M8 15.7h5.2" />
    </>
  ),
  // wristwatch — round dial with hands, crown, and strap lugs
  watches: (
    <>
      <circle cx="12" cy="12" r="5.1" />
      <path d="M12 9.1V12l2 1.4" />
      <path d="M18 11.1h1.4v1.8H18" />
      <path d="M9.7 7.3l.7-3.1h3.2l.7 3.1" />
      <path d="M9.7 16.7l.7 3.1h3.2l.7-3.1" />
    </>
  ),
  // two-handled loving cup trophy on a plinth
  sports: (
    <>
      <path d="M8 4.5h8v3.6a4 4 0 0 1-8 0z" />
      <path d="M8 5.6H5.6a2.7 2.7 0 0 0 2.7 3.1" />
      <path d="M16 5.6h2.4a2.7 2.7 0 0 1-2.7 3.1" />
      <path d="M12 12.1v2.9" />
      <path d="M9.4 15h5.2l-.6 2.4H10z" />
      <path d="M8.6 19.5h6.8" />
    </>
  ),
  // rocket lifting off — nose, body, fins, exhaust flame
  science: (
    <>
      <path d="M12 3.4c2.3 1.9 3.4 4.6 3.4 7.7 0 1.9-.4 3.6-1.1 5H9.7c-.7-1.4-1.1-3.1-1.1-5 0-3.1 1.1-5.8 3.4-7.7z" />
      <circle cx="12" cy="9" r="1.4" />
      <path d="M9.5 14.2L7 16.2l1.2-3.6M14.5 14.2L17 16.2l-1.2-3.6" />
      <path d="M10.9 16.1c.4 1.5.7 2.9 1.1 4 .4-1.1.7-2.5 1.1-4" />
    </>
  ),
  // five-point star — the walk-of-fame star
  culture: (
    <>
      <path d="M12 3.6l2.5 5.1 5.6.8-4.05 3.95.96 5.57L12 16.4l-5.01 2.63.96-5.57L3.9 9.5l5.6-.8z" />
    </>
  ),
};

export default function TerminalEmblem({ market, size = 15 }: { market: Market; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PILL[market]}
    </svg>
  );
}

