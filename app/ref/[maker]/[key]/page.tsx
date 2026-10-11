import type { Metadata } from 'next';
import fs from 'node:fs';
import path from 'node:path';
import RefPage from '../../../components/RefPage';
import { ARTIST_LABEL } from '../../../constants';
import { formatPrice, refLabel } from '../../../utils';
import { encodeRefPath, decodeRefPath } from '../../ref-path';
import JsonLd from '../../../components/JsonLd';
import { seoMeta, datasetLd, breadcrumbLd } from '../../../lib/seo';

/**
 * The STATIC reference dossier — /ref/<maker>/<key>, the path form of the
 * legacy /ref?id=<maker>:<ref> query permalink (audit-urls §3). All 613 refs
 * in refs.json prerender at build. The <key> segment is the ref half through
 * the ref-path codec ('/' and 'è' occur in real keys — see ref-path.ts); the
 * old query shell stays as a client redirector for one release.
 *
 * SERVER-ONLY at build (node:fs) — same doctrine as app/lot/flagged.ts.
 */

interface RefRow {
  key: string;
  maker: string;
  ref: string;
  n: number;
  medianUsd: number;
  ttmMedianUsd: number | null;
  houses: string[];
}

let cache: RefRow[] | null = null;

function refRows(): RefRow[] {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(
      path.join(process.cwd(), 'public', 'data', 'ray', 'refs.json'),
      'utf8',
    );
    const rows = (JSON.parse(raw)?.refs as RefRow[]) || [];
    const seen = new Set<string>();
    cache = rows.filter(r => {
      if (!r || typeof r.maker !== 'string' || typeof r.ref !== 'string') return false;
      if (!/^[a-z0-9-]+$/.test(r.maker) || !r.ref) return false;
      const p = `${r.maker}/${encodeRefPath(r.ref)}`;
      if (seen.has(p)) return false; // dupe params would collide as pages
      seen.add(p);
      return true;
    });
  } catch {
    cache = []; // no refs.json (fresh checkout) — build ships zero ref pages
  }
  return cache;
}

function findRow(maker: string, key: string): RefRow | null {
  const ref = decodeRefPath(key);
  return refRows().find(r => r.maker === maker && r.ref === ref) ?? null;
}

export const dynamicParams = false;

export function generateStaticParams() {
  return refRows().map(r => ({ maker: r.maker, key: encodeRefPath(r.ref) }));
}

export async function generateMetadata(props: { params: Promise<{ maker: string; key: string }> }): Promise<Metadata> {
  const params = await props.params;
  const row = findRow(params.maker, params.key);
  const makerName = ARTIST_LABEL[params.maker] || params.maker;
  const label = row ? refLabel(row.ref) : refLabel(decodeRefPath(params.key));
  // absolute: the root '%s — lectr' template would double the brand suffix
  const title = `${makerName} ${label} — reference · lectr`;
  const description = row
    ? [
        `${makerName} ${label}: ${row.n.toLocaleString('en-US')} sales on the book — all-time median ${formatPrice(row.medianUsd)}`,
        row.ttmMedianUsd != null ? `, past-year median ${formatPrice(row.ttmMedianUsd)}` : '',
        row.houses.length ? `. Sold at ${row.houses.join(', ')}` : '',
        '. lectr auction intelligence.',
      ].join('')
    : `${makerName} ${label} — every sale on the book: medians, trend and recent hammers. lectr auction intelligence.`;
  return seoMeta({
    title,
    absolute: true,
    description,
    path: `/ref/${params.maker}/${params.key}`,
    // the watch house's own card (scripts/build-og.tsx) — every ref belongs to one
    image: ARTIST_LABEL[params.maker] ? `/og/${params.maker}.png` : undefined,
    imageAlt: `${makerName} ${label} — a watch reference on lectr`,
  });
}

export default async function StaticRefPage(props: { params: Promise<{ maker: string; key: string }> }) {
  const params = await props.params;
  const refKey = `${params.maker}:${decodeRefPath(params.key)}`;
  // key: navigating between ref dossiers must remount — same doctrine as the
  // query route it replaces.
  const row = findRow(params.maker, params.key);
  const makerName = ARTIST_LABEL[params.maker] || params.maker;
  const label = row ? refLabel(row.ref) : refLabel(decodeRefPath(params.key));
  const path = `/ref/${params.maker}/${params.key}`;
  return (
    <>
      <JsonLd data={[
        datasetLd({
          path,
          name: `${makerName} ${label} — auction results`,
          description: row
            ? `Every ${makerName} ${label} sale on lectr's book: ${row.n.toLocaleString('en-US')} settled results, all-time median ${formatPrice(row.medianUsd)}${row.houses.length ? `, across ${row.houses.join(', ')}` : ''} — read nightly.`
            : `Every ${makerName} ${label} sale on lectr's book — medians, trend and recent hammers, read nightly.`,
          keywords: [makerName, `${makerName} ${label}`, 'watch auction results', 'hammer prices'],
          measured: ['hammer price (USD)', 'sale date', 'auction house'],
        }),
        breadcrumbLd([['lectr', '/'], ...(ARTIST_LABEL[params.maker] ? [[makerName, `/makers/${params.maker}`] as [string, string]] : []), [`${makerName} ${label}`, path]]),
      ]} />
      <RefPage key={refKey} refKey={refKey} />
    </>
  );
}
