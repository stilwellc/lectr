/**
 * ROUTE TITLES — the one source for the document titles of the routes a
 * client market switch moves between without a navigation (pushState under
 * the mounted board: the landers, and the bare analysis surfaces). Each
 * route's `metadata` reads its title from here, and MarketProvider
 * (app/lib/market.tsx) re-asserts the SAME string after a switch — so a
 * switch can never print a title the route itself doesn't carry.
 *
 * Pure data: imported by server metadata and the client provider alike.
 */

/** the layout's default title — home ('/') carries no title of its own */
export const SITE_TITLE = 'lectr — auction intelligence';

/** the template every route title rides (layout `title.template`) */
export const titled = (t: string) => `${t} — lectr`;

/** lander path → its metadata title (before the template) */
export const LANDER_TITLE: Record<string, string> = {
  '/collectibles': 'Collectibles',
  '/art': 'Art',
  '/design': 'Design',
  '/watches': 'Watches',
  '/science': 'Science',
  '/sports': 'Sports',
  '/tcg': 'TCG',
  '/culture': 'Pop Culture',
};

/** bare analysis surface → its layout metadata title (before the template) */
export const SEGMENT_BARE_TITLE: Record<string, string> = {
  '/makers': 'The roster — makers tracked at auction',
  '/analytics': 'Market analytics — the collectibles market in numbers',
  '/value': 'Tonight’s calls — the record against the house estimate',
};

/** a pathed analysis surface's absolute title, e.g. "Art buy signals — lectr" */
export const segmentTitle = (label: string, noun: string) => titled(`${label} ${noun}`);

/** the full document title a lander path prints ('/' → the site title) */
export function landerDocTitle(path: string): string {
  const t = LANDER_TITLE[path];
  return t ? titled(t) : SITE_TITLE;
}
