/**
 * object-kind.ts — is this lot the KIND OF OBJECT its category promises?
 * (Oct 11 2026, R1 P0)
 *
 * The clean taxonomy files a lot by house, maker slug, sub-cat and drill, and
 * a handful slip through as the wrong thing: a Gibson Les Paul guitar filed
 * as a Sports Cards single (artist `sports-cards`, drill `racing`), a Pokémon
 * vinyl record as a Vintage (1996–2003) card, two Omega dinner MENUS and a
 * Cartier necklace as wristwatches, Michael Jackson's "Moonwalk" autobiography
 * under Space · Apollo, a Beatles record jacket under Props & Wardrobe.
 * "You follow Sports Cards · Singles" is true to the data and false to the
 * reader. A CATEGORY-level match (a category / sub follow, a quick-start
 * market, a fallback rung, a same-sub tie) needs this check; a NAMED match
 * (the maker, player or subject you follow) does not — an Omega menu is still
 * Omega's.
 *
 * Reads only what is on the served lot (objectClass, itemClass, formKey, the
 * title). Pure; no imports beyond the taxonomy.
 */
import { taxonOf } from './taxonomy';

export interface KindLot {
  artist: string;
  title: string;
  subCat?: string | null;
  drill?: string | null;
  formKey?: string | null;
  objectClass?: string | null;
  itemClass?: string | null;
  flown?: boolean | null;
  /** the build-stamped entity id, when the lot carries one */
  ek?: string | null;
}

/** a word that says the lot IS a timepiece (English, French, German, Italian, Spanish; model lines) */
const WATCH_WORD = /\b(?:watch(?:es)?|wristwatch|pocket ?watch|montre|chronograph|chronographe|uhr|orologio|reloj|tourbillon|ref(?:erence)?\.?\s*[0-9]|calibre|cal\.\s*[0-9]|movement|mouvement|daytona|submariner|speedmaster|seamaster|royal oak|nautilus|aquanaut|calatrava|reverso|santos|tank|datejust|day-date|gmt-master|explorer|carrera|perpetual|annual calendar|repeater|moon ?phase|complication|automatic|quartz|ellipse|cellini)\b/i;
/** jewelry, paper and table things a watch house's name rides on */
const NOT_A_WATCH = /\b(?:menu|collier|necklace|pendant|brooch|earrings?|cufflinks?|bangle|tiara|book|poster|lithograph|letter|cover|photo(?:graph)?|print|program|invitation)\b/i;
/** things a card sub is sometimes handed that are not cards (never a
 *  parallel's name: "Gold Vinyl Prizm" is a card, "Polydor Guitar Album #12"
 *  is a card; the upstream itemClass is too loose in TCG to trust alone —
 *  Professor Program promos read as tickets, Guinness-slabbed cards as records) */
const NOT_A_CARD = /\b(?:vinyl (?:in sleeve|record|album|lp)|record album|lp record|soundtrack|sales award|riaa|les paul|stratocaster|telecaster|hardshell case|autobiography|picture sleeve|jumpsuit|t-shirt|lunch ?box|plush)\b/i;
/** (Oct 29) memorabilia a card house files with its singles: a Type I / news
 *  service / wire PHOTOGRAPH (the image a card was made from is not the card —
 *  "1948 Topps Magic Photo" and "Photo Tattoo" are cards and stay), a replica
 *  or signed JERSEY / ball / bat (never a "Jersey Number Card", a "Game-Used
 *  Patch" or a "Rookie Ticket" parallel), a painted shikishi art board, a
 *  poster. Sold as "baseball cards" to a vintage-baseball desk. */
const NOT_A_CARD_MEM = /\b(?:type\s*[i1]\b[^,]{0,30}?\bphoto(?:graph)?s?|original\s+(?:type\s*[i1]\s+)?(?:news service\s+)?photo(?:graph)?s?|news service photo|wire photo|press photo|photo(?:graph)? by\b|replica (?:jersey|helmet)|(?:signed|game[- ]worn|game[- ]used|match[- ]worn|autographed) (?:jersey|ball|bat|helmet|glove|puck|cleats?|basketball|football|baseball|stick)\b(?!\s*(?:card|patch|swatch|relic|number|cut))|shikishi|art board|\bposter\b|strategy guide|guide ?book|handbook|player'?s guide|(?:trailer|film) reel|\b(?:vhs|dvd|blu-ray|laserdisc)\b|magazine|comic book|\bmanga\b|figurine|\bfigure\b|keychain|pin set|lanyard)/i;
/** a lot whose subject is a person or film of ANOTHER market (Michael Jackson's
 *  "Moonwalk" autobiography filed under Apollo) is not a space piece */
const OFF_MARKET_SUBJECT = /^sj:(?!science\|)/;
/** a record, album or its sleeve is not a prop or a costume */
const NOT_A_PROP = /\b(?:album|vinyl|gatefold|record jacket|picture sleeve|lp|45 rpm)\b/i;

const CARD_SUBS: Record<string, ReadonlySet<string>> = {
  'sports-cards': new Set(['singles']),
  tcg: new Set(['vintage', 'classic', 'modern']),
};

/** the lot is the kind of object its category / sub says (true when unsure) */
export function kindFits(l: KindLot): boolean {
  const t = taxonOf(l);
  const title = String(l.title || '');
  if (t.cat === 'watches') {
    const watchy = l.objectClass === 'watch' || /(?:wrist|pocket)-?watch/.test(l.formKey || '') || WATCH_WORD.test(title);
    return watchy && !(NOT_A_WATCH.test(title) && !WATCH_WORD.test(title));
  }
  const cards = CARD_SUBS[t.cat];
  if (cards && cards.has(t.sub)) {
    return !NOT_A_CARD.test(title) && !NOT_A_CARD_MEM.test(title);
  }
  // the science sub's people (Einstein, Vint Cerf) carry culture-person ids: only the space subs ask
  if (t.cat === 'space-science' && t.sub !== 'science') return !OFF_MARKET_SUBJECT.test(String(l.ek || ''));
  if (t.cat === 'entertainment' && t.sub === 'props-costumes') return !NOT_A_PROP.test(title) && l.itemClass !== 'record';
  return true;
}
