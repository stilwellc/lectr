import type { Metadata } from 'next';
import fs from 'node:fs';
import path from 'node:path';
import { ARTISTS, MARKETS, marketOf } from '../../constants';
import { formatPrice } from '../../utils';

// The roster is finite and known at build time — every maker page prerenders
// as a static file. Without this the whole segment was a λ invocation per
// request (page + OG image), which is what burned through Vercel's Hobby
// fluid-CPU fair-use cap and got the deployment paused. Nothing here needs a
// server: the pages are client components reading static JSON.
export const dynamicParams = false;

export function generateStaticParams() {
  return ARTISTS.map(a => ({ slug: a.slug }));
}

// The per-maker head facts, read from stats.json at BUILD time — the same
// node:fs doctrine as app/sub/[a]/[b] and app/ref/[maker]/[key] (the browser
// webpack config stubs fs; never import this from a client component). Counts
// go stale between deploys exactly like the sub/ref descriptions do — the
// nightly build refreshes them.
interface MakerStatsRow {
  totalLotsTracked?: number;
  recordPrice?: number;
  recordDate?: string;
  houseDistribution?: unknown[];
}

let statsCache: Record<string, MakerStatsRow> | null = null;

function statsFor(slug: string): MakerStatsRow | null {
  if (!statsCache) {
    try {
      statsCache = JSON.parse(
        fs.readFileSync(path.join(process.cwd(), 'public', 'data', 'ray', 'stats.json'), 'utf8'),
      ) as Record<string, MakerStatsRow>;
    } catch {
      statsCache = {}; // no stats.json (fresh checkout) — generic descriptions
    }
  }
  return statsCache[slug] ?? null;
}

const MARKET_LABEL: Record<string, string> = {};
for (const m of MARKETS) MARKET_LABEL[m.key] = m.label.toLowerCase();

// Sharing /makers/kaws shows KAWS's own line and numbers — the share IS the
// product. The cards are pre-rendered to public/og/<slug>.png by
// scripts/build-og.tsx (dynamic opengraph-image can't ship on a static
// export). OG filenames are unchanged by the /makers move.
//
// C4 PRE-GA-3: the 39 dossiers shipped a bare <title> (root template not
// applied at the layout level), 39 identical inherited descriptions and no
// canonical. Title now follows the site's dossier grammar (/sub: 'X —
// sub-market · lectr'; /ref: 'X — reference · lectr'), the description is
// built per maker from measured stats.json facts only, and each page
// declares its self canonical (metadataBase resolves it absolute).
export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const label = ARTISTS.find(a => a.slug === params.slug)?.label || params.slug;
  const market = MARKET_LABEL[marketOf(params.slug)] || '';
  const s = statsFor(params.slug);

  const facts: string[] = [];
  if (s?.totalLotsTracked) facts.push(`${s.totalLotsTracked.toLocaleString('en-US')} lots tracked`);
  if (s?.houseDistribution?.length) {
    facts.push(`${s.houseDistribution.length} auction ${s.houseDistribution.length === 1 ? 'house' : 'houses'}`);
  }
  if (s?.recordPrice) {
    const yr = s.recordDate ? new Date(s.recordDate).getUTCFullYear() : null;
    facts.push(`record sale ${formatPrice(s.recordPrice)}${yr ? ` (${yr})` : ''}`);
  }
  const description = facts.length
    ? `${label} at auction — the ${market ? `${market} ` : ''}maker dossier: ${facts.join(' · ')}. Demand curve, records and live lots, read nightly. lectr auction intelligence.`
    : `${label} at auction — the ${market ? `${market} ` : ''}maker dossier: demand curve, records and live lots, read nightly. lectr auction intelligence.`;

  // absolute: the root '%s — lectr' template would double the brand suffix
  const title = `${label} — maker dossier · lectr`;
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: `/makers/${params.slug}` },
    openGraph: { title, description, images: [`/og/${params.slug}.png`] },
    twitter: { card: 'summary_large_image', title, description, images: [`/og/${params.slug}.png`] },
  };
}

export default function MakerLayout({ children }: { children: React.ReactNode }) {
  return children;
}
