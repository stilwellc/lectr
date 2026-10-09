/**
 * sub-cats.ts — the sub-category taxonomy stamps (Collin-approved tree,
 * Jul 31 2026). Two levels below the vertical:
 *
 *   subCat — the KIND within a vertical (sports: cards/game-used/tickets…;
 *            watches: wristwatches/pocket-watches/clocks; art: prints/originals…)
 *   drill  — the performance split within a kind (sport for sports kinds,
 *            model family for wristwatches, subject domain for culture,
 *            program for space, material for design)
 *   flown  — space-only boolean (flown vs not-flown is its own A-vs-B)
 *
 * Everything here is ADDITIVE metadata: no engine (comps/value/backtest)
 * reads these fields. Stamped corpus-wide by corpus-normalize (idempotent,
 * deterministic — derived purely from existing fields, so re-runs converge).
 */
import { ARTIST_MARKET } from '../../app/constants';
import { SUBJECT_DOMAINS } from './subject-domains';
import { NON_SPORT_TCG_RE } from './classify';

type Lot = Record<string, unknown>;

// ── sports ──────────────────────────────────────────────────────────────────
const SPORTS_KIND: Record<string, string> = {
  'sports-cards': 'cards',
  'game-used': 'game-used',
  'sports-memorabilia': 'memorabilia',
  'tickets-passes': 'tickets',
  'trophies-awards': 'trophies',
  // Aug-2026 expansion pseudo-artists (REA/H&S/SCP/Lelands/ML/LOTG) — absent
  // from this map, stampSubCats was WIPING their crawler-stamped subCats
  // (~280k rows, Aug 13 audit)
  'graded-cards': 'cards',
  'memorabilia': 'memorabilia',
  'autographs': 'autographs',
  'unopened-wax': 'wax',
  'type-1-photos': 'photos',
  'programs-publications': 'programs',
  'equipment-artifacts': 'equipment',
};
// Goldin's stamped sport values → our drill slugs
const SPORT_SLUG: Record<string, string> = {
  'Basketball': 'basketball', 'Baseball': 'baseball', 'Football': 'football',
  'Soccer': 'soccer', 'Hockey': 'hockey', 'Boxing / MMA': 'boxing-mma',
  'Golf': 'golf', 'Racing': 'racing', 'Tennis': 'tennis', 'Olympics': 'olympics',
  'Wrestling': 'wrestling',
};
export const sportSlugOf = (raw: unknown): string | null =>
  typeof raw === 'string' ? SPORT_SLUG[raw] ?? null : null;

// (wave 2) the sport a sports lot's OWN words name, when no house stamp or
// learned player says so — the expansion houses (REA / H&S / Lelands / LOTG /
// ML / SCP) stamp no sport, so ~385 audited vintage baseball cards, tickets
// and signed balls carried no drill. Ordered: explicit sport words, then
// leagues / events, then franchise names unique to one sport, then the
// pre-war set codes and vintage issues (all baseball once the non-sport
// issues are out of the vertical — classify.ts sportsHouseCardLotKind).
const SPORT_WORDS: [string, RegExp][] = [
  ['boxing-mma', /\b(?:boxing|boxers?|heavyweight|middleweight|welterweight|lightweight|ufc|mma|prize ?fight(?:ers?|s)?|fight[- ]worn|title fight|bout|abe attell|jack dempsey|gene tunney|joe louis|rocky marciano|jack johnson|john l\.? sullivan|jim corbett|bob fitzsimmons|jim jeffries|stanley ketchel|sam langford|joe gans|max schmeling|max baer|jersey joe walcott|ezzard charles|sugar ray robinson|muhammad ali|cassius clay|joe frazier|george foreman|sonny liston|floyd patterson|sugar ray leonard|marvin hagler|mike tyson|jack sharkey|primo carnera|battling nelson|terry mcgovern)\b/i],
  // (wave 3) the old club names a golf lot is titled by ("A JEAN GASSIAT PUTTER")
  ['golf', /\b(?:golf|golfer|pga|masters tournament|ryder cup|british open|putters?|niblicks?|mashies?|cleeks?|featherie|feathery|gutty|gutta[- ]percha ball)\b/i],
  ['tennis', /\b(?:tennis|wimbledon|us open tennis)\b/i],
  ['racing', /\b(?:nascar|formula (?:1|one)|f1|indy ?500|racing|daytona 500)\b/i],
  ['wrestling', /\b(?:wrestling|wrestler|wwe|wwf|wcw)\b/i],
  ['olympics', /\b(?:olympics?|olympic games)\b/i],
  ['hockey', /\b(?:hockey|nhl|stanley cup|puck|maple leafs|canadiens|red wings|blackhawks|bruins)\b/i],
  // (wave 3) WNBA and the Hoops card brand ("SkyBox Hoops", "NBA Hoops")
  ['basketball', /\b(?:basketballs?|nba|wnba|aba|final four|lakers|celtics|knicks|76ers|pistons|warriors|harlem globetrotters|hoops)\b/i],
  ['football', /\b(?:footballs?|nfl|afl|super bowl|heisman|rose bowl|packers|steelers|cowboys|49ers|redskins|buccaneers|seahawks|bengals)\b/i],
  ['soccer', /\b(?:soccer|fifa|world cup|premier league|la liga|champions league|fc barcelona|real madrid|manchester united|boca juniors)\b/i],
  ['baseball', /\b(?:baseballs?|base ball|b\.b\.c\.|mlb|world series|home runs?|perfect game|no-hitter|lineup cards?|line-up cards?|louisville slugger|national league|american league|federal league|negro leagues?|pcl|yankees|red sox|white sox|dodgers|cubs|mets|phillies|orioles|pirates|tigers|indians|athletics|brewers|astros|padres|mariners|expos|twins|royals|braves|reds|senators|browns|doves|red stockings|highlanders|superbas|beaneaters|naps)\b/i],
];
/** pre-war set codes and vintage issues that are baseball (T206, E90, N172, D304, M116, W551, R319, Goudey, Old Judge …) */
const BASEBALL_ISSUE_RE = /^\s*(?:\d{1,3}\s+)?(?:(?:19|18)\d\d(?:-\d{2,4})?\s+)?(?:[TEDMNRW]-?\d{1,3}(?:-\d)?|N-?Unc)\b|\b(?:goudey|play ball|cracker jack|zeenut|old judge|delong|diamond stars|turkey red|sporting life|bazooka|double play|red man|kahn'?s|exhibits?|leaf|callahan|perez-steele|american caramel|tango (?:brand )?eggs|mayo'?s cut plug|kalamazoo bats|max stein)\b/i;
/** (wave 3) the pre-war BASEBALL catalogue codes wherever the title names them
 *  ("1909-11 American Caramel E90-1 Joe Jackson", "All (3) 1909-1911 T206
 *  Christy Mathewson Poses") — the leading-code test above misses a code after
 *  a lot count or a maker name. Only the codes that are baseball-only issues. */
const BASEBALL_CODE_ANY_RE = /\b(?:T20[1-7]|T21[3-6]|T222|E9\d|E1[0-4]\d|M101|M116|N167|N172|N284|N300|D3\d\d)(?:-\d)?\b/;
/** (wave 4) pre-war issues that are BASEBALL-only (R331 National Chicle is
 *  football, T9 / T218 / N162 boxers and champions — the catalogue letter
 *  alone does not say baseball) */
const PREWAR_BASEBALL_ISSUE_RE = /\bR319\b|\bgoudey\b|\bplay ball\b|\bcracker jack\b|\bzeenut\b|\bold judge\b|\bdelong\b|\bdiamond stars\b|\bbatter-up\b|\bsporting (?:news|life)\b/i;
/** association football / cricket / rugby lots carry no drill of ours (and a
 *  London "Football Memorabilia" sale is soccer) */
const NO_SPORT_DRILL_RE = /\b(?:cricket|rugby|polo|croquet|rowing|regatta|curling)\b/i;
export function sportFromText(title: string): string | null {
  for (const [sport, re] of SPORT_WORDS) if (re.test(title)) return sport;
  return BASEBALL_ISSUE_RE.test(title) || BASEBALL_CODE_ANY_RE.test(title) ? 'baseball' : null;
}
/** (wave 3) the sport words only — no vintage-issue brand ("Leaf", "Exhibits"
 *  print every sport today): the evidence a learned player / set map may
 *  vote with */
export function sportWordOf(title: string): string | null {
  for (const [sport, re] of SPORT_WORDS) if (re.test(title)) return sport;
  return BASEBALL_CODE_ANY_RE.test(title) ? 'baseball' : null;
}
/** (wave 3) the vintage card houses (REA, H&S, Memory Lane, LOTG, SCP, Lelands) */
const VINTAGE_CARD_HOUSES = new Set(['REA', 'Huggins & Scott', 'Lelands', 'Love of the Game', 'SCP', 'Memory Lane']);
/** non-sport / non-baseball issue words the vintage-house prior must not read
 *  as baseball (Buffalo Bill cabinets, "Chiefs and Rulers" albums, Adventure gum) */
const NON_BASEBALL_ISSUE_RE = /\b(?:cabinets?|albums?|chiefs|rulers|actors?|actress(?:es)?|adventure|presidents?|indian|wild west|buffalo bill|circus|military|war|flags|birds|animals|cowboys?)\b/i;
/** (wave 3) the houses whose "Football" sales are association football */
const UK_FOOTBALL_HOUSES = new Set(["Christie's", 'Bonhams']);
const SALE_SPORT_WORDS: [string, RegExp][] = [
  ['basketball', /\bnba\b|\bwnba\b|\bbasketball\b/i],
  ['golf', /\bgolf/i],
  ['olympics', /\bolympic/i],
  ['tennis', /\btennis\b|\bwimbledon\b/i],
  ['boxing-mma', /\bboxing\b|\bufc\b/i],
  ['hockey', /\bhockey\b|\bnhl\b/i],
  ['baseball', /\bbaseball\b|\bmlb\b|\bworld series\b/i],
  ['soccer', /\bsoccer\b|\bworld cup\b/i],
  ['racing', /\bmotor ?sport|\bracing\b|\bformula (?:1|one)\b|\bnascar\b/i],
  ['wrestling', /\bwrestling\b/i],
];
/** (wave 3) The sport a SINGLE-SPORT sale names ("Golfing Memorabilia",
 *  "Nba Auctions Summer Series", "Football Memorabilia" in London) — null for
 *  a mixed or multi-sport sale ("Cricket Tennis Golf Memorabilia", "Sporting
 *  Books And Memorabilia"). Sotheby's NBA sales print no sport in 30% of their
 *  titles; 1,529 Christie's football lots carried none and 514 read 'football'
 *  (American) off the word. */
export function sportOfSale(sale: string | null | undefined, house: string | null | undefined): string | null {
  const s = String(sale || '');
  if (!s || NO_SPORT_DRILL_RE.test(s) || /\btraditional sports?\b|\bsporting\b|\bsports\b/i.test(s)) return null;
  const hits = new Set<string>();
  for (const [sport, re] of SALE_SPORT_WORDS) if (re.test(s)) hits.add(sport);
  if (/\bnfl\b/i.test(s)) hits.add('football');
  if (/\bfootball\b/i.test(s)) hits.add(UK_FOOTBALL_HOUSES.has(String(house || '')) ? 'soccer' : 'football');
  return hits.size === 1 ? Array.from(hits)[0] : null;
}

// ── watches ─────────────────────────────────────────────────────────────────
// model families per maker, matched over `${reference} ${title}` lowercase.
// ORDER MATTERS: specific families before generic complications (a Daytona is
// a chronograph — daytona must win).
const WATCH_FAMILIES: Record<string, [string, RegExp][]> = {
  'rolex': [
    ['daytona', /daytona/], ['submariner', /submariner/], ['gmt-master', /gmt/],
    ['day-date', /day-?date/], ['datejust', /datejust/], ['explorer', /explorer/],
    ['sea-dweller', /sea-?dweller/], ['yacht-master', /yacht-?master/],
    ['milgauss', /milgauss/], ['air-king', /air-?king/], ['cellini', /cellini/],
    ['oyster-perpetual', /oyster ?perpetual|oysterperpetual/],
  ],
  'patek-philippe': [
    ['nautilus', /nautilus/], ['aquanaut', /aquanaut/], ['calatrava', /calatrava/],
    ['world-time', /world ?time|heures universelles/], ['ellipse', /ellipse/],
    ['gondolo', /gondolo/], ['twenty-4', /twenty.?4/],
    ['perpetual-calendar', /perpetual calendar|quantieme perpetuel|quantième perpétuel/],
    ['chronograph', /chronograph|chronographe/],
  ],
  'audemars-piguet': [
    ['royal-oak', /royal ?oak/], ['millenary', /millenary/],
    ['jules-audemars', /jules audemars/], ['perpetual-calendar', /perpetual calendar/],
    ['chronograph', /chronograph/],
  ],
  'cartier': [
    ['tank', /\btank\b/], ['santos', /santos/], ['panthere', /panth[eè]re/],
    ['crash', /crash/], ['ballon-bleu', /ballon bleu/], ['pasha', /pasha/],
    ['tortue', /tortue/], ['baignoire', /baignoire/],
  ],
  'omega': [
    ['speedmaster', /speedmaster/], ['seamaster', /seamaster/],
    ['constellation', /constellation/], ['de-ville', /de ?ville/],
  ],
};

// ── culture ─────────────────────────────────────────────────────────────────
// itemClass (stamped by stampCultureAxes) → kind rollup
const CULT_KIND: Record<string, string> = {
  'signed-photo': 'photos', 'photo': 'photos',
  'document': 'documents', 'signed-cut': 'documents', 'check': 'documents', 'script': 'documents',
  'autograph-other': 'autographs',
  'costume': 'worn-personal',
  'instrument': 'instruments', 'award': 'awards', 'prop': 'props',
  'poster': 'posters', 'record': 'records', 'ticket': 'tickets',
  // (Oct 8) animation cels / production drawings were stamped itemClass
  // 'cel-art' but rolled up to 'other'
  'cel-art': 'cel-art',
};
// (wave 3) the domain a culture lot's OWN words name, when no curated subject
// does — 97k culture lots carried no drill (RR's "<Name> Signed Photograph /
// Letter" titles, Goldin's "Type I Original Photo" captions). The object /
// office words are read in the title, then the head of the description; the
// EARLIEST-named domain wins ("Hendrix … Concert Full Ticket" is music,
// "Impeachment Trial Pass" political). Royalty needs a title + name ("Queen
// Victoria", "King Louis XIII"): Queen the band is music.
const CULT_TEXT_DOMAIN: [RegExp, string][] = [
  [/\b(?:astronauts?|cosmonauts?|nasa|apollo \d+|space shuttle|mercury seven|moonwalkers?)\b/i, 'space-science'],
  [/\b(?:signers? of the declaration|declaration (?:of independence )?signers?|presidents?|presidential|vice[- ]president|first lady|white house|senat(?:e|ors?)|congress(?:man|woman|ional)?|impeachment|(?:presidential|political) campaign|campaign (?:buttons?|posters?|pins?|banners?|ribbons?|badges?)|inaugura(?:l|tion)|jugate|supreme court|chief justice|governor|secretary of state|prime minister|parliament|mayor|ambassador|electoral|confederate president|political)\b/i, 'political'],
  [/\b(?:concerts?|tour (?:posters?|programs?|books?|jackets?|shirts?|pass(?:es)?)|(?<!(?:photo|photograph|autograph|stamp|scrap|sticker|card|cabinet card) )albums?(?!\s+pages?)|rock band|the band|band[- ](?:signed|members?)|guitars?|singers?|songs?|songwriter|lyrics?|rock (?:and|&|n'?) roll|vinyl|gold record|platinum record|grammy|drum ?sticks?|drumheads?|setlist|set list|stage[- ](?:worn|played|used)|backstage|recording|motown|woodstock|orchestra|opera|symphony|composer|musical quot\w*|musical score|ballroom)\b/i, 'music'],
  [/\b(?:films?|movies?|motion picture|screen[- ](?:used|worn|matched)|production[- ](?:made|used|drawing|cels?|art)|film studios?|actors?|actress(?:es)?|one[- ]sheets?|lobby cards?|animation|animated|cels?|walt disney|disney|television|tv series|tv show|sitcom|episode|ursa|oscars?|academy awards?|emmys?|hollywood|filmmakers?|screenplay|shooting script|movie poster|dicaprio|winslet)\b/i, 'hollywood'],
  [/\b(?:wwii|ww2|wwi|world war|army|navy|naval|admiral|soldiers?|battle(?:ship|field)?|regiment(?:al)?|air aces?|luftwaffe|military|marine corps|usmc|usaf|pearl harbor|d-day|nazi|third reich|medal of honor|fighter pilot|(?:civil|revolutionary) war(?![- ](?:dated|date))|war of 1812|continental army|confederate|union army)\b/i, 'military'],
  // (Oct 8) ~28k historical culture lots fell to Entertainment for want of a
  // cue: the notorious (crime), the aviators and polar explorers (aviation —
  // filed military before), and the event / document / church words
  [/\b(?:gangsters?|mobsters?|mafia|mug ?shots?|outlaws?|bootlegg(?:er|ers|ing)|wanted poster|alcatraz|bank robber|serial killer|al capone|john dillinger|bonnie (?:and|&) clyde|clyde barrow|bonnie parker|baby face nelson|pretty boy floyd|machine gun kelly|billy the kid|jesse james|bugsy siegel|lucky luciano|dutch schultz|charles manson|lee harvey oswald|jack ruby|john wilkes booth|lizzie borden)\b/i, 'crime'],
  [/\b(?:aviation|aviators?|aviatrix|aeronaut\w*|airplanes?|aeroplanes?|airships?|zeppelin|hindenburg|lindbergh|spirit of st\.? louis|wright brothers|orville wright|wilbur wright|kitty hawk|amelia earhart|earhart|wiley post|bl[eé]riot|north pole|south pole|antarctic\w*|arctic expedition|polar expedition|peary|shackleton|amundsen|nansen|richard e\.? byrd|admiral byrd)\b/i, 'aviation'],
  // the Titanic of the 1997 film (a screen-used prop, a DiCaprio still) is film
  [/\b(?:titanic\b(?!.*\b(?:screen[- ](?:used|worn|matched)|production[- ](?:used|made)|dicaprio|winslet|james cameron|props?|1953|1997|20th century[- ]fox)\b)|lusitania|newspapers?|colonial (?:currency|notes?|bills?)|continental currency)\b/i, 'historic'],
  // case-sensitive church titles: John Pope the Union general is not a pope
  [/\b(?:Pope|POPE) (?:John|JOHN|Paul|PAUL|Pius|PIUS|Benedict|BENEDICT|Francis|FRANCIS|Leo|LEO|Gregory|Clement|Urban|Innocent|Sixtus|Julius)\b|\b(?:[Pp]apal|PAPAL|[Vv]atican|VATICAN|[Aa]rchbishop|ARCHBISHOP)\b|\b(?:[Cc]ardinal|CARDINAL) [A-Z]|\b(?:[Ss]aint|SAINT) (?:Teresa|Mother Teresa|John Paul|Padre Pio|Bernadette|Junipero|Elizabeth Ann Seton|Katharine Drexel)\b/, 'historic'],
  // case-sensitive: a royal title + a capitalised name ("King Louis XIII",
  // "QUEEN VICTORIA"); Prince the musician is not royalty
  [/\b(?:[Kk]ing|KING) (?:George|GEORGE|Louis|LOUIS|Henry|HENRY|Edward|EDWARD|Charles|CHARLES|William|WILLIAM|James|JAMES|Richard|RICHARD|Philip|PHILIP|Ferdinand|Francis|FRANCIS|Frederick|Gustav|Henri|Wilhelm|Christian|Olav|Alexander|Peter|Khalid|Fahd|Saud|Haakon|Leopold|Alfonso|Carlos|Juan|Umberto|Victor|Farouk|Hussein|Faisal|Kalakaua|Kamehameha)\b|\b(?:[Qq]ueen|QUEEN) (?:[Vv]ictoria|VICTORIA|[Ee]lizabeth|ELIZABETH|[Mm]ary|MARY|[Aa]nne|ANNE|[Mm]other|MOTHER|[Aa]lexandra|[Cc]harlotte|[Mm]arie)|\b(?:[Pp]rince|PRINCE)(?:ss|SS)? (?:of|OF) [A-Z]|\b(?:[Pp]rincess|PRINCESS) (?:Diana|DIANA|Grace|GRACE|Margaret|MARGARET|Anne|ANNE|Alexandra)\b|\b(?:[Pp]rince|PRINCE) (?:Albert|Charles|Philip|William|Harry|Edward|Andrew|Rainier|Henry|Frederick|Louis)\b|\b(?:[Ee]mperor|EMPEROR|[Ee]mpress|EMPRESS|[Cc]zar|CZAR|[Tt]sar|TSAR)\b|\b(?:[Rr]oyal [Ff]amily|[Dd]uke of|[Dd]uchess of|DUKE OF|DUCHESS OF)|\b(?:[Gg]rand [Dd]uke|[Gg]rand [Dd]uchess|GRAND DUKE|GRAND DUCHESS|[Aa]rchduke|ARCHDUKE|[Kk]aiser|KAISER)\b|\bFranz Joseph\b/, 'royalty'],
  [/\b(?:novels?|novelist|poets?|poems?|poetry|authors?|playwright|first edition)\b/i, 'literary'],
];
/** The curated domain of a lot's subjects. (wave 3) A subject read as a longer
 *  capitalised run ("marilyn monroe unpublished snapshot", "harry s truman
 *  typed letter") is looked up by its leading 2–3 words too. */
export function curatedDomainOf(subjects: readonly string[] | null | undefined): string | null {
  if (!Array.isArray(subjects)) return null;
  for (const s of subjects) {
    const d = SUBJECT_DOMAINS[s];
    if (d && d !== 'other') return d;
  }
  for (const s of subjects) {
    const w = s.split(' ');
    for (const n of [3, 2]) {
      if (w.length <= n) continue;
      const d = SUBJECT_DOMAINS[w.slice(0, n).join(' ')];
      if (d && d !== 'other') return d;
    }
  }
  return null;
}
/** the earliest-named text domain in `s`, or null */
export function cultureTextDomain(s: string): string | null {
  let best: string | null = null, at = Infinity;
  for (const [re, d] of CULT_TEXT_DOMAIN) {
    const m = re.exec(s);
    if (m && m.index < at) { at = m.index; best = d; }
  }
  return best;
}

/** (Oct 8) the couture houses whose garments sell as fashion, not costume */
const COUTURE_RE = /\b(?:christian dior|dior|issey miyake|chanel|balenciaga|givenchy|yves saint laurent|saint laurent|alexander mcqueen|vivienne westwood|jean paul gaultier|versace|schiaparelli|yohji yamamoto|comme des gar[cç]ons)\b/i;
/** ...worn or owned by a named person ("Elton John's Personally-Owned Versace Shirt") */
const CELEB_WORN_RE = /\b(?:stage|screen|film|tour|personally|concert)[- ](?:worn|owned|used)\b|\b(?:worn|owned) by\b|^[^,]{3,80}['’]s\b/i;

/** (Oct 8) a film / music sale */
const SHOWBIZ_SALE_RE = /hollywood|movie|film|entertainment|music|rock n'? ?roll|pop culture/i;

// sale-name fallback when no subject maps to a domain
const CULT_SALE_DOMAIN: [RegExp, string][] = [
  // (Oct 8) RR's single-theme sales ("Titanic II", "Gangsters, Outlaw &
  // Lawmen", "Science and Technology") — anchored: a "Fine Autographs …
  // Featuring Civil War / Royalty" sale, the "Civil War Auction" and the
  // "Rare Manuscript, Document & Autograph" sale are general autograph sales
  // (43–62% of their drilled lots are music / film / political)
  [/^titanic\b/i, 'historic'],
  [/^(?:old west, )?(?:gangsters|outlaws)\b/i, 'crime'],
  [/^science (?:&|and) tech/i, 'science'],
  [/marvels of modern music|rock n'? ?roll|music/i, 'music'],
  [/hollywood|movie|film|entertainment/i, 'hollywood'],
  [/president|political|white house/i, 'political'],
  [/space|aviation/i, 'space-science'],
];

// ── science ─────────────────────────────────────────────────────────────────
const SCI_KIND: Record<string, string> = {
  'space-exploration': 'space', 'scientific-instruments': 'instruments',
  'science-tech': 'tech', 'meteorites': 'meteorites', 'fossils': 'fossils',
};
const SPACE_PROGRAM: [string, RegExp][] = [
  ['apollo', /apollo/i],
  ['mercury-gemini', /\bgemini\b|\bmercury\b/i],
  ['shuttle-iss', /shuttle|sts-\d|\biss\b/i],
  // (wave 2) Skylab flew Apollo hardware (the Apollo Applications Program) —
  // read after an explicit shuttle-era mention ("Skylab and Shuttle-Era Suits")
  ['apollo', /skylab/i],
  ['soviet', /soyuz|sputnik|cosmonaut|vostok|voskhod|\bmir\b|lunokhod|\bsoviet\b|\bussr\b|\bn1-l3\b|gagarin|korolev|tereshkova|leonov|titov|komarov/i],
  // (wave 2) RR's space catalogue titles a lot by the astronaut alone ("Neil
  // Armstrong Signed Photograph", "Gus Grissom Check"): the program of the
  // astronaut's era — Apollo crews and moon words first, then the Mercury /
  // Gemini-only names (a Schirra + Cunningham photo is Apollo 7)
  ['apollo', /\b(?:neil armstrong|buzz aldrin|michael collins|alan bean|edgar mitchell|(?:jim|james) irwin|(?:charlie|charles) duke|(?:gene|eugene) cernan|harrison schmitt|(?:al|alfred) worden|fred haise|jack swigert|stuart roosa|(?:ron|ronald) evans|walt(?:er)? cunningham|donn eisele|(?:bill|william) anders|(?:dave|david) scott|(?:pete|charles) conrad|rusty schweickart|moonwalkers?|moon ?walk|first man on the moon|lunar|saturn v|command module)\b/i],
  // (Oct 8) the Mercury names with a middle initial or alone ("Alan B.
  // Shepard", "John H. Glenn", "Grissom")
  ['mercury-gemini', /\b(?:john (?:h\.? )?glenn|(?:gus|virgil) (?:i\.? )?grissom|grissom|scott carpenter|(?:wally|walter) (?:m\.? )?schirra|schirra|deke slayton|(?:gordon|l\.? gordon) (?:l\.? )?cooper|(?:alan (?:b\.? )?)?shepard|liberty bell 7|friendship 7|freedom 7|ham the chimp|mercury (?:7|seven)|original seven)\b/i],
  // (Oct 8) the Apollo-era names that flew Gemini too (Lovell, Borman,
  // Stafford, Young, White), read after the Mercury / Gemini names (a Schirra +
  // Borman photo is the Gemini 6A / 7 rendezvous), and the F-1 engine
  ['apollo', /\b(?:(?:ed|edward) (?:h\.? )?white(?: ii)?|(?:roger )?chaffee|(?:jim|james) (?:a\.? )?lovell|lovell|(?:frank )?borman|(?:tom|thomas) (?:p\.? )?stafford|john (?:w\.? )?young|(?:rocketdyne )?f-?1 (?:rocket )?engines?)\b/i],
  // (Oct 8) the shuttle-era names, read after the Apollo crews (Apollo 11's
  // command module was also "Columbia")
  ['shuttle-iss', /\b(?:challenger|columbia|(?:christa )?mcauliffe|sally ride)\b/i],
];
/** (Oct 8) the scientists a culture 'space-science' lot names → 'science' */
const SCIENTIST_RE = /\b(?:einstein|newton|curie|tesla|edison|darwin|hawking|galileo|faraday|bohr|oppenheimer|feynman|freud|pasteur|salk|sabin|schweitzer|morse|graham bell|marconi|fleming|lister|pauling|planck|jung|heisenberg|fermi|teller|watson|crick|carver|nightingale|goodall|tombaugh|hubble|sagan|scientists?|physicists?|chemists?|inventors?|nobel|dna|apple computer|steve jobs|wozniak|computer)\b/i;
/** (Oct 8) aviation pioneers / polar explorers inside a 'space-science' lot */
const AVIATION_RE = /\b(?:aviation|aviators?|aviatrix|airplanes?|aeroplanes?|airships?|zeppelin|hindenburg|lindbergh|wright brothers|orville wright|wilbur wright|earhart|wiley post|bl[eé]riot|sikorsky|whittle|chuck yeager|yeager|peary|shackleton|amundsen|byrd|explorers?)\b/i;
/** (Oct 8) a culture lot whose domain reads 'space-science' → the space
 *  program it names, a scientist ('science') or an aviator ('aviation'),
 *  else stays 'space-science' */
export function spaceScienceDrillOf(text: string): string {
  for (const [k, re] of SPACE_PROGRAM) if (re.test(text)) return k;
  if (AVIATION_RE.test(text)) return 'aviation';
  if (SCIENTIST_RE.test(text)) return 'science';
  return 'space-science';
}
const FLOWN_RE = /\bflown\b|carried aboard|lunar surface|surface[- ]carried/i;
const TECH_DRILL: [string, RegExp][] = [
  ['computing', /apple|steve jobs|macintosh|wozniak|computer|ibm\b|commodore|altair|enigma|microsoft|\bnext\b|calculator/i],
  ['physics-figures', /einstein|newton|curie|tesla|edison|darwin|hawking|galileo|faraday|bohr|oppenheimer|feynman|freud|pasteur/i],
];
const INSTR_DRILL: [string, RegExp][] = [
  ['globes', /globe/i], ['telescopes', /telescope/i], ['microscopes', /microscope/i],
  ['navigation', /sextant|octant|compass|astrolabe|orrery|planetari/i],
  ['medical', /medical|surgical|apothecary|anatomical|dental/i],
  ['precision-clocks', /clock|chronometer|regulator/i],
];

// ── art / design ────────────────────────────────────────────────────────────
const ART_KIND: Record<string, string> = {
  'print': 'prints', 'poster': 'prints',
  'original-2d': 'originals', 'work-on-paper': 'originals', 'painting': 'originals',
  'sculpture': 'sculpture', 'photograph': 'photographs', 'book': 'books',
};
// (wave 2) class 9 · art kinds the form key misses: an artist's BOOK with no
// "book" word (Ruscha's "Real Estate Opportunities", Warhol's "25 Cats
// Name(d) Sam", Matisse's "Florilège des Amours de Ronsard, Albert Skira",
// Picasso's "Vingt Poèmes"), a printed poster / magazine woodcut the form key
// read as a book ("New York is Book Country vintage poster"), an editioned
// multiple (skateboard decks are prints; a KAWS vinyl figure is sculpture),
// and a category the form key could not place.
const ARTIST_BOOK_RE = /\b(?:livres? d'artistes?|artists?'? books?|illustrated books?|zines?|vols?\.\s*[ivx\d]|volumes?|edited by|published by|skira|t[ée]riade|letterpress|black sparrow|po[eè]mes|poems|first edition|dummy cop(?:y|ies)|twentysix gasoline stations|every building on the sunset strip|real estate opportun\w*|various small fires|royal road test|nine swimming pools|some los angeles apartments|thirtyfour parking lots|a few palm trees|colored people|babycakes|dutch details|crackers|holy cats|a gold book|floril[eè]ge des amours|lettres portugaises|pasipha[ée]|po[ée]sies|vingt po[eè]mes|le chant des morts|toreros|1 cent life)\b/i;
const ART_PRINT_OBJECT_RE = /\b(?:posters?|woodcut|screenprint|silkscreen|lithograph|etching|offset)\b/i;
const ART_CAT_KIND: Record<string, string> = { print: 'prints', original: 'originals', sculpture: 'sculpture', photograph: 'photographs' };
function artKind(formKey: string, category: string, title: string, medium: string): string {
  const tm = `${title} ${medium}`;
  let k = ART_KIND[formKey] ?? null;
  if (formKey === 'object-edition') k = category === 'sculpture' ? 'sculpture' : 'prints';
  if (k === 'books' && (/\bposters?\b/i.test(tm) || (ART_PRINT_OBJECT_RE.test(tm) && !/\bbooks?\b|\bvolumes?\b|\bvols?\./i.test(title)))) k = 'prints';
  else if (k !== 'books' && ARTIST_BOOK_RE.test(tm) && !/\bplates?\b|\bfrom\b|\bportfolio\b/i.test(title)) k = 'books';
  return k ?? ((formKey === 'unknown' || formKey === 'design') ? ART_CAT_KIND[category] : null) ?? 'other';
}

const DESIGN_MATERIALS = ['walnut', 'teak', 'oak', 'rosewood', 'plywood', 'steel', 'aluminum', 'fiberglass', 'bronze', 'glass', 'upholstery'];

// Design MODEL vocabulary (Oct 6 2026 audit): the title of a design lot is
// often only a model code or a series name ("LCW", "DSR", "RKR-1", "ESU 400",
// "Guéridon, model no. 401", "PJ-SI-30-A", "Frenchman's Cove II", "Sundra
// dining suite") — the form ladder in comps.classifyForm reads none of them,
// and 2.6k lots sat in 'objects'. Read title + the head of the description
// (Bonhams prints the form there). Nouns carry no trailing \b: Bonhams glues
// the next field on ("Committee' Chairscirca 1953").
const DESIGN_KIND_WORDS: [string, RegExp][] = [
  ['lighting', /\b(?:lamps?|lampe|lighting|light fixture|wall light|ceiling light|floor light|potence|sconces?|applique|lanterns?|chandeliers?)/i],
  // (wave 4) + a wall unit, a bahut, a buffet / commode / vitrine / étagère
  ['case-storage', /\besus?\b|\b(?:eames storage unit|storage units?|wall units?|cabinets?|chests?|bookcases?|biblioth[eè]que|room divider|wall case|credenza|sideboards?|bahuts?|buffets?|commodes?|vitrines?|[ée]tag[eè]res?|dressers?|rangement|kornblut|pj-r-|wardrobes?|armoire|shelv(?:es|ing)|bookshel)/i],
  // (wave 4) + a banquette
  ['seating', /\bbanquettes?\b|\b(?:lcw|lcm|dcw|dcm|dsr|dsw|dsx|dss|dar|dax|rar|raw|rkr|pkw|pkc|lar|lax|dkr|dkx|es ?\d{3}|670|671)(?:s|-?\d)?\b|\b(?:pj-si|chairs?|armchairs?|fauteuils?|chaises?|chaise longue|lounge|stools?|tabourets?|bench(?:es)?|settees?|sofas?|canap[ée]|daybeds?|rockers?|rocking|ottomans?|seating|kangaroo|committee)/i],
  // (wave 4) + Jeanneret's IT-1 table code
  ['tables', /\bit-?1\b|\b(?:etr|ltr|ctw|otw|dtw|etw)(?:s|-?\d)?\b|\b(?:pj-ta|pj-bu|tables?|gu[ée]ridon|compas|desks?|bureau|frenchman'?s cove|minguren|dining suite|sundra|conoid dining)/i],
];
function designKind(formKey: string, title = '', desc = ''): string {
  if (formKey.startsWith('seating')) return 'seating';
  if (formKey.startsWith('table') || formKey === 'desk') return 'tables';
  if (formKey === 'case') return 'case-storage';
  if (formKey === 'lighting' || formKey === 'lamp') return 'lighting';
  // the title decides first; the description only when the title names nothing
  if (/\b(?:mirrors?|miroir|vases?|bowls?|trays?|screens?|clocks?|sculptures?|rugs?|textiles?|beds?|headboards?)\b/i.test(title)) return 'objects';
  // the EARLIEST-named form wins ("Dining table and five chairs" is a table lot)
  for (const src of [title, desc]) {
    let best: string | null = null, at = Infinity;
    for (const [kind, re] of DESIGN_KIND_WORDS) { const m = re.exec(src); if (m && m.index < at) { at = m.index; best = kind; } }
    if (best) return best;
  }
  return 'objects';
}

// ── pokémon ─────────────────────────────────────────────────────────────────
/** a slab grade: grader + number ("PSA GEM MT 10", "BGS PRISTINE 10", "CGC 9.5") */
const POKE_SLAB_RE = /\b(?:psa|bgs|cgc|sgc)\s+(?:[a-z]+[-+/ ]*){0,4}?\d{1,2}(?:\.5)?\b/i;
const POKE_PACK_WORD_RE = /\b(?:packs?|sealed|unopened|booster|box(?:es)?)\b/i;
/** non-card pieces: never cards whatever they include */
const POKE_MEMORABILIA_RE = /\b(?:shikishi|film reels?|film cels?|skateboards?|skate decks?|plush(?:ies)?|plushes)\b/i;
/** ...and the ones a card can be named after ("#1 Trophy Pikachu", "Trophy Card") */
const POKE_MEMORABILIA_LOOSE_RE = /\b(?:troph(?:y|ies)(?! cards?)|figurines?|statues?|figures?(?! collection| box))\b/i;
/** multi-card lots and sets — a set NAME ("Legendary Collection") is not one */
const POKE_LOTS_RE = /\blots? of\b|\b(?:near[- ])?complete (?:master )?sets?\b|\b(?:card|graded|slabs?) collection\b|-graded (?:card )?collection\b|\bcollection \((?!\d+ (?:packs?|boxes|cases?|tins?|blisters?)\b)\d|\(\d+ (?:different|cards?)\)/i;
const POKE_ECARD_RE = /\b(?:aquapolis|skyridge|expedition|e-?card)\b/i;

// ── the stamps ──────────────────────────────────────────────────────────────
export interface SubCatStamp { subCat: string | null; drill: string | null; flown: boolean | null }

/**
 * Derive the (subCat, drill, flown) stamp for one lot. `sportMaps` supplies the
 * learned player→sport maps (built by corpus-normalize from lots whose sport
 * Goldin stamped directly) so unstamped cards/memorabilia inherit their
 * player's sport.
 */
/** The corpus-learned maps stampSubCats builds (corpus-normalize) — each a
 *  majority vote over the rows whose value is KNOWN from their own evidence. */
export interface SubCatMaps {
  /** sports: Goldin pid → sport, player slug → sport */
  byPid: Map<string, string>;
  byPlayer: Map<string, string>;
  /** the player slug of a sports row (card parse, roster athlete) */
  cardPlayer?: (l: Lot) => string | null;
  /** (wave 3) sports: card SET (year|set) → sport */
  bySet?: Map<string, string>;
  /** the set keys of a card row, most specific first */
  setOf?: (l: Lot) => string[];
  /** (wave 3) culture: subject (person / franchise) → domain */
  bySubject?: Map<string, string>;
  /** (wave 3) watches: maker|reference → model family */
  byRef?: Map<string, string>;
}

/** (wave 3) the head of a lot's description (the object line most houses
 *  print first) — the text the title-only readers fall back to */
export function descHeadOf(l: Lot, n = 300): string {
  return String(l.description || '').replace(/<[^>]+>|class="[^"]*"/g, ' ').slice(0, n);
}
/** (wave 3) a watch reference's join key: maker + the reference's core digits */
export function watchRefKey(l: Lot): string | null {
  const r = String(l.reference || '').toLowerCase().replace(/\s+/g, '');
  const core = (r.match(/^[a-z]{0,3}\d{3,6}/) || [])[0];
  return core ? `${l.artist}|${core}` : null;
}
/** the model family a watch text names, for the tracked maker */
export function watchFamilyOf(artist: string, hay: string): string | null {
  const fams = WATCH_FAMILIES[artist];
  if (!fams) return null;
  const h = hay.toLowerCase();
  for (const [fam, re] of fams) if (re.test(h)) return fam;
  return null;
}

export function subCatOf(l: Lot, sportMaps?: SubCatMaps): SubCatStamp {
  const vert = ARTIST_MARKET[l.artist as keyof typeof ARTIST_MARKET];
  const title = (l.title as string) || '';
  const formKey = (l.formKey as string) || 'unknown';

  if (vert === 'sports') {
    const subCat = SPORTS_KIND[l.artist as string] ?? null;
    // (Oct 8) a Yu-Gi-Oh! / One Piece / Lorcana / Magic card or box filed as a
    // sports card keeps its slug but is no sports card: it carries no sport
    // and the card comp paths skip it (build-market, emit-value-book)
    if ((subCat === 'cards' || subCat === 'wax') && NON_SPORT_TCG_RE.test(title)) return { subCat: 'tcg-other', drill: null, flown: null };
    let drill = sportSlugOf(l.sport);
    // (wave 3) a cricket / rugby / polo lot has no drill of ours
    if (!drill && NO_SPORT_DRILL_RE.test(title.replace(/\bpolo grounds\b/gi, ' '))) return { subCat, drill: null, flown: null };
    // (wave 3) a single-sport sale names the sport of every lot in it
    if (!drill) drill = sportOfSale(l.saleName as string, l.auctionHouse as string);
    // (wave 4) a PRE-WAR baseball issue names the sport before any learned
    // player vote: a name two athletes share ("1933 Goudey #214 John Kerr" —
    // the 1920s infielder, not the 1960s NBA center) must not take the other
    // one's sport (Goudey's multi-sport Sport Kings excepted)
    if (!drill && subCat === 'cards') {
      const y = title.match(/^\s*(?:\d{1,4}\s+)?(?:(?:signed|autographed)\s+)?(18[6-9]\d|19[0-3]\d|194[01])\b/i);
      if (y && (BASEBALL_CODE_ANY_RE.test(title) || PREWAR_BASEBALL_ISSUE_RE.test(title)) && !NON_BASEBALL_ISSUE_RE.test(title) && !/sport kings|\bR338\b/i.test(title) && !sportWordOf(title)) drill = 'baseball';
    }
    if (!drill && sportMaps) {
      const pid = l._pid != null ? String(l._pid) : null;
      const card = l._card as { playerSlug?: string } | undefined;
      const player = (l.playerSlug as string) || card?.playerSlug || (sportMaps.cardPlayer ? sportMaps.cardPlayer(l) : null) || null;
      drill = (pid && sportMaps.byPid.get(pid)) || (player && sportMaps.byPlayer.get(player)) || null;
    }
    if (!drill) drill = sportFromText(title);
    // (wave 3) the card's SET, learned from its sport-known siblings ("1952
    // Topps" is baseball, "Panini Prizm WNBA" basketball)
    if (!drill && sportMaps?.bySet && sportMaps.setOf) {
      for (const k of sportMaps.setOf(l)) { drill = sportMaps.bySet.get(k) || null; if (drill) break; }
    }
    // (wave 3) the vintage card houses title a non-baseball issue by its sport
    // ("1957 Topps Football", "1935 National Chicle Football"): a pre-1981
    // card there that names no sport, no known player and no learned set is
    // baseball (DEV: 25 of 29 such labelled lots)
    if (!drill && subCat === 'cards' && VINTAGE_CARD_HOUSES.has(String(l.auctionHouse || ''))) {
      const y = title.match(/\b(18[6-9]\d|19\d\d)\b/);
      if (y && +y[1] <= 1980 && !NON_BASEBALL_ISSUE_RE.test(title)) drill = 'baseball';
    }
    return { subCat, drill, flown: null };
  }

  if (vert === 'watches') {
    const subCat = formKey === 'wristwatch' ? 'wristwatches'
      : formKey === 'pocket-watch' ? 'pocket-watches'
      : formKey === 'clock' ? 'clocks'
      : formKey === 'jewelry' ? 'jewelry' : null;
    let drill: string | null = null;
    if (subCat === 'wristwatches') {
      const a = l.artist as string;
      drill = watchFamilyOf(a, `${(l.reference as string) || ''} ${(l.modelKey as string) || ''} ${title}`);
      // (wave 3) the reference's family, learned from its titled siblings
      // ("Ref. 5513" is a Submariner, "3372" an Oyster Perpetual bubbleback),
      // then the description's object line (Phillips / Bonhams titles name
      // only the metal and the complications)
      if (!drill && sportMaps?.byRef) { const k = watchRefKey(l); drill = (k && sportMaps.byRef.get(k)) || null; }
      if (!drill) drill = watchFamilyOf(a, descHeadOf(l));
    }
    return { subCat, drill, flown: null };
  }

  if (vert === 'tcg') {
    // Pokémon's own axis: product form (sealed wax vs singles), era drill by
    // the leading year Goldin titles always carry ("1998 Pokemon Japanese …").
    // a card NUMBER makes it a single, whatever product it was pulled from
    // ("Stamp Box Full Art #227 Pikachu", "Card Pack 25th Anniversary #006",
    // "Collector Chest Holo #SM226") — 1.2k singles were filed sealed
    // (Oct 8) a slab grade with no pack / box word is a graded single ("Tag
    // Team Tins Sm168 … PSA MINT 9"); the non-card pieces (a shikishi board, a
    // skateboard deck, a trophy) and the multi-card lots / sets are their own
    // kinds
    const numbered = /#\s?[A-Za-z0-9]/.test(title);
    const slabSingle = POKE_SLAB_RE.test(title) && !POKE_PACK_WORD_RE.test(title);
    const sealedWord = /\b(booster|sealed|unopened|box(es)?|packs?|case|display|tins?|blister|bundle|elite trainer)\b/i.test(title);
    const subCat = (POKE_MEMORABILIA_RE.test(title) || (!numbered && !POKE_SLAB_RE.test(title) && POKE_MEMORABILIA_LOOSE_RE.test(title))) ? 'pokemon-memorabilia'
      // a lot of sealed packs / boxes is still sealed product
      : POKE_LOTS_RE.test(title) && !sealedWord ? 'pokemon-lots'
      : !numbered && !slabSingle && sealedWord ? 'pokemon-sealed' : 'pokemon-cards';
    // the year: four digits, else Goldin's two-digit lead ("99 Pokemon Japanese
    // Promo …"); the e-Card series (Expedition, Aquapolis, Skyridge — 2003 in
    // English) closes the WotC vintage era
    const y = (title.match(/\b(19|20)\d{2}\b/) || [])[0];
    const y2 = y ? null : title.match(/^\s*'?(\d{2})\s+(?:\S+\s+){0,2}?pok[eé]mon\b/i);
    const yr = y ? parseInt(y, 10) : y2 ? (+y2[1] >= 90 ? 1900 : 2000) + +y2[1] : null;
    const drill = POKE_ECARD_RE.test(title) ? 'vintage' : yr ? (yr <= 2002 ? 'vintage' : yr <= 2016 ? 'classic' : 'modern') : null;
    return { subCat, drill, flown: null };
  }

  if (vert === 'culture') {
    const subCat = CULT_KIND[(l.itemClass as string) || ''] ?? 'other';
    const subjects = l.subjectKeys as string[] | undefined;
    let drill: string | null = curatedDomainOf(subjects);
    // (wave 3) the lot's own words, then the subject's domain learned from its
    // worded siblings (a bare "Schuyler Colfax" lot inherits "Schuyler Colfax
    // Signed Document as Vice President"), then the description's head
    // (Oct 8) the new historical cues (a Titanic, an outlaw, an airship) name
    // a FILM in a film / music sale ("THE OUTLAW" one-sheet, "Titanic, 1997")
    const sale = (l.saleName as string) || '';
    const textDomain = (s: string): string | null => {
      const d = cultureTextDomain(s);
      return d && SHOWBIZ_SALE_RE.test(sale) && (d === 'historic' || d === 'crime' || d === 'aviation') ? null : d;
    };
    if (!drill) drill = textDomain(title);
    if (!drill && sportMaps?.bySubject && Array.isArray(subjects)) {
      // a subject the curated list files 'other' (Civil War, Titanic, WWII)
      // spans domains — it is never learned
      for (const s of subjects) { const d = SUBJECT_DOMAINS[s] ? null : sportMaps.bySubject.get(s); if (d) { drill = d; break; } }
    }
    if (!drill) drill = textDomain(descHeadOf(l, 260));
    if (!drill) {
      for (const [re, d] of CULT_SALE_DOMAIN) if (re.test(sale)) { drill = d; break; }
    }
    // (Oct 8) a 'space-science' figure is a space program, a scientist or an aviator
    if (drill === 'space-science') drill = spaceScienceDrillOf(`${title} ${(subjects || []).join(' ')}`);
    // (Oct 8) a couture piece (a Dior gown from a sale, a McQueen jacket) is
    // not a costume or prop — unless a named person wore / owned it
    if ((subCat === 'worn-personal' || subCat === 'props') && COUTURE_RE.test(title) && !CELEB_WORN_RE.test(title)) return { subCat: 'other', drill, flown: null };
    return { subCat, drill, flown: null };
  }

  if (vert === 'science') {
    const subCat = SCI_KIND[l.artist as string] ?? null;
    let drill: string | null = null;
    let flown: boolean | null = null;
    if (subCat === 'space') {
      for (const [k, re] of SPACE_PROGRAM) if (re.test(title)) { drill = k; break; }
      flown = FLOWN_RE.test(title);
    } else if (subCat === 'tech') {
      for (const [k, re] of TECH_DRILL) if (re.test(title)) { drill = k; break; }
    } else if (subCat === 'instruments') {
      for (const [k, re] of INSTR_DRILL) if (re.test(title)) { drill = k; break; }
    }
    return { subCat, drill, flown };
  }

  if (vert === 'art') {
    return { subCat: artKind(formKey, (l.category as string) || '', title, String(l.medium || '')), drill: null, flown: null };
  }

  if (vert === 'design') {
    let drill: string | null = null;
    const mats = l.materialTokens as string[] | undefined;
    if (Array.isArray(mats)) for (const m of DESIGN_MATERIALS) if (mats.includes(m)) { drill = m; break; }
    return { subCat: designKind(formKey, title, String(l.description || '').slice(0, 300)), drill, flown: null };
  }

  return { subCat: null, drill: null, flown: null };
}

export { SUBCAT_LABELS, subCatLabel } from '../../app/lib/subcat-labels';
