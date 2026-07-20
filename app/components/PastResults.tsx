'use client';

import React, { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { AuctionLot } from '../types';
import type { LotCategory } from '../types';
import { ARTIST_LABEL, marketOf } from '../constants';
import { houseColors, formatDate, formatPrice, categoryLabels, categoryColors, craftTitle } from '../utils';
import { isSportsScienceObject, sportsForm, classifyForm, FORM_LABEL, cleanGoldinTitle } from '../lib/comps';
import SectionMark from './SectionMark';

/** Known irregular plurals the naive strip-s would mangle ("wristwatches" →
 *  "wristwatche"). Checked before the default rule. */
const SINGULAR: Record<string, string> = {
  wristwatches: 'wristwatch',
  benches: 'bench',
  tables: 'table',
};

/** For a sports/science object lot, a human sub-label ("game-worn jersey",
 *  "ticket") in place of the raw "Object" category badge. sportsForm covers
 *  the sports slugs; science slugs fall back to the frozen classifyForm form.
 *  Returns null for every non-sports/science lot — art/design rows unchanged. */
function objectSubLabel(lot: AuctionLot): string | null {
  if (!isSportsScienceObject(lot)) return null;
  const form = sportsForm(lot) ?? classifyForm(lot);
  const label = FORM_LABEL[form];
  if (!label) return null;
  // FORM_LABEL is plural ("game-worn jerseys"); a per-row badge reads as a
  // single object, so singularize a clean single-word plural ("jerseys" →
  // "jersey"). Multi-word forms ("tickets & passes", "trophies & awards")
  // stay as-is rather than mangle a compound.
  if (/[ &]/.test(label)) return label;
  if (SINGULAR[label]) return SINGULAR[label];
  // an unmapped -ches/-ses plural keeps its plural rather than lose the -e
  if (label.endsWith('ches') || label.endsWith('ses')) return label;
  return label.endsWith('s') && !label.endsWith('ss') ? label.slice(0, -1) : label;
}

type SortMode = 'date' | 'price';
type CategoryFilter = 'all' | LotCategory;

interface Props {
  lots: AuctionLot[];
  showArtist?: boolean;
  categoryFilter?: CategoryFilter;
  onCategoryChange?: (cat: CategoryFilter) => void;
  savedIds?: string[];
  onToggleSave?: (lotId: string, lot?: AuctionLot) => void;
  /** collection mode (the authed /saved view only): mark past lots as OWNED */
  ownedIds?: string[];
  onToggleOwned?: (lotId: string) => void;
  /** ghost ordinal behind the h2 band (headers only) */
  mark?: string;
  /** small verdict line under the header (e.g. /saved's "how your eye did") */
  sub?: React.ReactNode;
}

export default function PastResults({ lots, showArtist = false, categoryFilter: externalFilter, onCategoryChange, savedIds = [], onToggleSave, ownedIds = [], onToggleOwned, mark, sub }: Props) {
  const [visible, setVisible] = useState(20);
  const [sortBy, setSortBy] = useState<SortMode>('date');
  const [internalFilter, setInternalFilter] = useState<CategoryFilter>('all');
  const [sportFilter, setSportFilter] = useState<string>('all');

  const categoryFilter = externalFilter ?? internalFilter;
  const setCategoryFilter = (cat: CategoryFilter) => {
    if (onCategoryChange) {
      onCategoryChange(cat);
    } else {
      setInternalFilter(cat);
    }
    setVisible(20);
  };

  useEffect(() => {
    if (externalFilter !== undefined) setVisible(20);
  }, [externalFilter]);

  const availableCategories = useMemo(() => {
    const cats = new Set<string>();
    for (const lot of lots) {
      if (lot.category && lot.category !== 'unknown') cats.add(lot.category);
    }
    return Array.from(cats).sort();
  }, [lots]);

  // SPORT chips — derived from the data, so they appear automatically when it
  // supports them: every lot is a sports-vertical lot AND >=2 distinct sports
  // exist (a null sport files under "Other"). [sport, count] pairs, biggest
  // sport first, Other pinned last. Counts are over the unfiltered pool,
  // mirroring availableCategories.
  const sportGroups = useMemo(() => {
    if (!lots.length || !lots.every(l => marketOf(l.artist) === 'sports')) return null;
    const counts = new Map<string, number>();
    for (const l of lots) counts.set(l.sport || 'Other', (counts.get(l.sport || 'Other') || 0) + 1);
    if (counts.size < 2) return null;
    return Array.from(counts.entries()).sort((a, b) =>
      a[0] === 'Other' ? 1 : b[0] === 'Other' ? -1 : b[1] - a[1]);
  }, [lots]);

  const filtered = useMemo(() => {
    let out = categoryFilter === 'all' ? lots : lots.filter(l => l.category === categoryFilter);
    if (sportGroups && sportFilter !== 'all') out = out.filter(l => (l.sport || 'Other') === sportFilter);
    return out;
  }, [lots, categoryFilter, sportGroups, sportFilter]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    if (sortBy === 'price') {
      copy.sort((a, b) => (b.priceUsd || 0) - (a.priceUsd || 0));
      return copy;
    }
    // 'date' = most recent, but round-robin across houses so every house
    // surfaces near the top instead of one high-volume house monopolizing
    // the view (e.g. Bonhams burying Sotheby's / Christie's / Phillips).
    copy.sort((a, b) => new Date(b.saleDate).getTime() - new Date(a.saleDate).getTime());
    const groups = new Map<string, typeof copy>();
    for (const l of copy) {
      const g = groups.get(l.auctionHouse) || [];
      g.push(l);
      groups.set(l.auctionHouse, g);
    }
    if (groups.size < 2) return copy;
    const queues = Array.from(groups.values());
    const woven: typeof copy = [];
    for (let i = 0; woven.length < copy.length; i++) {
      for (const q of queues) if (i < q.length) woven.push(q[i]);
    }
    return woven;
  }, [filtered, sortBy]);

  const shown = sorted.slice(0, visible);

  // Over a handful of rows the Date/Price pills + category chips are more
  // chrome than table — the toolbar earns its place only on a real archive.
  const showToolbar = lots.length >= 8;

  return (
    <section className="ray-results rail">
      <style>{`
        .ray-results { padding-block: 40px 120px; }
        .ray-result-row {
          position: relative;
          display: grid;
          grid-template-columns: 1fr auto auto auto auto;
          align-items: center;
          gap: 20px;
          padding: 14px 24px;
          text-decoration: none;
          color: inherit;
          transition: background var(--duration-fast) var(--ease-signature);
        }
        .ray-result-row:hover { background: var(--color-hover-item); }
        .ray-result-maker { position: relative; z-index: 2; }
        .ray-result-maker:hover { text-decoration: underline; }
        .ray-result-row .ray-save-btn { width: 32px; height: 32px; }
        .ray-sort-pill {
          font-family: var(--font-sans), sans-serif;
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          padding: 6px 16px;
          border-radius: 100px;
          border: 1px solid var(--color-border);
          background: transparent;
          color: var(--color-text-muted);
          cursor: pointer;
          transition: border-color var(--duration-fast) var(--ease-signature), color var(--duration-fast) var(--ease-signature), background var(--duration-fast) var(--ease-signature);
        }
        .ray-sort-pill:hover {
          border-color: var(--color-border-mid);
          color: var(--color-fg);
        }
        /* Quote-free selector on purpose - quotes in server-rendered style
           text get HTML-escaped and break hydration. */
        .ray-sort-pill[data-active=true] {
          background: var(--color-fg);
          border-color: var(--color-fg);
          color: var(--color-bg);
        }
        /* sport-chip counts — the toolbar-pill count grammar (mono, faint, upright) */
        .ray-results .ray-sport-chips .ray-sort-pill i {
          font-style: normal;
          font-family: var(--font-mono), monospace;
          font-size: 9.5px;
          color: var(--color-text-faint);
          letter-spacing: 0;
        }
        .ray-results .ray-sport-chips .ray-sort-pill[data-active=true] i {
          color: color-mix(in srgb, var(--color-bg) 72%, transparent);
        }
        @media (max-width: 768px) {
          .ray-results { padding-block: 32px 80px; }
          .ray-result-row {
            grid-template-columns: 1fr auto;
            gap: 8px;
            padding: 14px 16px;
          }
          .ray-result-badges { display: none; }
        }
        @media (max-width: 900px) {
          /* 44px touch target on the save control */
          .ray-result-row .ray-save-btn { width: 44px; height: 44px; }
        }
      `}</style>

      <div style={{ marginBottom: 28 }}>
        {/* Ghost ordinal clipped to the header band — never under the table */}
        <div style={{ position: 'relative', overflow: 'hidden' }}>
          {mark && <SectionMark n={mark} style={{ fontSize: 'clamp(96px, 12vw, 150px)' }} />}
          <div style={{ position: 'relative', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, padding: '16px 0 4px' }}>
          <div>
            <h2 style={{
              fontFamily: 'var(--font-sans), sans-serif',
              fontSize: 24,
              fontWeight: 700,
              letterSpacing: '-0.02em',
            }}>
              Recent <span style={{ fontStyle: 'normal' }}>results</span>
            </h2>
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 400, marginTop: 6 }}>
              {filtered.length.toLocaleString()} sold lots
              {categoryFilter !== 'all' && ` · ${categoryLabels[categoryFilter]}`}
            </p>
            {sub && (
              <p style={{ fontSize: 13.5, color: 'var(--color-text-muted)', fontWeight: 400, margin: '8px 0 0', maxWidth: 560, lineHeight: 1.5 }}>
                {sub}
              </p>
            )}
          </div>
          {showToolbar && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              className="ray-sort-pill"
              data-active={sortBy === 'date' ? 'true' : 'false'}
              onClick={() => { setSortBy('date'); setVisible(20); }}
            >
              Date
            </button>
            <button
              className="ray-sort-pill"
              data-active={sortBy === 'price' ? 'true' : 'false'}
              onClick={() => { setSortBy('price'); setVisible(20); }}
            >
              Price
            </button>
          </div>
          )}
          </div>
        </div>

        {showToolbar && availableCategories.length > 1 && (
          <div style={{ display: 'flex', gap: 6, marginTop: 14, flexWrap: 'wrap' }}>
            <button
              className="ray-sort-pill"
              data-active={categoryFilter === 'all' ? 'true' : 'false'}
              onClick={() => setCategoryFilter('all')}
            >
              All
            </button>
            {availableCategories.map(cat => (
              <button
                key={cat}
                className="ray-sort-pill"
                data-active={categoryFilter === cat ? 'true' : 'false'}
                onClick={() => setCategoryFilter(cat as CategoryFilter)}
              >
                {categoryLabels[cat] || cat}
              </button>
            ))}
          </div>
        )}

        {showToolbar && sportGroups && (
          <div className="ray-sport-chips" role="radiogroup" aria-label="Filter by sport" style={{ display: 'flex', gap: 6, marginTop: 14, flexWrap: 'wrap' }}>
            <button
              className="ray-sort-pill"
              role="radio"
              aria-checked={sportFilter === 'all'}
              data-active={sportFilter === 'all' ? 'true' : 'false'}
              onClick={() => { setSportFilter('all'); setVisible(20); }}
            >
              All
            </button>
            {sportGroups.map(([sport, n]) => (
              <button
                key={sport}
                className="ray-sort-pill"
                role="radio"
                aria-checked={sportFilter === sport}
                data-active={sportFilter === sport ? 'true' : 'false'}
                onClick={() => { setSportFilter(sport); setVisible(20); }}
              >
                {sport} <i>{n}</i>
              </button>
            ))}
          </div>
        )}
      </div>

      <div style={{
        background: 'var(--color-bg-elevated)',
        border: '1px solid var(--color-border)',
        borderRadius: 16,
        overflow: 'hidden',
      }}>
        {shown.map((lot, i) => {
          const color = houseColors[lot.auctionHouse] || 'var(--color-text-secondary)';
          const catColor = (lot.category && lot.category !== 'unknown') ? categoryColors[lot.category] : null;
          // sports/science objects get a human sub-label ("game-worn jersey")
          // in place of the raw "Object" badge; art/design rows unchanged.
          const catBadge = objectSubLabel(lot) ?? (categoryLabels[lot.category] || lot.category);
          const makerLabel = lot.artist ? (ARTIST_LABEL[lot.artist] || lot.artist) : '';
          // Defense-in-depth: strip any crawl-leaked "do not list…" / date
          // prefix from a Goldin title before it renders (W1 filters at source;
          // this guards a legacy archive row that slipped through).
          const rawTitle = lot.auctionHouse === 'Goldin' ? cleanGoldinTitle(lot.title) : lot.title;
          const titleText = craftTitle(rawTitle);
          // "Pablo Picasso / Pablo Picasso" — when the crafted title IS the
          // maker label and the maker line renders, say it once
          const titleDupesMaker = showArtist && !!lot.artist && titleText === makerLabel;
          return (
            <div
              key={lot.id}
              className="ray-result-row"
              style={{
                borderBottom: i < shown.length - 1 ? '1px solid var(--color-border)' : 'none',
              }}
            >
              {/* Stretched primary link — save button stays a sibling, not a descendant */}
              <a
                href={lot.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`View ${lot.title} at ${lot.auctionHouse}`}
                style={{ position: 'absolute', inset: 0, zIndex: 1 }}
              />
              <div style={{ minWidth: 0 }}>
                {showArtist && lot.artist && (
                  <div style={{ marginBottom: 2 }}>
                    {/* the maker's own book — an internal link above the
                        stretched house anchor (which keeps the title/CTA) */}
                    <Link
                      href={`/${lot.artist}`}
                      className="ray-result-maker"
                      onClick={e => e.stopPropagation()}
                      style={{
                        fontSize: 12,
                        letterSpacing: '-0.01em',
                        textTransform: 'none',
                        color: 'var(--color-text-muted)',
                        fontWeight: 600,
                        textDecoration: 'none',
                      }}
                    >
                      {makerLabel}
                    </Link>
                  </div>
                )}
                {!titleDupesMaker && (
                  <div style={{
                    fontFamily: "var(--font-serif), serif",
                    fontSize: 17,
                    fontWeight: 400,
                    lineHeight: 1.3,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                    {titleText}
                  </div>
                )}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  marginTop: 3,
                  fontSize: 12,
                  color: 'var(--color-text-faint)',
                }}>
                  {lot.year && <span>{lot.year}</span>}
                  {lot.year && lot.medium && <span style={{ opacity: 0.4 }}>·</span>}
                  {lot.medium && (
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 220 }}>
                      {craftTitle(lot.medium)}
                    </span>
                  )}
                </div>
              </div>

              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{
                  fontSize: 15,
                  fontWeight: 500,
                  color: 'var(--color-fg)',
                  lineHeight: 1.3,
                }}>
                  {lot.priceUsd
                    ? formatPrice(lot.priceUsd)
                    : (lot as { resultsPending?: boolean }).resultsPending
                      ? <span style={{ color: 'var(--color-text-muted)', fontWeight: 600, fontSize: '0.92em' }}>Pending</span>
                      : '—'}
                </div>
                <div style={{ fontSize: 12, color: 'var(--color-text-faint)', marginTop: 1 }}>
                  {/* the product's core statistic, on every result it has one for */}
                  {(() => {
                    if (!lot.priceUsd || !lot.estimateLow || !lot.estimateHigh) return null;
                    const mid = (lot.estimateLow + lot.estimateHigh) / 2;
                    if (mid <= 0) return null;
                    const pct = Math.round((lot.priceUsd / mid - 1) * 100);
                    if (Math.abs(pct) > 2000) return null; // bad estimate data — say nothing
                    return (
                      <span style={{ color: pct >= 0 ? 'var(--color-up)' : 'var(--color-down)', fontWeight: 600 }}>
                        {pct >= 0 ? '+' : ''}{pct}% vs est ·{' '}
                      </span>
                    );
                  })()}
                  {formatDate(lot.saleDate, { month: 'short', year: 'numeric' })}
                  {/* the crawler promotes Goldin closes as 'goldin-final-bid';
                      'last-tracked-bid' is the retired spelling, kept so any
                      legacy archive record still gets its honesty label */}
                  {(lot.priceBasis === 'goldin-final-bid' || lot.priceBasis === 'last-tracked-bid') && (
                    <span title="Goldin publishes no results — this is the last bid lectr tracked before close, incl. premium"> · tracked</span>
                  )}
                </div>
              </div>

              <div className="ray-result-badges" style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                {catColor && (
                  <span style={{
                    padding: '3px 10px',
                    borderRadius: 100,
                    background: `color-mix(in srgb, ${catColor} 7%, transparent)`,
                    border: `1px solid color-mix(in srgb, ${catColor} 15%, transparent)`,
                    fontSize: 12,
                    letterSpacing: '-0.01em',
                    textTransform: 'none',
                    color: catColor,
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                  }}>
                    {catBadge}
                  </span>
                )}
                <span style={{
                  padding: '3px 10px',
                  borderRadius: 100,
                  background: `color-mix(in srgb, ${color} 7%, transparent)`,
                  border: `1px solid color-mix(in srgb, ${color} 15%, transparent)`,
                  fontSize: 12,
                  letterSpacing: '-0.01em',
                  textTransform: 'none',
                  color: color,
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                }}>
                  {lot.auctionHouse}
                </span>
              </div>

              {onToggleOwned && (
                <button
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleOwned(lot.id); }}
                  aria-pressed={ownedIds.includes(lot.id)}
                  aria-label={ownedIds.includes(lot.id) ? 'Remove from your collection' : 'Mark as owned'}
                  style={{
                    flexShrink: 0, position: 'relative', zIndex: 2, cursor: 'pointer',
                    fontFamily: 'var(--font-sans), sans-serif', fontSize: 11.5, fontWeight: 600,
                    padding: '5px 12px', borderRadius: 100, whiteSpace: 'nowrap',
                    background: ownedIds.includes(lot.id) ? 'var(--color-beige)' : 'transparent',
                    color: ownedIds.includes(lot.id) ? 'var(--paper-ink)' : 'var(--color-text-muted)',
                    border: ownedIds.includes(lot.id) ? '1px solid var(--color-beige)' : '1px solid var(--color-border)',
                  }}
                >
                  {ownedIds.includes(lot.id) ? (
                    <>
                      Owned{' '}
                      <svg width="10" height="10" viewBox="0 0 14 14" fill="none" aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle', marginLeft: 1 }}>
                        <path d="M2.5 7.5l3 3 6-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                      </svg>
                    </>
                  ) : 'Own it?'}
                </button>
              )}
              {onToggleSave && (
                <button
                  className="ray-save-btn"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleSave(lot.id, lot); }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: savedIds.includes(lot.id) ? 'var(--color-fg)' : 'transparent',
                    border: savedIds.includes(lot.id) ? 'none' : '1px solid var(--color-border)',
                    borderRadius: 8,
                    cursor: 'pointer',
                    padding: 0,
                    flexShrink: 0,
                    position: 'relative',
                    zIndex: 2,
                  }}
                  aria-label={savedIds.includes(lot.id) ? 'Remove from saved' : 'Save lot'}
                >
                  <svg width="10" height="12" viewBox="0 0 12 14" fill="none" aria-hidden="true">
                    <path
                      d="M1 1.5C1 1.22386 1.22386 1 1.5 1H10.5C10.7761 1 11 1.22386 11 1.5V12.5C11 12.6894 10.8862 12.8625 10.7096 12.9472C10.533 13.0319 10.3239 13.0136 10.1646 12.8994L6 9.91421L1.83541 12.8994C1.67614 13.0136 1.46698 13.0319 1.29037 12.9472C1.11377 12.8625 1 12.6894 1 12.5V1.5Z"
                      fill={savedIds.includes(lot.id) ? 'var(--color-bg)' : 'var(--color-text-faint)'}
                      stroke={savedIds.includes(lot.id) ? 'var(--color-bg)' : 'var(--color-text-faint)'}
                      strokeWidth="0.8"
                    />
                  </svg>
                </button>
              )}
            </div>
          );
        })}
      </div>

      {visible < sorted.length && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 28 }}>
          <button
            onClick={() => setVisible((v) => v + 20)}
            style={{
              background: 'none',
              border: '1px solid var(--color-border)',
              borderRadius: 100,
              padding: '10px 32px',
              fontSize: 12,
              letterSpacing: '-0.01em',
              textTransform: 'none',
              color: 'var(--color-text-muted)',
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: "var(--font-sans), sans-serif",
              transition: 'border-color var(--duration-fast) var(--ease-signature), color var(--duration-fast) var(--ease-signature)',
            }}
          >
            Show More
          </button>
        </div>
      )}
    </section>
  );
}
