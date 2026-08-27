/**
 * attribution.ts — the misattribution guard. Two attribution paths stamp a
 * maker slug onto a lot (item-level routeItem, and search-based house crawlers
 * like crawlBonhams), and both let contamination through:
 *   · car-auction lots swept into an ART maker's search ("2.6-litre Alfa" under
 *     Peter Saul, a Ferrari Barchetta under Clemente) — a car is never art.
 *   · a bare-surname route matching a DIFFERENT artist named in the title
 *     ("José Clemente OROZCO" → clemente, "Jacques-Henri LARTIGUE" → picasso,
 *     "Edward PRIESTLEY" → warhol).
 * This validates an (artist, title) attribution and returns true when the lot
 * plainly does not belong to that maker. Shared by the crawlers (reject at
 * attribution) and assemble (scrub the corpus before any figure is computed),
 * so every surface — stats, market, upcoming, the value engine — reads a clean
 * pool. Conservative by design: it only drops on an UNAMBIGUOUS negative
 * signal (a car in an art pool, or a title that explicitly names a different
 * artist with life dates), never on a plain-titled real work.
 */
import { marketOf } from '../constants';

/** Car-only vocabulary — marque names, engine displacement, coachbuilder and
 *  body terms that appear in NO artwork title. Deliberately EXCLUDES words a
 *  watch uses (roadster = a Cartier model, "grand prix"/"monaco" watch
 *  editions), because the vehicle gate is scoped to art & design only. */
const VEHICLE_RE = /\b(ferrari|alfa romeo|porsche|bugatti|maserati|lamborghini|aston martin|bentley|rolls-?royce|mercedes-?benz|lancia|delahaye|delage|duesenberg|hispano-suiza|bizzarrini|talbot|\d[.,]?\d?\s*-?\s*litre\b|litre engined|barchetta|berlinetta|monoposto|coachwork|carrozzeria|\bchassis no)\b/;

/** The tracked surname each name-routed art/design maker resolves to. A lot
 *  whose title leads a "(YYYY-YYYY)" life-dates block with a DIFFERENT surname
 *  belongs to that other artist. Makers with no clean surname (kaws, futura-
 *  2000, fab-5-freddy) are omitted — they only get the vehicle gate. */
const MAKER_SURNAME: Record<string, string> = {
  'george-condo': 'condo', 'andy-warhol': 'warhol', 'keith-haring': 'haring',
  'ed-ruscha': 'ruscha', 'pablo-picasso': 'picasso', 'henri-matisse': 'matisse',
  'tom-sachs': 'sachs', 'peter-saul': 'saul', 'raymond-pettibon': 'pettibon',
  'barry-mcgee': 'mcgee', 'r-crumb': 'crumb', 'francesco-clemente': 'clemente',
  'eddie-martinez': 'martinez', 'kenny-scharf': 'scharf', 'jean-michel-basquiat': 'basquiat',
  'roy-lichtenstein': 'lichtenstein', 'francis-bacon': 'bacon', 'alexander-calder': 'calder',
  'rashid-johnson': 'johnson', 'jeff-koons': 'koons', 'george-nakashima': 'nakashima',
  'charles-eames': 'eames', 'jean-prouve': 'prouv', 'pierre-jeanneret': 'jeanneret',
};

// the token immediately before a "(YYYY-YYYY)" life-dates block — the surname
// in the auction-house "Name (dates)" title convention. Latin-1 accented
// range (à-ÿ) so accented surnames (Prouvé, Dubuffet) capture whole; runs on
// the lower-cased title, so no /u flag needed.
const LIFE_DATES = /([a-zà-ÿ][a-zà-ÿ.\-'’]+)\s*\(\s*1[6-9]\d\d\s*[-–—]\s*(?:1[6-9]\d\d|20\d\d)\s*\)/;

/** Does this (artist, title) attribution plainly not belong to the maker? */
export function isMisattributed(artist: string, title: string): boolean {
  const t = (title || '').toLowerCase();
  const mk = marketOf(artist);
  // a car is never an artwork or a design object
  if ((mk === 'art' || mk === 'design') && VEHICLE_RE.test(t)) return true;
  // a title that leads a "Name (YYYY-YYYY)" block with a DIFFERENT surname
  // belongs to that other artist ("José Clemente OROZCO (1883-1949)" → not
  // Francesco Clemente, even though 'clemente' is Orozco's middle name)
  const surname = MAKER_SURNAME[artist];
  if (surname) {
    const m = t.match(LIFE_DATES);
    // startsWith, not equality — the captured token keeps its accent
    // ("prouvé" for surname 'prouv'), so a real "Jean Prouvé (1901-1984)"
    // must read as the maker, not a collision
    if (m && !m[1].startsWith(surname)) {
      // rescue a genuine collaboration only when the maker is named SEPARATELY,
      // after the other artist's dates ("Le Corbusier (1887-1965), and Pierre
      // Jeanneret …") — not when the surname merely sits inside the other
      // artist's name before the dates (Orozco's middle name)
      const after = t.slice((m.index ?? 0) + m[0].length);
      if (!new RegExp(`\\b${surname}`).test(after)) return true;
    }
  }
  return false;
}
