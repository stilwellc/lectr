'use client';

import { useEffect, useMemo, useRef } from 'react';
import { AuctionLot } from '../types';
import { ARTIST_LABEL } from '../constants';
import { houseColors, categoryLabels, categoryColors, formatDate, formatPrice } from '../utils';

function formatEstimate(lot: AuctionLot): string {
  const fmt = (n: number) => {
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
    return `$${n.toLocaleString()}`;
  };
  if (lot.estimateLow && lot.estimateHigh) {
    return `${fmt(lot.estimateLow)} — ${fmt(lot.estimateHigh)} ${lot.currency}`;
  }
  return 'Estimate on request';
}

/** Convert fraction characters (½, ¼, etc.), slash fractions (3/8), and mixed numbers to decimals */
function parseFrac(s: string): number {
  const fracs: Record<string, number> = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 0.333, '⅔': 0.667, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 };
  // Strip non-numeric prefixes like "I." or "S." (image/sheet size labels)
  const cleaned = s.replace(/^[A-Za-z.]+\s*/, '').trim();
  let val = 0;
  // Try: "10 3/8" or "23 1/4" (integer + slash fraction)
  const mixedSlash = cleaned.match(/^(\d+)\s+(\d+)\/(\d+)/);
  if (mixedSlash) {
    return parseFloat(mixedSlash[1]) + parseFloat(mixedSlash[2]) / parseFloat(mixedSlash[3]);
  }
  // Try standalone slash fraction "3/8"
  const slashFrac = cleaned.match(/^(\d+)\/(\d+)/);
  if (slashFrac) {
    return parseFloat(slashFrac[1]) / parseFloat(slashFrac[2]);
  }
  // Match leading integer/decimal
  const intMatch = cleaned.match(/^(\d+\.?\d*)/);
  if (intMatch) val += parseFloat(intMatch[1]);
  // Match trailing unicode fraction character
  for (const [ch, n] of Object.entries(fracs)) {
    if (cleaned.includes(ch)) { val += n; break; }
  }
  // If nothing matched, try decimal parse
  if (val === 0) val = parseFloat(cleaned) || 0;
  return val;
}

/** Parse a dimension string into [height, width] or null.
 *  Handles: "24 x 18 in", "25¼ h × 20¾ w in", "63 × 52 cm",
 *  "99.8 by 73 cm.", "I. 23 1/4 x 39 3/4 in. (59.1 x 101 cm)S. ..." */
function parseDims(dims: string | null): [number, number] | null {
  if (!dims) return null;
  // For Image/Sheet format, extract just the first measurement block
  // e.g., "I. 23 1/4 x 39 3/4 in. (59.1 x 101 cm)S. 30 3/8 x 45 3/4 in."
  let str = dims;
  const sheetMatch = dims.match(/[IS]\.\s*(.+?)(?:\(|[IS]\.|$)/);
  if (sheetMatch) str = sheetMatch[1].trim();
  // Prefer inches; fall back to cm
  const useIn = str.toLowerCase().includes('in');
  // Split on "x", "×", or "by"
  const tokens = str.split(/\s*(?:[x×]|\bby\b)\s*/i).map(t => t.trim());
  if (tokens.length < 2) return null;
  const h = parseFrac(tokens[0]);
  const w = parseFrac(tokens[1]);
  if (!h || !w) return null;
  // Normalize cm to inches for consistent comparison
  if (!useIn && str.toLowerCase().includes('cm')) {
    return [h / 2.54, w / 2.54];
  }
  return [h, w];
}

function parseArea(dims: string | null): number | null {
  const hw = parseDims(dims);
  return hw ? hw[0] * hw[1] : null;
}

/** Parse a year string like "2000" or "circa 2000" into a number */
function parseYear(y: string | null): number | null {
  if (!y) return null;
  const m = y.match(/(\d{4})/);
  return m ? parseInt(m[1]) : null;
}

/** Simple word overlap score between two medium strings (0-1) */
function mediumSimilarity(a: string | null, b: string | null): number {
  if (!a || !b) return 0;
  const wordsA = new Set(a.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(Boolean));
  const wordsB = new Set(b.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(Boolean));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let overlap = 0;
  Array.from(wordsA).forEach(w => { if (wordsB.has(w)) overlap++; });
  return overlap / Math.max(wordsA.size, wordsB.size);
}

/** Classify medium into sub-type for finer matching within "original" category */
function mediumClass(medium: string | null): string | null {
  if (!medium) return null;
  const m = medium.toLowerCase();
  if (/oil|acrylic|enamel/.test(m) && /canvas|linen|panel|board/.test(m)) return 'painting';
  if (/pencil|charcoal|graphite|crayon|ink|pastel|watercolor|gouache|marker/.test(m)) return 'work-on-paper';
  if (/screen\s*print|lithograph|etching|woodcut|gicl[eé]e|print|engraving|aquatint|monoprint/.test(m)) return 'print';
  if (/bronze|ceramic|resin|marble|plaster/.test(m)) return 'sculpture';
  if (/canvas|linen|panel/.test(m)) return 'painting';
  if (/paper/.test(m)) return 'work-on-paper';
  return null;
}

function scoreComparable(upcoming: AuctionLot, sold: AuctionLot): number {
  let score = 0;

  // Medium sub-class match (weight: 25) — distinguishes sketches from paintings
  const classA = mediumClass(upcoming.medium);
  const classB = mediumClass(sold.medium);
  if (classA && classB) {
    if (classA === classB) score += 25;
    else score += 3;
  }
  // Word-level medium similarity as tiebreaker (weight: 5)
  score += mediumSimilarity(upcoming.medium, sold.medium) * 5;

  // Dimensions similarity (weight: 35) — critical for matching scale
  const areaA = parseArea(upcoming.dimensions);
  const areaB = parseArea(sold.dimensions);
  if (areaA && areaB) {
    const ratio = Math.min(areaA, areaB) / Math.max(areaA, areaB);
    score += ratio * 35;
  }

  // Estimate proximity (weight: 25) — good proxy for importance/scale
  const estMid = upcoming.estimateLow && upcoming.estimateHigh
    ? (upcoming.estimateLow + upcoming.estimateHigh) / 2
    : null;
  if (estMid && sold.priceUsd) {
    const ratio = Math.min(estMid, sold.priceUsd) / Math.max(estMid, sold.priceUsd);
    score += ratio * 25;
  }

  // Year proximity (weight: 10)
  const yearA = parseYear(upcoming.year);
  const yearB = parseYear(sold.year);
  if (yearA && yearB) {
    const diff = Math.abs(yearA - yearB);
    score += Math.max(0, 1 - diff / 50) * 10;
  }

  return score;
}

const MAX_COMPARABLES = 15;

export default function ComparableModal({
  lot,
  allLots,
  onClose,
}: {
  lot: AuctionLot;
  allLots: AuctionLot[];
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Focus management: move focus into the dialog on open, trap Tab inside
  // the panel, and restore focus to the triggering element on close.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeBtnRef.current?.focus();

    const trapTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !panelRef.current) return;
      const focusables = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      const inside = active instanceof Node && panelRef.current.contains(active);
      if (e.shiftKey) {
        if (active === first || !inside) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !inside) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', trapTab);
    return () => {
      window.removeEventListener('keydown', trapTab);
      previouslyFocused?.focus();
    };
  }, []);

  // Lock body scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  const comparables = useMemo(() => {
    const sold = allLots.filter(l =>
      l.artist === lot.artist &&
      l.status === 'sold' &&
      l.priceUsd &&
      l.id !== lot.id &&
      // Hard filter: category must match (prints comp prints, originals comp originals, etc.)
      (lot.category === 'unknown' || l.category === 'unknown' || l.category === lot.category)
    );

    const scored = sold.map(s => ({
      lot: s,
      score: scoreComparable(lot, s),
    }));

    // Sort by score desc, then by most recent sale date as tiebreaker
    scored.sort((a, b) => {
      if (Math.abs(a.score - b.score) > 0.01) return b.score - a.score;
      return new Date(b.lot.saleDate).getTime() - new Date(a.lot.saleDate).getTime();
    });

    return scored.slice(0, MAX_COMPARABLES);
  }, [lot, allLots]);

  const compStats = useMemo(() => {
    if (comparables.length === 0) return null;
    const prices = comparables.map(c => c.lot.priceUsd!).sort((a, b) => a - b);
    const median = prices.length % 2 === 0
      ? (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2
      : prices[Math.floor(prices.length / 2)];
    const low = prices[0];
    const high = prices[prices.length - 1];
    const estMid = lot.estimateLow && lot.estimateHigh
      ? (lot.estimateLow + lot.estimateHigh) / 2
      : null;
    const aboveEst = estMid ? prices.filter(p => p >= estMid).length : 0;
    const hammerVsEst = estMid ? median / estMid : null;
    return { median, low, high, aboveEst, total: prices.length, hammerVsEst };
  }, [comparables, lot]);

  const houseColor = houseColors[lot.auctionHouse] || 'var(--color-text-secondary)';
  const catLabel = categoryLabels[lot.category] || null;
  const catColor = categoryColors[lot.category] || 'var(--color-text-faint)';

  return (
    <div
      onClick={onClose}
      role="presentation"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        padding: 0,
      }}
    >
      <style>{`
        .comp-modal-row:hover { background: var(--color-bg-elevated) !important; }
        .comp-modal-close:hover { color: var(--color-fg) !important; }
        .comp-modal-panel {
          width: 100%;
          max-width: 720px;
          max-height: calc(100vh - 40px);
          border-radius: 20px 20px 0 0;
          overflow: auto;
        }
        .comp-modal-header {
          display: flex;
          gap: 0;
        }
        .comp-modal-img {
          width: 200px;
          min-height: 200px;
        }
        .comp-modal-header-info { padding: 28px 28px; }
        .comp-modal-comps { padding: 24px 28px 32px; }
        .comp-modal-row-inner {
          display: flex;
          align-items: center;
          gap: 14px;
        }
        .comp-modal-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
          align-items: center;
        }
        .comp-modal-meta-dims { display: inline; }
        .comp-modal-thumb {
          width: 52px;
          height: 52px;
        }
        .comp-modal-price { text-align: right; }
        @media (min-width: 769px) {
          .comp-modal-panel {
            align-self: center;
            border-radius: 20px;
            margin: 20px;
            max-height: calc(100vh - 40px);
          }
        }
        @media (max-width: 768px) {
          .comp-modal-header { flex-direction: column !important; }
          .comp-modal-img { width: 100% !important; height: 180px !important; min-height: auto !important; }
          .comp-modal-header-info { padding: 20px 20px !important; }
          .comp-modal-stats { padding: 14px 16px !important; }
          .comp-modal-comps { padding: 20px 16px 28px !important; }
          .comp-modal-row-inner { gap: 10px !important; }
          .comp-modal-thumb { width: 44px !important; height: 44px !important; }
          .comp-modal-meta-dims { display: none !important; }
          .comp-modal-price { min-width: 60px; }
        }
      `}</style>
      <div
        ref={panelRef}
        onClick={e => e.stopPropagation()}
        className="comp-modal-panel glass"
        role="dialog"
        aria-modal="true"
        aria-label={`Comparable sales for ${lot.title}`}
        style={{
          position: 'relative',
        }}
      >
        {/* Close button */}
        <button
          ref={closeBtnRef}
          className="comp-modal-close"
          onClick={onClose}
          aria-label="Close"
          style={{
            position: 'sticky',
            top: 12,
            float: 'right',
            marginRight: 12,
            marginTop: 12,
            background: 'var(--color-bg-elevated)',
            border: '1px solid var(--color-border)',
            borderRadius: 100,
            width: 32,
            height: 32,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            color: 'var(--color-text-faint)',
            fontSize: 16,
            zIndex: 2,
            transition: 'color var(--duration-fast) var(--ease-signature)',
          }}
        >
          &times;
        </button>

        {/* Header: image + lot info */}
        <div className="comp-modal-header" style={{
          borderBottom: '1px solid var(--color-border)',
        }}>
          <div className="comp-modal-img" style={{
            flexShrink: 0,
            background: `linear-gradient(135deg, var(--color-bg-elevated) 0%, var(--color-bg) 100%)`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}>
            {lot.imageUrl ? (
              <img
                src={lot.imageUrl}
                alt={lot.title}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              <div style={{
                fontFamily: "var(--font-serif), serif",
                fontSize: 56,
                fontWeight: 300,
                color: 'var(--color-text-faint)',
                opacity: 0.3,
                fontStyle: 'italic',
              }}>
                {lot.title.charAt(0)}
              </div>
            )}
          </div>

          <div className="comp-modal-header-info" style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <span style={{
                fontSize: 12,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: houseColor,
                fontWeight: 600,
              }}>
                {lot.auctionHouse}
              </span>
              {catLabel && lot.category !== 'unknown' && (
                <>
                  <span style={{ color: 'var(--color-text-faint)', fontSize: 12 }}>&middot;</span>
                  <span style={{
                    fontSize: 12,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    color: catColor,
                    fontWeight: 600,
                  }}>
                    {catLabel}
                  </span>
                </>
              )}
            </div>

            <div style={{
              fontSize: 12,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--color-text-muted)',
              fontWeight: 600,
              marginBottom: 4,
            }}>
              {ARTIST_LABEL[lot.artist] || lot.artist}
            </div>

            <h2 style={{
              fontFamily: "var(--font-serif), serif",
              fontSize: 22,
              fontWeight: 400,
              lineHeight: 1.25,
              marginBottom: 4,
            }}>
              {lot.title}
            </h2>

            {lot.year && (
              <div style={{ fontSize: 12, color: 'var(--color-text-faint)', marginBottom: 10 }}>
                {lot.year}{lot.medium ? ` · ${lot.medium}` : ''}
              </div>
            )}

            <div style={{ fontSize: 16, color: 'var(--color-fg)', fontWeight: 500, marginBottom: 3 }}>
              {formatEstimate(lot)}
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-text-faint)' }}>
              {formatDate(lot.saleDate, { month: 'long', day: 'numeric', year: 'numeric' })}
              {lot.saleName ? ` · ${lot.saleName}` : ''}
            </div>

            <a
              href={lot.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                marginTop: 14,
                padding: '8px 20px',
                borderRadius: 100,
                background: 'var(--color-accent-wine)',
                color: 'var(--color-bg)',
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                textDecoration: 'none',
                transition: 'opacity var(--duration-fast) var(--ease-signature)',
                alignSelf: 'flex-start',
              }}
            >
              View Lot &#8599;
            </a>
          </div>
        </div>

        {/* Summary Stats */}
        {compStats && (
          <div className="comp-modal-stats" style={{
            padding: '18px 28px',
            borderBottom: '1px solid var(--color-border)',
            display: 'flex',
            gap: 0,
          }}>
            <div style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ fontSize: 18, fontWeight: 500, color: 'var(--color-fg)', fontFamily: "var(--font-serif), serif" }}>
                {formatPrice(compStats.median)}
              </div>
              <div style={{ fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-text-faint)', marginTop: 3 }}>
                Median
              </div>
            </div>
            <div style={{ width: 1, background: 'var(--color-border)', margin: '0 4px' }} />
            <div style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ fontSize: 18, fontWeight: 500, color: 'var(--color-fg)', fontFamily: "var(--font-serif), serif" }}>
                {formatPrice(compStats.low)} — {formatPrice(compStats.high)}
              </div>
              <div style={{ fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-text-faint)', marginTop: 3 }}>
                Range
              </div>
            </div>
            {compStats.hammerVsEst !== null && (
              <>
                <div style={{ width: 1, background: 'var(--color-border)', margin: '0 4px' }} />
                <div style={{ flex: 1, textAlign: 'center' }}>
                  <div style={{
                    fontSize: 18,
                    fontWeight: 500,
                    fontFamily: "var(--font-serif), serif",
                    color: 'var(--color-fg)',
                  }}>
                    {compStats.hammerVsEst >= 1 ? '+' : ''}{((compStats.hammerVsEst - 1) * 100).toFixed(0)}%
                  </div>
                  <div style={{ fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-text-faint)', marginTop: 3 }}>
                    vs. Est.
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Comparables */}
        <div className="comp-modal-comps">
          <div style={{
            fontSize: 12,
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            color: 'var(--color-text-muted)',
            fontWeight: 600,
            marginBottom: 16,
          }}>
            Comparable Sales ({comparables.length})
          </div>

          {comparables.length === 0 ? (
            <div style={{
              padding: '40px 0',
              textAlign: 'center',
              color: 'var(--color-text-faint)',
              fontSize: 13,
            }}>
              No comparable sold lots found for this artist.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {comparables.map(({ lot: comp, score }, i) => {
                const compHouseColor = houseColors[comp.auctionHouse] || 'var(--color-text-secondary)';
                const estMid = lot.estimateLow && lot.estimateHigh
                  ? (lot.estimateLow + lot.estimateHigh) / 2
                  : null;
                const ratio = estMid && comp.priceUsd
                  ? comp.priceUsd / estMid
                  : null;

                return (
                  <a
                    key={comp.id}
                    href={comp.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="comp-modal-row"
                    style={{
                      display: 'block',
                      padding: '10px 12px',
                      borderRadius: 12,
                      textDecoration: 'none',
                      color: 'inherit',
                      transition: 'background var(--duration-fast) var(--ease-signature)',
                    }}
                  >
                    <div className="comp-modal-row-inner">
                      {/* Rank */}
                      <span style={{
                        fontSize: 12,
                        color: 'var(--color-text-faint)',
                        fontWeight: 500,
                        width: 16,
                        textAlign: 'right',
                        flexShrink: 0,
                      }}>
                        {i + 1}
                      </span>

                      {/* Thumbnail */}
                      <div className="comp-modal-thumb" style={{
                        borderRadius: 8,
                        overflow: 'hidden',
                        flexShrink: 0,
                        background: 'var(--color-bg-elevated)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}>
                        {comp.imageUrl ? (
                          <img src={comp.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                          <span style={{
                            fontFamily: "var(--font-serif), serif",
                            fontSize: 18,
                            color: 'var(--color-text-faint)',
                            opacity: 0.3,
                            fontStyle: 'italic',
                          }}>
                            {comp.title.charAt(0)}
                          </span>
                        )}
                      </div>

                      {/* Info */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: 14,
                          fontFamily: "var(--font-serif), serif",
                          fontWeight: 500,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          marginBottom: 3,
                        }}>
                          {comp.title}
                        </div>
                        <div className="comp-modal-meta" style={{
                          fontSize: 12,
                          color: 'var(--color-text-faint)',
                        }}>
                          <span style={{ color: compHouseColor, fontWeight: 600 }}>{comp.auctionHouse}</span>
                          <span>&middot;</span>
                          <span>{formatDate(comp.saleDate, { month: 'short', year: 'numeric' })}</span>
                          {comp.medium && (
                            <>
                              <span>&middot;</span>
                              <span style={{
                                maxWidth: 140,
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}>{comp.medium}</span>
                            </>
                          )}
                          {comp.dimensions && (
                            <span className="comp-modal-meta-dims">
                              <span>&middot; </span>
                              {comp.dimensions}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Price + ratio */}
                      <div className="comp-modal-price" style={{ flexShrink: 0 }}>
                        <div style={{
                          fontSize: 14,
                          fontWeight: 500,
                          color: 'var(--color-fg)',
                        }}>
                          {formatPrice(comp.priceUsd!)}
                        </div>
                        {ratio !== null && (
                          <div style={{
                            fontSize: 12,
                            color: 'var(--color-text-secondary)',
                            fontWeight: 500,
                          }}>
                            {ratio >= 1 ? '+' : ''}{((ratio - 1) * 100).toFixed(0)}% est.
                          </div>
                        )}
                      </div>
                    </div>
                  </a>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
