import type { Metadata } from 'next';
import SubPage from '../../SubPage';
import { subCatLabel } from '../../../lib/subcat-labels';
import { drillRows, findRow, subCardPath } from '../../../lib/drill-rows';
import { MARKETS } from '../../../constants';
import JsonLd from '../../../components/JsonLd';
import { seoMeta, datasetLd, breadcrumbLd } from '../../../lib/seo';

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

export async function generateMetadata(props: { params: Promise<{ a: string; b: string }> }): Promise<Metadata> {
  const params = await props.params;
  const row = findRow(params.a, params.b);
  const label = row?.label || subCatLabel(params.b);
  const read = READ_SENTENCE[row?.readType || ''] || 'strongest honest read';
  const description = `${label} — tracked${row?.vertical ? ` ${row.vertical}` : ''} sub-market: ${read}, with the record and the coverage behind it. lectr auction intelligence.`;
  const canonical = `/sub/${params.a}/${params.b}`;
  // absolute: the root '%s — lectr' template would double the brand suffix
  const title = `${label} — sub-market · lectr`;
  const market = MARKETS.some(m => m.key === row?.vertical && m.key !== 'all') ? row!.vertical! : null;
  return seoMeta({
    title,
    absolute: true,
    description,
    path: canonical,
    image: row ? subCardPath(row.slug) : market ? `/og/m/${market}.png` : undefined,
    imageAlt: `${label} — a tracked sub-market on lectr`,
  });
}

export default async function StaticSubPage(props: { params: Promise<{ a: string; b: string }> }) {
  const params = await props.params;
  const slug = `${params.a}:${params.b}`;
  // key: navigating between sub dossiers must remount (fresh chart/series
  // state) — same doctrine as the query route it replaces.
  const row = findRow(params.a, params.b);
  const label = row?.label || subCatLabel(params.b);
  const path = `/sub/${params.a}/${params.b}`;
  const market = MARKETS.find(m => m.key === row?.vertical && m.key !== 'all');
  return (
    <>
      <JsonLd data={[
        datasetLd({
          path,
          name: `${label} — auction results${market ? ` (${market.label.toLowerCase()})` : ''}`,
          description: `Settled auction results for ${label}${market ? `, a ${market.label.toLowerCase()} sub-market` : ''}: ${READ_SENTENCE[row?.readType || ''] || 'its strongest honest read'}, the record and the coverage behind it — read nightly by lectr.`,
          keywords: [label, market?.label, 'auction results', 'hammer prices'].filter((k): k is string => !!k),
          measured: ['hammer price (USD)', 'sale date', 'auction house'],
        }),
        breadcrumbLd([['lectr', '/'], ['Sub-markets', '/sub'], [label, path]]),
      ]} />
      <SubPage key={slug} slug={slug} />
    </>
  );
}
