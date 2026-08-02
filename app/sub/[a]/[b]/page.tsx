import type { Metadata } from 'next';
import fs from 'node:fs';
import path from 'node:path';
import SubPage from '../../SubPage';
import { subCatLabel } from '../../../lib/subcat-labels';

/**
 * The STATIC sub-market dossier — /sub/<group>/<part>, the path form of the
 * legacy /sub?id=<group>:<part> query permalink (audit-urls §3). Every drill
 * slug in market.json is 'group:part' with exactly one ':' and a path-clean
 * [a-z0-9-] charset on both sides, so the split-on-first-colon mapping is
 * deterministic both ways. ~95 pages prerender at build; the old query shell
 * stays as a client redirector for one release.
 *
 * SERVER-ONLY at build (node:fs) — same doctrine as app/lot/flagged.ts; the
 * browser webpack config stubs fs to false, so never import this from a
 * client component. market.json exists at build time locally and in CI.
 */

interface DrillRow {
  slug: string;
  label?: string;
  vertical?: string;
  readType?: string;
}

let cache: DrillRow[] | null = null;

function drillRows(): DrillRow[] {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(
      path.join(process.cwd(), 'public', 'data', 'ray', 'market.json'),
      'utf8',
    );
    const drills = (JSON.parse(raw)?.drills ?? {}) as Record<string, DrillRow[]>;
    const seen = new Set<string>();
    cache = Object.values(drills).flat().filter(r => {
      // params come from here verbatim — guard the invariants the route
      // depends on (exactly one ':', both halves non-empty and path-safe)
      if (!r || typeof r.slug !== 'string') return false;
      if (!/^[a-z0-9-]+:[a-z0-9-]+$/.test(r.slug)) return false;
      if (seen.has(r.slug)) return false; // dupe slugs would collide as params
      seen.add(r.slug);
      return true;
    });
  } catch {
    cache = []; // no market.json (fresh checkout) — build ships zero sub pages
  }
  return cache;
}

function findRow(a: string, b: string): DrillRow | null {
  return drillRows().find(r => r.slug === `${a}:${b}`) ?? null;
}

export const dynamicParams = false;

export function generateStaticParams() {
  return drillRows().map(r => {
    const i = r.slug.indexOf(':');
    return { a: r.slug.slice(0, i), b: r.slug.slice(i + 1) };
  });
}

// what the dossier's strongest honest read actually is, per readType — the
// description must not promise an index where only demand is measured
const READ_SENTENCE: Record<string, string> = {
  index: 'verified repeat-sales index move',
  demand: 'measured bidding demand',
  descriptive: 'typical price and sale volume',
};

export function generateMetadata({ params }: { params: { a: string; b: string } }): Metadata {
  const row = findRow(params.a, params.b);
  const label = row?.label || subCatLabel(params.b);
  const read = READ_SENTENCE[row?.readType || ''] || 'strongest honest read';
  const description = `${label} — tracked${row?.vertical ? ` ${row.vertical}` : ''} sub-market: ${read}, with the record and the coverage behind it. lectr auction intelligence.`;
  const canonical = `/sub/${params.a}/${params.b}`;
  // absolute: the root '%s — lectr' template would double the brand suffix
  const title = `${label} — sub-market · lectr`;
  return {
    title: { absolute: title },
    description,
    alternates: { canonical },
    openGraph: { title, description },
    twitter: { title, description },
  };
}

export default function StaticSubPage({ params }: { params: { a: string; b: string } }) {
  const slug = `${params.a}:${params.b}`;
  // key: navigating between sub dossiers must remount (fresh chart/series
  // state) — same doctrine as the query route it replaces.
  return <SubPage key={slug} slug={slug} />;
}
