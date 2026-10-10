/**
 * entity/lens.ts — the entity page's lens words (makers overhaul P2): a clean
 * `cat:sub` lens printed the way the live chips print it, and the /sub drill
 * row a lens trades in. Pure — shared by the page and its tests.
 */

/** a lens label without its category prefix, in the live chips' words
 *  ('Sports Cards · Singles' → 'Cards', 'Entertainment & Music · Props &
 *  Wardrobe' → 'Props & Wardrobe') */
export function shortLens(key: string, label: string): string {
  if (key === 'sports-cards:singles') return 'Cards';
  if (key.startsWith('sports-cards:')) return `Cards · ${label.split(' · ').pop()}`;
  return label.split(' · ').pop() || label;
}

const SPORTS_MEM_DRILL: Record<string, string> = {
  'game-used': 'game-used', autographs: 'autographs', photographs: 'photos', tickets: 'tickets',
  programs: 'programs', trophies: 'trophies', equipment: 'equipment',
};
/** the /sub drill a clean `cat:sub` lens trades in (null: none built) */
export function drillSlugOf(lens: string, sport: string | null): string | null {
  const i = lens.indexOf(':');
  const cat = lens.slice(0, i), sub = lens.slice(i + 1);
  switch (cat) {
    case 'fine-art': return ({ prints: 'art:prints', unique: 'art:originals', sculpture: 'art:sculpture', ceramics: 'art:sculpture', photographs: 'art:photographs', books: 'art:books' } as Record<string, string>)[sub] ?? null;
    case 'design': return ({ seating: 'design:seating', tables: 'design:tables', storage: 'design:case-storage', objects: 'design:objects' } as Record<string, string>)[sub] ?? null;
    case 'sports-cards': return sport ? (sub === 'sealed-wax' ? `wax:${sport}` : `cards:${sport}`) : null;
    case 'sports-memorabilia': return sport && SPORTS_MEM_DRILL[sub] ? `${SPORTS_MEM_DRILL[sub]}:${sport}` : null;
    case 'tcg': return ({ vintage: 'pokemon-era:vintage', classic: 'pokemon-era:classic', modern: 'pokemon-era:modern', sealed: 'tcg:pokemon-sealed' } as Record<string, string>)[sub] ?? null;
    case 'space-science': return ({ apollo: 'space:apollo', 'mercury-gemini': 'space:mercury-gemini', 'shuttle-iss': 'space:shuttle-iss', soviet: 'space:soviet' } as Record<string, string>)[sub] ?? null;
    case 'entertainment': return ({ 'photos-posters': 'culture-kind:photos', 'autographs-documents': 'culture-kind:autographs', 'props-costumes': 'culture-kind:props', 'instruments-records': 'culture-kind:instruments', tickets: 'culture-kind:tickets' } as Record<string, string>)[sub] ?? null;
    case 'historical': return ({ political: 'culture:political', royalty: 'culture:royalty', military: 'culture:military', literary: 'culture:literary', historic: 'culture:historic' } as Record<string, string>)[sub] ?? null;
    default: return null;
  }
}
