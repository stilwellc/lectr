/**
 * heroLayers.ts — the hyper-curated sub-market layers behind the lander hero
 * (Collin-approved Jul 31 2026). Per market view, TWO bands:
 *
 *   main — thin lines sharing the ANCHOR's axis (% family): the six market
 *          indexes on Total, the era indexes on Sports*, the five icon watch
 *          families, art kinds, design materials, science's est-bearing
 *          collections. (*Sports' anchor is realized-$, so its era indexes
 *          live in the subpane — layers never mix units on one stage.)
 *   sub  — the volume subpane (quarterly sold counts): culture domains and
 *          science collections (tech featured — its 3× climb since 2015 is
 *          the story its 1.4% estimate coverage can't tell as a %).
 *
 * Honesty: index layers rebase to the visible window's first value (Δ%);
 * demand layers plot their raw measured %; volume plots counts and is
 * labeled as volume. Lines are neutral ink — green/red lives only on the
 * legend chips' real deltas. A layer with no series simply doesn't render.
 */
import type { MarketData } from '../hooks/useRayData';

export type LayerKind = 'index' | 'demand' | 'volume';
export interface HeroLayer {
  key: string;
  label: string;
  kind: LayerKind;
  /** the layer's line color — a muted terminal hue (dusty, mid-luminance)
      kept visually apart from the saturated direction green/red, so a line's
      color indexes it to its chip without ever implying up/down */
  color: string;
  /** quarterly points on the shared 'YYYY Qn' axis */
  points: { period: string; value: number; n: number }[];
}

/** the layer palette — six dusty hues tuned for the #0A0B0D ground */
export const LAYER_PALETTE = ['#7EA4CC', '#A98BC8', '#6FB5AC', '#C9A96E', '#C98B94', '#8F9BA8'];

interface LayerRef { key: string; label: string; source: 'markets' | 'drills' | 'subs'; vertical?: string; slug?: string; kind: LayerKind }

const MAIN: Record<string, LayerRef[]> = {
  all: [
    { key: 'art', label: 'Art', source: 'markets', slug: 'art', kind: 'index' },
    { key: 'design', label: 'Design', source: 'markets', slug: 'design', kind: 'index' },
    { key: 'watches', label: 'Watches', source: 'markets', slug: 'watches', kind: 'index' },
    { key: 'science', label: 'Science', source: 'markets', slug: 'science', kind: 'index' },
    { key: 'sports', label: 'Sports', source: 'markets', slug: 'sports', kind: 'index' },
    { key: 'tcg', label: 'TCG', source: 'markets', slug: 'tcg', kind: 'index' },
    { key: 'culture', label: 'Pop culture', source: 'markets', slug: 'culture', kind: 'index' },
  ],
  watches: [
    { key: 'daytona', label: 'Daytona', source: 'drills', vertical: 'watches', slug: 'rolex:daytona', kind: 'demand' },
    { key: 'nautilus', label: 'Nautilus', source: 'drills', vertical: 'watches', slug: 'patek-philippe:nautilus', kind: 'demand' },
    { key: 'royal-oak', label: 'Royal Oak', source: 'drills', vertical: 'watches', slug: 'audemars-piguet:royal-oak', kind: 'demand' },
    { key: 'tank', label: 'Tank', source: 'drills', vertical: 'watches', slug: 'cartier:tank', kind: 'demand' },
    { key: 'speedmaster', label: 'Speedmaster', source: 'drills', vertical: 'watches', slug: 'omega:speedmaster', kind: 'demand' },
  ],
  art: [
    { key: 'prints', label: 'Prints', source: 'drills', vertical: 'art', slug: 'art:prints', kind: 'demand' },
    { key: 'originals', label: 'Originals', source: 'drills', vertical: 'art', slug: 'art:originals', kind: 'demand' },
    { key: 'sculpture', label: 'Sculpture', source: 'drills', vertical: 'art', slug: 'art:sculpture', kind: 'demand' },
  ],
  design: [
    { key: 'walnut', label: 'Walnut', source: 'drills', vertical: 'design', slug: 'design-material:walnut', kind: 'demand' },
    { key: 'teak', label: 'Teak', source: 'drills', vertical: 'design', slug: 'design-material:teak', kind: 'demand' },
    { key: 'steel', label: 'Steel', source: 'drills', vertical: 'design', slug: 'design-material:steel', kind: 'demand' },
    { key: 'plywood', label: 'Plywood', source: 'drills', vertical: 'design', slug: 'design-material:plywood', kind: 'demand' },
  ],
  // science + culture anchor on realized-$ cohorts (their recent records are
  // majority estimate-less post-RR-archive) — % layers can't share a $ stage,
  // so their stories ride the volume subpane; meteorites/fossils demand reads
  // stay visible in the movers band beneath the hero.
};

const SUB: Record<string, LayerRef[]> = {
  sports: [
    { key: 'era-classic', label: "Classic '80–99", source: 'drills', vertical: 'sports', slug: 'cards-era:classic', kind: 'index' },
    { key: 'era-modern', label: 'Modern 2000+', source: 'drills', vertical: 'sports', slug: 'cards-era:modern', kind: 'index' },
    { key: 'era-vintage', label: "Vintage pre-'80", source: 'drills', vertical: 'sports', slug: 'cards-era:vintage', kind: 'index' },
  ],
  science: [
    { key: 'v-tech', label: 'Tech assets', source: 'subs', vertical: 'science', slug: 'science-tech', kind: 'volume' },
    { key: 'v-space', label: 'Space', source: 'subs', vertical: 'science', slug: 'space-exploration', kind: 'volume' },
    { key: 'v-meteorites', label: 'Meteorites', source: 'subs', vertical: 'science', slug: 'meteorites', kind: 'volume' },
    { key: 'v-fossils', label: 'Fossils', source: 'subs', vertical: 'science', slug: 'fossils', kind: 'volume' },
  ],
  tcg: [
    { key: 'era-vintage', label: "Vintage ≤'02", source: 'drills', vertical: 'tcg', slug: 'pokemon-era:vintage', kind: 'volume' },
    { key: 'era-classic', label: "Classic '03–16", source: 'drills', vertical: 'tcg', slug: 'pokemon-era:classic', kind: 'volume' },
    { key: 'v-sealed', label: 'Sealed', source: 'drills', vertical: 'tcg', slug: 'tcg:pokemon-sealed', kind: 'volume' },
  ],
  culture: [
    { key: 'v-music', label: 'Music', source: 'drills', vertical: 'culture', slug: 'culture:music', kind: 'volume' },
    { key: 'v-hollywood', label: 'Hollywood', source: 'drills', vertical: 'culture', slug: 'culture:hollywood', kind: 'volume' },
    { key: 'v-political', label: 'Political', source: 'drills', vertical: 'culture', slug: 'culture:political', kind: 'volume' },
  ],
};

function resolveRef(ref: LayerRef, market: MarketData | null): HeroLayer | null {
  if (!market) return null;
  let points: { period: string; value: number; n: number }[] | undefined;
  if (ref.source === 'markets') {
    points = market.markets?.[ref.slug!]?.index?.map(p => ({ period: p.period, value: p.value, n: p.n ?? 0 }));
  } else {
    const pool = ref.source === 'drills' ? market.drills?.[ref.vertical!] : market.subMarkets?.[ref.vertical!];
    const row = pool?.find(r => r.slug === ref.slug);
    if (!row) return null;
    if (ref.kind === 'volume') points = row.volSeries?.map(p => ({ period: p.period, value: p.n, n: p.n }));
    else if (ref.kind === 'index') points = row.indexSeries;
    else points = row.demandSeries?.map(p => ({ period: p.period, value: p.value, n: p.n }));
  }
  if (!points || points.length < 6) return null;
  return { key: ref.key, label: ref.label, kind: ref.kind, color: '', points };
}

export function resolveHeroLayers(activeKey: string, market: MarketData | null): { main: HeroLayer[]; sub: HeroLayer[]; subLabel: string | null } {
  const main = (MAIN[activeKey] || []).map(r => resolveRef(r, market)).filter((x): x is HeroLayer => !!x);
  const sub = (SUB[activeKey] || []).map(r => resolveRef(r, market)).filter((x): x is HeroLayer => !!x);
  // colors assigned by position across BOTH bands — stable per view, and a
  // main line can never share its hue with a subpane line on the same stage
  [...main, ...sub].forEach((l, i) => { l.color = LAYER_PALETTE[i % LAYER_PALETTE.length]; });
  const subLabel = !sub.length ? null
    : sub[0].kind === 'volume' ? 'sales volume · quarterly'
    : 'card era indexes · repeat-sale, rebased';
  return { main, sub, subLabel };
}
