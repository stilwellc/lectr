import type { Metadata } from 'next';
import EntityPage from '../../components/entity/EntityPage';
import JsonLd from '../../components/JsonLd';
import { staticOthers, staticEntityBySlug, entityFacts, entityDescription, entityCardPath, type StaticEntity } from '../../lib/seo-entities';
import { entityDocTitle } from '../../lib/entity/display';
import { seoMeta, breadcrumbLd, webPageLd, type Ld } from '../../lib/seo';

/**
 * /e/<name> — the STATIC alias of an entity dossier (/entity?id=<id>): a
 * Pokémon, a film or franchise, a mission, a team, a person, a set or a
 * collection — the top 300 by sales tracked (app/lib/seo-entities). Same page
 * (the one EntityPage for the id), with its own head prerendered: title,
 * measured description, share card (public/og/e/<slug>.png), self canonical
 * and structured data. Every other entity stays on the query route.
 */
export const dynamicParams = false;

export function generateStaticParams() {
  const out = staticOthers().map(x => ({ slug: x.slug }));
  // a static export needs ≥1 route: when the entity files are absent (the
  // nightly's emit is advisory) ship one noindex placeholder instead of
  // failing the whole deploy — the ?id= dossier routes keep working
  return out.length ? out : [{ slug: '_' }];
}

/** the schema.org thing the dossier is about — only the kinds schema.org
 *  names plainly; everything else is a Thing */
function aboutOf(x: StaticEntity, name: string): Ld {
  const k = x.e.kind === 'subject' ? x.e.subKind : x.e.kind;
  const type = k === 'person' ? 'Person'
    : k === 'film' ? 'Movie'
      : k === 'team' ? 'SportsTeam'
        : k === 'band' ? 'MusicGroup'
          : k === 'brand' ? 'Brand'
            : 'Thing';
  return { '@type': type, name };
}

export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await props.params;
  const x = staticEntityBySlug('entity', slug);
  if (!x) return { title: 'Entity', robots: { index: false, follow: true } };
  const f = entityFacts(x);
  return seoMeta({
    title: entityDocTitle(f.name, x.e.kind),
    absolute: true,
    description: entityDescription(x),
    path: x.path,
    image: entityCardPath(x),
    imageAlt: `${f.name} at auction — ${[f.sold, f.median, f.record].filter(Boolean).join(' · ')}`,
  });
}

export default async function StaticEntityPage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const x = staticEntityBySlug('entity', slug);
  if (!x) return null; // unreachable: dynamicParams = false
  const f = entityFacts(x);
  return (
    <>
      <JsonLd data={[
        webPageLd({ path: x.path, name: entityDocTitle(f.name, x.e.kind), description: entityDescription(x), image: entityCardPath(x), about: aboutOf(x, f.name) }),
        breadcrumbLd([['lectr', '/'], ['The roster', '/makers'], [f.name, x.path]]),
      ]} />
      <EntityPage key={x.id} id={x.id} />
    </>
  );
}
