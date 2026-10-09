/**
 * subject-name.ts — (Oct 9) the PERSON a culture lot is about, read off a
 * bare-name title, and the gate of the person → domain map learned from the
 * corpus.
 *
 * RR's archive titles a lot by the person alone ("Paul Newman", "Abraham
 * Lincoln Document Signed", "Huey Long Signature"): no object or office word
 * names a domain, and the stamped subjectKeys keep the object words with the
 * name ("huey long signature"), so the subject vote never joins the same
 * person's worded lots ("Huey Long Signed Document as Governor" → political).
 * subjectNameOf reads ONLY a clean leading person name (2–4 capitalised words,
 * then a boundary: the end, an object word, a possessive, a colon / comma /
 * dash); stampSubCats votes name → domain over the lots the existing rules
 * already domained (settleNameDomains keeps a name only on strong evidence)
 * and fills culture lots that still carry NO domain after every rule.
 */

/** the words a person name is followed by in a lot title (the object / form) */
const NAME_END_WORDS = new Set([
  'signed', 'signature', 'signatures', 'autograph', 'autographs', 'autographed', 'document', 'documents', 'ds', 'letter', 'letters',
  'als', 'tls', 'ls', 'typed', 'handwritten', 'photo', 'photos', 'photograph', 'photographs', 'check', 'checks', 'cheque', 'archive',
  'collection', 'group', 'lot', 'book', 'books', 'program', 'programs', 'programme', 'card', 'cards', 'cut', 'quotation', 'quote',
  'manuscript', 'manuscripts', 'note', 'notes', 'telegram', 'telegrams', 'memo', 'menu', 'print', 'prints', 'sketch', 'drawing',
  'original', 'oversized', 'vintage', 'rare', 'personal', 'personally', 'owned', 'worn', 'used', 'endorsed', 'inscribed',
  'franked', 'cover', 'covers', 'envelope', 'partial', 'souvenir', 'twice', 'dual', 'multi', 'limited', 'framed', 'matted',
  'engraving', 'cdv', 'cabinet', 'postcard', 'postcards', 'christmas', 'greeting', 'contract', 'deed', 'commission', 'appointment',
  'pardon', 'certificate', 'warrant', 'animation', 'cel', 'cels', 'poster', 'posters', 'script', 'scripts', 'costume', 'guitar',
  'album', 'albums', 'record', 'records', 'ticket', 'tickets', 'jacket', 'shirt', 'hat', 'dress', 'ring', 'watch', 'item', 'items',
  'and',
]);
/** honorifics / ranks stripped from the front ("General George S. Patton") */
const HONORIFICS = new Set(['president', 'general', 'gen', 'admiral', 'adm', 'sir', 'dame', 'dr', 'doctor', 'captain', 'capt', 'colonel', 'col', 'major', 'senator', 'sen', 'governor', 'gov', 'lord', 'lady', 'rev', 'reverend', 'judge', 'justice', 'lieutenant', 'lt', 'commodore', 'field', 'marshal', 'mr', 'mrs', 'miss', 'ms']);
/** name particles that stay lower case inside a name ("Franz von Papen") */
const PARTICLES = new Set(['von', 'van', 'de', 'da', 'del', 'della', 'der', 'den', 'du', 'di', 'la', 'le', 'des', 'ter', 'ten']);
/** name suffixes, never part of the key */
const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'esq']);
/** words that mark a capitalised run as a place, an event, an organisation, a
 *  franchise or a lot phrase — never a person ("Civil War", "World War II",
 *  "Los Angeles", "United States Army", "Star Wars"). Common surnames and given
 *  names (Ford, White, Day, Hall, Lake, March, June, Post …) stay OUT of it. */
const NOT_PERSON_WORDS = new Set([
  'war', 'wars', 'civil', 'world', 'revolutionary', 'apollo', 'gemini', 'shuttle', 'space', 'nasa', 'los', 'las', 'angeles',
  'vegas', 'new', 'york', 'san', 'francisco', 'united', 'states', 'state', 'america', 'american', 'americans', 'national',
  'confederate', 'union', 'army', 'navy', 'corps', 'company', 'corporation', 'inc', 'club', 'society', 'university', 'college',
  'school', 'academy', 'hotel', 'county', 'city', 'street', 'railroad', 'railway', 'theatre', 'theater', 'studio', 'studios',
  'records', 'band', 'orchestra', 'group', 'lot', 'collection', 'series', 'movie', 'film', 'show', 'tv', 'television', 'radio',
  'christmas', 'easter', 'trek', 'disney', 'beatles', 'stones', 'brothers', 'bros', 'sisters', 'family', 'cast', 'crew', 'team',
  'yankees', 'dodgers', 'giants', 'battle', 'expedition', 'mission', 'flight', 'titanic', 'hindenburg', 'declaration',
  'independence', 'constitution', 'congress', 'senate', 'supreme', 'committee', 'department', 'office', 'times', 'news',
  'magazine', 'journal', 'gazette', 'tribune', 'library', 'museum', 'foundation', 'institute', 'hospital', 'masonic', 'brigade',
  'regiment', 'division', 'squadron', 'battalion', 'infantry', 'cavalry', 'artillery', 'volunteers', 'police', 'empire', 'kingdom',
  'republic', 'royal', 'imperial', 'british', 'french', 'german', 'nazi', 'soviet', 'russian', 'japanese', 'chinese', 'irish',
  'italian', 'spanish', 'mexican', 'canadian', 'indian', 'native', 'pony', 'express', 'ole', 'opry', 'fame', 'awards', 'oscar',
  'oscars', 'grammy', 'emmy', 'super', 'bowl', 'olympic', 'olympics', 'games', 'tour', 'concert', 'festival', 'exposition',
  'expo', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'happy', 'merry', 'celebrity',
  'celebrities', 'hollywood', 'broadway', 'vaudeville', 'jazz', 'opera', 'ballet', 'circus', 'looney', 'tunes', 'peanuts',
  'snoopy', 'batman', 'superman', 'spider', 'wizard', 'microsoft', 'enigma', 'motors', 'coca', 'cola', 'pepsi', 'autograph',
  'autographs', 'signed', 'signature', 'signatures', 'document', 'letter', 'photo', 'photograph', 'archive', 'original',
  'vintage', 'rare', 'important', 'historic', 'large', 'small', 'two', 'three', 'four', 'five', 'pair', 'set',
  // vetoed only in the pairings below (each is also a person's name)
  'james', 'bond', 'ford', 'mercury', 'white', 'red', 'black', 'great', 'little', 'wells', 'grand', 'donald', 'mickey', 'mouse',
  'star', 'west', 'wild', 'north', 'south', 'blue', 'old', 'golden', 'hall',
]);
/** the dual-use words of NOT_PERSON_WORDS veto a key only when it is the
 *  non-person pairing ("James Bond", "Red Sox"; "James Monroe" and "Betty
 *  White" are people) */
const PAIR_ONLY = new Map<string, RegExp>([
  ['james', /^james bond\b/], ['bond', /^james bond\b/], ['ford', /^ford motor/], ['mercury', /^mercury (?:seven|program|capsule|astronauts?)\b/],
  ['white', /^white (?:house|sox|star)\b/], ['red', /^red (?:sox|cross|army)\b/], ['black', /^black (?:hawk|panther|sabbath)\b/],
  ['great', /^great (?:britain|war|depression|lakes)\b/], ['little', /^little (?:rascals|big ?horn)\b/], ['wells', /^wells fargo\b/],
  ['grand', /^grand (?:ole|duke|duchess|army|canyon)\b/], ['donald', /^donald duck\b/], ['mickey', /^mickey mouse\b/],
  ['star', /^star (?:wars|trek)\b/], ['west', /^west (?:point|virginia)\b/], ['wild', /^wild west\b/], ['north', /^north (?:pole|carolina|dakota)\b/],
  ['south', /^south (?:pole|carolina|dakota)\b/], ['blue', /^blue (?:angels|jays)\b/], ['old', /^old (?:west|glory)\b/],
  ['golden', /^golden (?:gate|globe|state)\b/], ['hall', /\bhall of\b|^hall$/],
]);

const tokClean = (w: string) => w.replace(/^[(“"‘'[]+|[)”"’',.;:!?\]]+$/g, '');
const isInitial = (w: string) => /^[A-Z]\.?$/.test(w) || /^(?:[A-Z]\.){2,3}$/.test(w);
const isRoman = (w: string) => /^(?:II|III|IV|VI|VII|VIII)$/.test(w);
/** a Capitalised name word: Upper then lower ("Newman", "McCartney",
 *  "DiMaggio", "O'Neill", "Day-Lewis") — never ALL CAPS (caps headlines) */
const isNameWord = (w: string) => /^(?:[A-Z][a-z]+(?:[A-Z][a-z]+)?|(?:O|D)['’][A-Z][a-z]+)(?:-[A-Z][a-z]+)*$/.test(w);

/** the join key of a person name: lower case, periods and suffixes dropped,
 *  initials and particles KEPT — "Thomas O. Paine" (NASA) is not "Thomas
 *  Paine" (Common Sense) */
export function personKey(words: readonly string[]): string {
  return words
    .filter(w => !SUFFIXES.has(w.toLowerCase().replace(/\./g, '')) && !isRoman(w))
    .map(w => w.replace(/[’]/g, "'").replace(/\./g, '').toLowerCase())
    .join(' ');
}

/** the keys a DOMAINED lot votes under: its own, and (when it carries an
 *  initial) the initial-less key — a bare "William Westmoreland" lot reads the
 *  votes of "William C. Westmoreland", while a "Thomas O. Paine" lot reads only
 *  its own key, never Thomas Paine's */
export function personVoteKeys(key: string): string[] {
  const bare = key.split(' ').filter(w => w.length > 1).join(' ');
  return bare !== key && bare.split(' ').length >= 2 ? [key, bare] : [key];
}

/** a key that reads as a person: ≥ 2 words, none of them a place / event /
 *  organisation word (dual-use words only in their non-person pairing) */
function personLike(key: string): boolean {
  const parts = key.split(' ');
  if (parts.length < 2 || parts.length > 5) return false;
  for (const p of parts) {
    if (!NOT_PERSON_WORDS.has(p)) continue;
    const pair = PAIR_ONLY.get(p);
    if (!pair || pair.test(key)) return false;
  }
  return true;
}

/**
 * The person a culture lot title leads with, as a join key, or null.
 * Conservative: 2–4 Capitalised words (+ initials / particles / Jr.) after an
 * optional honorific, followed by the END of the title or a boundary (an
 * object word, a possessive, a colon / comma / dash, a "(2)" count). A
 * generic run (a war, a place, a franchise, "The …"), two people ("… and …"),
 * a lead year / count / quote, a lower-case continuation and ALL CAPS are all
 * rejected. Surname-first "Lincoln, Abraham" reads as "abraham lincoln".
 */
export function subjectNameOf(title: string | null | undefined): string | null {
  let t = String(title || '').trim();
  if (!t || t.length > 200) return null;
  // a quoted title / franchise ("“Casablanca” Lobby Card"), a count or a year lead
  if (/^[“"‘'(\[\d#$]/.test(t)) return null;
  // a quoted nickname inside the name: Charles “Lucky” Luciano → Charles Luciano
  t = t.replace(/^([A-Z][a-z]+)\s+[“"‘'][A-Za-z. ]{2,20}[”"’']\s+(?=[A-Z])/, '$1 ');
  // surname-first: "Lincoln, Abraham" / "Lincoln, Abraham Signed …"
  const inv = t.match(/^([A-Z][a-z]+(?:[A-Z][a-z]+)?),\s+([A-Z][a-z]+)(?:\s+([A-Z]\.))?(?:$|\s*[:–—-]|\s+([A-Za-z]+)(?=$|[\s,.:;]))/);
  if (inv) {
    const nxt = (inv[4] || '').toLowerCase();
    const g = inv[2].toLowerCase();
    if ((!inv[4] || (NAME_END_WORDS.has(nxt) && nxt !== 'and')) && !HONORIFICS.has(g) && !/^(?:queen|king|prince|princess|duke|duchess|earl|count|countess|baron|lord)$/.test(g)) {
      const key = personKey([inv[2], ...(inv[3] ? [inv[3]] : []), inv[1]]);
      return personLike(key) ? key : null;
    }
    return null;
  }
  const raw = t.split(/\s+/);
  const words: string[] = [];
  let i = 0;
  while (i < raw.length && HONORIFICS.has(tokClean(raw[i]).toLowerCase())) i++;
  let boundary = false;
  for (; i < raw.length; i++) {
    const w0 = raw[i];
    if (w0 === '-' || w0 === '–' || w0 === '—') { boundary = true; break; }
    if (/^\(\d+\)$/.test(w0) && words.length) { boundary = true; break; }
    // a possessive ends the name: "Elvis Presley's Guitar", "Jones' …"
    const poss = w0.match(/^([A-Za-z-]+)['’]s?[,:;.]?$/);
    if (poss && !/^(?:O|D)$/.test(poss[1])) {
      if (!isNameWord(poss[1])) return null;
      words.push(poss[1]);
      boundary = true; break;
    }
    const trailingStop = /[,:;–—]$/.test(w0);
    const w = tokClean(w0);
    if (!w) return null;
    const lw = w.toLowerCase();
    if (words.length && NAME_END_WORDS.has(lw)) {
      if (lw === 'and') return null; // two people
      boundary = true; break;
    }
    if (isNameWord(w) || isInitial(w) || (words.length > 0 && (PARTICLES.has(w) || SUFFIXES.has(lw.replace(/\./g, '')) || isRoman(w)))) {
      words.push(w);
      if (words.length > 6) return null;
      if (trailingStop) { boundary = true; break; }
      continue;
    }
    // a lower-case word, a number, ALL CAPS, '&' — not a clean name
    return null;
  }
  if (i >= raw.length) boundary = true;
  if (!boundary) return null;
  while (words.length && PARTICLES.has(words[words.length - 1])) words.pop();
  const real = words.filter(isNameWord);
  if (real.length < 2 || real.length > 4) return null;
  const key = personKey(words);
  if (/^the\b/.test(key)) return null;
  return personLike(key) ? key : null;
}

/** the evidence gate of the learned name → domain map */
export interface NameDomainGate { minN: number; purity: number }
/** ≥ 5 domained lots, the top domain ≥ 80% of them (Oct 9 corpus: 1,538 lots
 *  filled, 38/40 hand-judged right; ≥3 adds ~670 more, ≥0.9 drops ~220) */
export const NAME_DOMAIN_GATE: NameDomainGate = { minN: 5, purity: 0.8 };

/** name → domain from `votes` (name → domain → count): a name is kept only
 *  with ≥ minN domained lots and its top domain holding ≥ purity of them.
 *  Ties break alphabetically, so the map is deterministic. */
export function settleNameDomains(votes: Map<string, Map<string, number>>, gate: NameDomainGate = NAME_DOMAIN_GATE): Map<string, string> {
  const out = new Map<string, string>();
  votes.forEach((inner, k) => {
    let tot = 0, best = '', bestN = 0;
    inner.forEach((n, d) => { tot += n; if (n > bestN || (n === bestN && d < best)) { best = d; bestN = n; } });
    if (tot >= gate.minN && bestN / tot >= gate.purity) out.set(k, best);
  });
  return out;
}
