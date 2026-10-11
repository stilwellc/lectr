import { staticEntities } from '../lib/seo-entities';

/**
 * /entity-paths.json — the alias manifest: entity id → its static path
 * (/p/<slug>, /e/<slug>), written at build from the same set that prerenders
 * the pages (app/lib/seo-entities), so it can only name pages this deploy
 * ships. The query dossiers (/player?id=, /entity?id=) read it to declare the
 * alias as their canonical. ~600 short entries.
 */
export const dynamic = 'force-static';

export function GET() {
  const map: Record<string, string> = {};
  for (const x of staticEntities()) map[x.id] = x.path;
  return Response.json(map);
}
