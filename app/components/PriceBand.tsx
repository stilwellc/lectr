'use client';
/**
 * PriceBand (moved out of ComparableModal.tsx, perf wave W27 — pure move):
 * the /value desk's call plate draws it on the first screen, and importing
 * it from the modal module shipped the whole lot modal (~40 KB brotli) in
 * the desk's first-load JS.
 */
import { fmtFace } from '../lib/lot-face';

/**
 * PriceBand — the decision picture. Every comparable sale plotted as a dot on
 * a log price axis, the median marked, and this lot's estimate drawn as a
 * band over it — so "is this cheap?" is readable at a glance: estimate band
 * left of the dot cloud = priced under the market.
 */
export default function PriceBand({
  prices,
  median,
  estLow,
  estHigh,
  below,
}: {
  prices: number[];
  median: number;
  estLow: number | null;
  estHigh: number | null;
  below: boolean | null;
}) {
  // last line of defense for the log axis: one undefined/NaN/≤0 price in the
  // pool would pass the lo/hi guard (NaN compares false) and emit cx="NaN%"
  prices = prices.filter(p => Number.isFinite(p) && p > 0);
  if (prices.length < 3) return null;
  const all = [...prices, ...(estLow ? [estLow] : []), ...(estHigh ? [estHigh] : [])];
  const lo = Math.min(...all) * 0.9;
  const hi = Math.max(...all) * 1.1;
  if (lo <= 0 || hi <= lo) return null;
  const x = (v: number) => ((Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))) * 100;
  const bandColor = below === true ? 'var(--color-up)' : 'var(--color-text-faint)';
  // (r8) the face formatter — the strip's median reads exactly as the plate's row
  const fmt = (n: number) => fmtFace(n);
  return (
    <div style={{ padding: '20px 28px 6px' }}>
      <svg width="100%" height="76" style={{ display: 'block', overflow: 'visible' }} aria-label="Comparable sales vs estimate">
        {/* axis */}
        <line x1="0" y1="44" x2="100%" y2="44" stroke="var(--color-border-mid)" strokeWidth="1" />
        {/* estimate band */}
        {estLow && estHigh && (
          <>
            <rect
              x={`${x(estLow)}%`}
              y="30"
              width={`${Math.max(x(estHigh) - x(estLow), 1.2)}%`}
              height="28"
              rx="4"
              fill={bandColor}
              opacity="0.16"
            />
            <rect
              x={`${x(estLow)}%`}
              y="30"
              width={`${Math.max(x(estHigh) - x(estLow), 1.2)}%`}
              height="28"
              rx="4"
              fill="none"
              stroke={bandColor}
              strokeOpacity="0.7"
              strokeWidth="1.25"
            />
            <text x={`${(x(estLow) + x(estHigh)) / 2}%`} y="74" textAnchor={(x(estLow) + x(estHigh)) / 2 > 85 ? 'end' : (x(estLow) + x(estHigh)) / 2 < 15 ? 'start' : 'middle'} fill={bandColor} fontSize="11" fontWeight="500" fontFamily="var(--font-sans)">
              this estimate
            </text>
          </>
        )}
        {/* comp dots */}
        {prices.map((p, i) => (
          <circle key={i} cx={`${x(p)}%`} cy="44" r="3.5" fill="var(--color-text-muted)" opacity="0.55" />
        ))}
        {/* median */}
        <line x1={`${x(median)}%`} y1="26" x2={`${x(median)}%`} y2="62" stroke="var(--color-fg)" strokeWidth="1.5" />
        <text x={`${x(median)}%`} y="16" textAnchor={x(median) > 80 ? 'end' : x(median) < 20 ? 'start' : 'middle'} fill="var(--color-fg)" fontSize="11" fontWeight="500" fontFamily="var(--font-sans)">
          comps median {fmt(median)}
        </text>
      </svg>
    </div>
  );
}

export { PriceBand };
