import type { Market } from '../constants';

/**
 * MARKET_GLYPHS — the bespoke, constructed line-mark system. Each vertical is
 * distilled to a precision instrument or diagram (the Linear / Robinhood
 * "engineered" grammar), drawn on a shared 24-unit grid in one round-cap
 * stroke, currentColor so every context tints it. A small filled node carries
 * the "reading" in each mark — a quiet thread through the family.
 *
 *   all      the portfolio as a connected node-graph (one holding read)
 *   art      a framed rising index — the artwork as an asset
 *   design   the golden module — proportion drawn as a subdivided arc
 *   watches  a dial — concentric rim, cardinal ticks, one hand
 *   sports   a medal on its ribbon
 *   science  an orbit — nucleus, ellipse, one electron
 *   culture  a constructed five-point star (the walk-of-fame mark)
 */
export const MARKET_GLYPHS: Record<Market, React.ReactNode> = {
  // portfolio hub — four holdings wired to one aggregate index (filled center)
  all: (
    <>
      <path d="M12 12 6.2 6.2M12 12 17.8 6.2M12 12 6.2 17.8M12 12 17.8 17.8" />
      <circle cx="6.2" cy="6.2" r="1.5" />
      <circle cx="17.8" cy="6.2" r="1.5" />
      <circle cx="6.2" cy="17.8" r="1.5" />
      <circle cx="17.8" cy="17.8" r="1.5" />
      <circle cx="12" cy="12" r="2.1" fill="currentColor" stroke="none" />
    </>
  ),
  // framed rising index — the artwork read as an asset; the print top-right
  art: (
    <>
      <rect x="4" y="5" width="16" height="14" rx="1.7" />
      <path d="M7 15l3.4-3.4 2.4 1.9 4.1-4.4" />
      <circle cx="16.9" cy="9.1" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  // the design primitives — a square and a circle, the Bauhaus vocabulary
  design: (
    <>
      <rect x="4.3" y="8" width="9.7" height="9.7" rx="1.3" />
      <circle cx="15.4" cy="11.4" r="5" />
    </>
  ),
  // the dial — concentric rim, four cardinal ticks, one hand, a pinned center
  watches: (
    <>
      <circle cx="12" cy="12" r="7.4" />
      <path d="M12 6.3v1.4M17.7 12h-1.4M12 17.7v-1.4M6.3 12h1.4" />
      <path d="M12 12l3-2.4" />
      <circle cx="12" cy="12" r="1.05" fill="currentColor" stroke="none" />
    </>
  ),
  // the medal on its ribbon
  sports: (
    <>
      <circle cx="12" cy="14.6" r="4.6" />
      <circle cx="12" cy="14.6" r="1.5" />
      <path d="M10.2 10.8 9 4.8M13.8 10.8 15 4.8M9 4.8h6" />
    </>
  ),
  // the orbit — nucleus at center, one electron riding the ellipse
  science: (
    <>
      <ellipse cx="12" cy="12" rx="8.2" ry="3.4" transform="rotate(-22 12 12)" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="19.4" cy="9" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),
  // the constructed five-point star — the walk-of-fame mark
  culture: (
    <>
      <path d="M12 4.5 13.76 9.57 19.13 9.68 14.85 12.93 16.41 18.07 12 15 7.59 18.07 9.15 12.93 4.87 9.68 10.24 9.57Z" />
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
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {MARKET_GLYPHS[market]}
    </svg>
  );
}
