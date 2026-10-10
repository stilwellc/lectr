/**
 * lead-year.ts — the ONE rule for a title's leading two-digit year (Oct 9
 * 2026). Goldin leads with "11 T206 …", "87 Fleer #57 …", "24 Topps Chrome …",
 * "92 John H. Ryder Studio Cabinet …"; other houses lead with a LOT NUMBER
 * ("29 Topps 1981 Cello …", "27 Circa 1870s … CDV"). Both the card identity
 * parser (cards.ts parseCard → cardKey / cardLadderKey / era facets) and the
 * display widening (utils.ts expandLeadYear) read the century from here, so
 * the year a card is KEYED under is the year it is SHOWN under.
 *
 * The old parser read every two-digit year ≤ 40 as 20xx: a 1911 T206 keyed
 * 2011, an M101-2 keyed 2013, "09-11 T206" keyed 2009-11.
 *
 * Century, only when it is certain (else null — never guessed):
 *   · the number is a lot number, not a year — a 4-digit year / decade is
 *     among the next three words ("67 Circa 1990 Star", "30 Beautiful Early
 *     1900s") → null;
 *   · a 19th-century catalog code follows (N172 Old Judge, N28 Allen & Ginter)
 *     → 18xx (60–99 only);
 *   · a pre-war catalog code / set follows (T206, E97, M101-2, W514, P2, R327,
 *     D304, White Border, Cracker Jack) → 19xx; Goudey / Diamond Stars / Play
 *     Ball (1933–41 issues) only from 27 up;
 *   · a card brand follows: 00–26 → 20xx, 27–99 → 19xx (a brand then a
 *     4-digit year is a lot number from 27 up — "29 Topps 1981 Cello");
 *   · Goldin's year-led convention (the parser's default — it is never handed
 *     a house): a 19th-century format named anywhere (cabinet card, CDV, Old
 *     Judge, Kalamazoo…) with 60–99 → 18xx ("92 John H. Ryder Studio Cabinet
 *     Cy Young" is 1892); else 27–99 before a capitalised word → 19xx ("94
 *     Mario Lemieux…", no card is from 2027+); 00–26 before anything else
 *     ("26 Babe Ruth Sliding…" = 1926, "14 Fernando Torres…" = 2014) → null.
 */

export type Century = '18' | '19' | '20';

/** the leading two-digit year token: "11 ", "'96 ", "09-11 " (range tail kept) */
export const LEAD_YY = /^'?(\d{2})(?:-(\d{2}))?\b\s*/;

/** card brands that only exist as a 19xx/20xx set word — "87 Fleer", "24 Topps Chrome", "24 FC Barcelona Topps…" */
const LEAD_BRAND = /^(?:(?:FC|AC|AS|CF|SL) \S+ |NBA |NFL |NHL )?(?:Topps|Panini|Upper Deck|UD|Press Pass|In The Game|Contenders|Chronicles|Mosaic|Optic|Immaculate|Flawless|Spectra|Obsidian|Prestige|Zenith|Crown Royale|Pacific|Pinnacle|Bazooka|Futera|Sereal|One Piece|Bowman(?:'s)?|SkyBox|Skybox|Fleer|Donruss|Prizm|Select|Leaf|Hoops|Flair|National Treasures|Definitive|DAKA|Pok[eé]mon|O-Pee-Chee|Score|Stadium Club|Finest|SP|SPx|Mundicromo|Parkhurst|Star(?= #| Co\b| Court| Basketball| All-))\b/;
/** 19th-century catalog codes at the head — N172 Old Judge (1887–90), N28 Allen & Ginter (1887) */
const LEAD_C19_CODE = /^(?:N\d{1,3}|Old Judge)\b/;
/** pre-war catalog codes and sets — always 19xx: "11 T206", "16 M101-2", "10 E97 Briggs", "21 W514" */
const LEAD_PREWAR = /^(?:T\d{1,3}|E\d{1,3}|M10\d|W5\d\d|P2|R3\d\d|D\d{3}|White Border|Cracker Jack)\b/;
/** 1930s–40s gum issues — re-used as modern set names (Upper Deck Goudey 2007–08), so 27+ only */
const LEAD_PREWAR_30S = /^(?:Goudey|Diamond Stars|Play Ball)\b/;
/** 19th-century formats named anywhere in a Goldin title — "92 John H. Ryder Studio Cabinet Cy Young" */
const C19_CUE = /\b(?:Cabinet|Old Judge|N\d{2,3}|CDV|Carte de Visite|Tintype|Daguerreotype|Allen & Ginter|Goodwin (?:&|and) Co|Mayo(?:'s)? Cut Plug|Kalamazoo Bats)\b/;
/** a year / decade among the next three words — the lead number is a lot
 *  number ("30 Beautiful Early 1900s …", "67 Circa 1990 Star …") */
const LOT_NUMBER_SHAPE = /^(?:\S+\s+){0,2}(?:1[6-9]|20)\d{2}(?:'?s)?\b/;

export interface LeadYearOpts {
  /** apply Goldin's year-led convention to a lead no code/brand vouches for.
   *  The card parser always does (two-digit-led card titles are Goldin's);
   *  the display only when the lot is Goldin's. */
  yearLed?: boolean;
}

/** The century of a leading two-digit year `yy` given the title text after
 *  it (`rest`), or null when it is not certain. */
export function leadCentury(yy: string | number, rest: string, opts: LeadYearOpts = {}): Century | null {
  const n = typeof yy === 'number' ? yy : parseInt(yy, 10);
  if (!Number.isFinite(n) || n < 0 || n > 99) return null;
  const r = (rest || '').trimStart();
  if (!r) return null;
  const brand = r.match(LEAD_BRAND);
  // a brand then a year: a modern retro insert ("26 Topps 1980-81 Topps
  // Rookie Autographs") — or a lot number before a box lot ("29 Topps 1981
  // Cello …"); only the first is possible from 27 down
  if (brand) return n <= 26 ? '20' : /^\s*(?:1[6-9]|20)\d{2}\b/.test(r.slice(brand[0].length)) ? null : '19';
  if (LOT_NUMBER_SHAPE.test(r)) return null;
  if (LEAD_C19_CODE.test(r)) return n >= 60 ? '18' : null;
  if (LEAD_PREWAR.test(r)) return '19';
  if (LEAD_PREWAR_30S.test(r)) return n >= 27 ? '19' : null;
  if (!opts.yearLed) return null;
  if (C19_CUE.test(r)) return n >= 60 ? '18' : null;
  if (n > 26 && /^[A-Z]/.test(r)) return '19';
  return null;
}

export interface LeadYear {
  /** the 4-digit year as printed, widened: "1911", "1909-11", "2024" */
  year: string;
  /** the matched leading token, its length = how much of the title it spans */
  raw: string;
}

/** Read a title's leading two-digit year, widened by leadCentury — null when
 *  the title does not lead with one or the century is not certain. */
export function leadYearOf(title: string, opts: LeadYearOpts = {}): LeadYear | null {
  const t = title || '';
  const m = t.match(LEAD_YY);
  if (!m) return null;
  const c = leadCentury(m[1], t.slice(m[0].length), opts);
  if (!c) return null;
  return { year: `${c}${m[1]}${m[2] ? `-${m[2]}` : ''}`, raw: m[0] };
}
