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

/** (wave 5) a DIFFERENT person whose name contains the maker's search word —
 *  the ballplayer Roberto Clemente and the Bologna printer Clemente Ferroni
 *  under Francesco Clemente, the angler W. L. Calderwood / W. F. Calderon
 *  under Calder. A lot naming the maker himself as well keeps him. */
const NAME_COLLISION: Record<string, [RegExp, RegExp]> = {
  'francesco-clemente': [/\brobert(?:o)? clemente\b|\bclemente ferroni\b/, /\bfrancesco\b/],
  'alexander-calder': [/\bcalder(?:wood|on)\b/, /\bcalder\b/],
};

/** Does this (artist, title) attribution plainly not belong to the maker?
 *  `desc` (optional) is the description head — Bonhams titles the book, not
 *  its author ("The Life of the Salmon" … "CALDERWOOD (W.L.)"). */
export function isMisattributed(artist: string, title: string, desc = ''): boolean {
  const t = (title || '').toLowerCase();
  const coll = NAME_COLLISION[artist];
  if (coll) {
    const td = `${t} ${(desc || '').slice(0, 300).toLowerCase()}`;
    if (coll[0].test(td) && !coll[1].test(td)) return true;
  }
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
    // (r5) a title the maker LEADS ("[PICASSO] - Balzac (1799-1850). Le Chef-d'œuvre inconnu",
    // "PICASSO, Pablo (1881-1973), illustrator -- Mérimée") is the maker's illustrated book
    const leads = makerLeads(t, surname);
    if (m && !leads && !m[1].startsWith(surname)) {
      // rescue a genuine collaboration only when the maker is named SEPARATELY,
      // after the other artist's dates ("Le Corbusier (1887-1965), and Pierre
      // Jeanneret …") — not when the surname merely sits inside the other
      // artist's name before the dates (Orozco's middle name)
      const after = t.slice((m.index ?? 0) + m[0].length);
      if (!new RegExp(`\\b${surname}`).test(after)) return true;
      // (r5) …and only a JOINED collaboration ("Le Corbusier (1887-1965), and Pierre
      // Jeanneret", "… & Andy Warhol (1928-1987)"). A maker named only inside the
      // WORK's title is the subject, not the hand: "STURTEVANT (1924-2014) Warhol
      // Flowers", "Gavin Turk (b. 1967) … Warhol". A tracked maker leading is left
      // to the reclassifier, which re-files the lot under them.
      if ((mk === 'art' || mk === 'design') && !TRACKED_SURNAMES.has(m[1].replace(/[.'’]+$/, '')) && !joinedCollab(after, surname)) return true;
    }
  }
  if ((mk === 'art' || mk === 'design') && notByMaker(artist, title, desc)) return true;
  return false;
}

const TRACKED_SURNAMES = new Set(Object.values(MAKER_SURNAME).flatMap(s => [s, s === 'prouv' ? 'prouvé' : s]));

/** the title LEADS with the maker ("Picasso (Pablo) -- …", "PABLO PICASSO L'Enterrement …",
 *  "[PICASSO] - Balzac …") — never a qualified lead ("After Pablo Picasso", "School of …") */
function makerLeads(t: string, surname: string): boolean {
  return new RegExp(`^\\W*(?!(?:after|d'apr|copy|school|circle|follower|manner|style|studio|workshop|atelier|attributed|imitator|homm?age|in the|portrait)\\b)(?:[a-zà-ÿ'’-]+\\.?\\s+){0,2}${surname}`).test(t);
}

/** the maker is a co-author: joined to the other artist, carrying their own life dates, or the
 *  named hand of the plates ("… with six full-page etchings … by Henri Matisse") */
function joinedCollab(after: string, surname: string): boolean {
  if (new RegExp(`\\bby (?:and after )?(?:[a-zà-ÿ.'’-]+\\s+){0,2}${surname}`).test(after)) return true;
  if (/^\s*(?:,\s*)?(?:and|&|\+|with|und|et|y)\b|^\s*[&+]/.test(after)) return true;
  return new RegExp(`\\b${surname}[a-zà-ÿ]*\\s*\\(\\s*(?:b\\.\\s*)?1[6-9]\\d\\d`).test(after);
}

/** artists whose practice IS re-making another artist's work — never the original's hand */
const APPROPRIATION_RE = /\b(?:(?:elaine )?sturtevant|mike bidlo|sherrie levine|richard pettibone|deborah kass|gavin turk|death nyc|mr\.? brainwash|thierry guetta|russell young)\b/;
const QUALIFIED_LEAD_RE = /^\s*(?:copy after|attributed to|circle of|school of|follower of|followers of|manner of|in the manner of|style of|in the style of|workshop of|studio of|atelier of|imitator of)\b/;

/**
 * (r5) The lot is ABOUT the maker, not BY them — appropriation, "after",
 * school-of, "in the manner of", homage. The classify.ts art-attribution pass
 * (NOT_BY_LEAD_RE / NOT_BY_INLINE_RE) knew these for a fixed surname list and
 * Sturtevant/Bidlo by name, at reclassify time; this is the same guard for
 * EVERY name-routed maker, applied where isMisattributed runs (the corpus
 * scrub before any stat, the maker shards and faces in emit-page-stats).
 */
export function notByMaker(artist: string, title: string, desc = ''): boolean {
  const surname = MAKER_SURNAME[artist];
  const t = (title || '').toLowerCase();
  const d = (desc || '').slice(0, 300).toLowerCase();
  if (QUALIFIED_LEAD_RE.test(t) || QUALIFIED_LEAD_RE.test(d)) return true;
  const appr = t.match(APPROPRIATION_RE);
  if (appr && !(surname && appr[0].includes(surname))) return true;
  // a title the maker leads keeps the maker ("Picasso (Pablo) -- Apollinaire … plates by Picasso … plates after Picasso")
  if (!surname || makerLeads(t, surname)) return false;
  // another TRACKED maker leading ("ROY LICHTENSTEIN … from Hommage à Picasso") is re-filed
  // under them by the reclassifier — never dropped here
  if (Object.values(MAKER_SURNAME).some(s => s !== surname && new RegExp(`^\\W*(?:[a-zà-ÿ.'’-]+\\s+){0,2}${s}`).test(t))) return false;
  const near = `(?:[a-zà-ÿ.'’-]+\\s+){0,2}${surname}`;
  // "(after Andy Warhol)", ", after Warhol", "in the manner of Picasso", "school of Matisse", "homage to Warhol"
  if (new RegExp(`(?:^|[\\s(,;])(?<!by and )(?:after|d'apr[eè]s|in the manner of|manner of|in the style of|style of|school of|circle of|follower of|imitator of|homm?age (?:[àa]|to))\\s+${near}\\b`).test(t)) return true;
  return false;
}
