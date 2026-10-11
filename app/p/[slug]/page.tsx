import type { Metadata } from 'next';
import EntityPage from '../../components/entity/EntityPage';
import JsonLd from '../../components/JsonLd';
import { staticPlayers, staticEntityBySlug, entityFacts, entityDescription, entityCardPath } from '../../lib/seo-entities';
import { entityDocTitle } from '../../lib/entity/display';
import { seoMeta, breadcrumbLd, webPageLd } from '../../lib/seo';

/**
 * /p/<player> — the STATIC alias of a player dossier (/player?id=<slug>) for
 * the deepest players lectr tracks (app/lib/seo-entities: the top 300 by
 * sales tracked). Same page — the one EntityPage for `pl:<slug>` — with its
 * own head prerendered: title, measured description, share card
 * (public/og/p/<slug>.png, scripts/build-og.tsx), self canonical and
 * structured data. Every other player stays on the query route.
 */
export const dynamicParams = false;

export function generateStaticParams() {
  return staticPlayers().map(x => ({ slug: x.slug }));
}

export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await props.params;
  const x = staticEntityBySlug('player', slug);
  if (!x) return { title: 'Player dossier' };
  const f = entityFacts(x);
  return seoMeta({
    title: entityDocTitle(f.name, 'player'),
    absolute: true,
    description: entityDescription(x),
    path: x.path,
    image: entityCardPath(x),
    imageAlt: `${f.name} at auction — ${[f.sold, f.median, f.record].filter(Boolean).join(' · ')}`,
  });
}

export default async function StaticPlayerPage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const x = staticEntityBySlug('player', slug);
  const id = x?.id || `pl:${slug}`;
  const f = x ? entityFacts(x) : null;
  return (
    <>
      {x && f && (
        <JsonLd data={[
          webPageLd({
            path: x.path, name: entityDocTitle(f.name, 'player'), description: entityDescription(x), image: entityCardPath(x),
            about: { '@type': 'Person', name: f.name, ...(x.e.discipline ? { description: x.e.discipline } : {}) },
          }),
          breadcrumbLd([['lectr', '/'], ['The roster', '/makers'], [f.name, x.path]]),
        ]} />
      )}
      <EntityPage key={id} id={id} />
    </>
  );
}
