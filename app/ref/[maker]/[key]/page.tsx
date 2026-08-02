import type { Metadata } from 'next';
import fs from 'node:fs';
import path from 'node:path';
import RefPage from '../../../components/RefPage';
import { ARTIST_LABEL } from '../../../constants';
import { formatPrice, refLabel } from '../../../utils';
import { encodeRefPath, decodeRefPath } from '../../ref-path';

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

export function generateMetadata({ params }: { params: { maker: string; key: string } }): Metadata {
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
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: `/ref/${params.maker}/${params.key}` },
    openGraph: { title, description },
    twitter: { title, description },
  };
}

export default function StaticRefPage({ params }: { params: { maker: string; key: string } }) {
  const refKey = `${params.maker}:${decodeRefPath(params.key)}`;
  // key: navigating between ref dossiers must remount — same doctrine as the
  // query route it replaces.
  return <RefPage key={refKey} refKey={refKey} />;
}
