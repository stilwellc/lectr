// Neutral ivory ramp: houses are distinguished by LIGHTNESS, not hue — hue is
// reserved for meaning (wine = emphasis, gold = site primary). Each step mixes
// the warm foreground into the background, so the ramp tracks both themes and
// 12px labels stay AA-readable (floor is 65% fg, above text-muted). Use with
// color-mix() when alpha is needed.
export const houseColors: Record<string, string> = {
  'Phillips': 'var(--color-fg)',
  "Sotheby's": 'color-mix(in srgb, var(--color-fg) 95%, var(--color-bg))',
  "Christie's": 'color-mix(in srgb, var(--color-fg) 90%, var(--color-bg))',
  'Rago': 'color-mix(in srgb, var(--color-fg) 85%, var(--color-bg))',
  'Wright': 'color-mix(in srgb, var(--color-fg) 80%, var(--color-bg))',
  'Heritage': 'color-mix(in srgb, var(--color-fg) 75%, var(--color-bg))',
  'Bonhams': 'color-mix(in srgb, var(--color-fg) 70%, var(--color-bg))',
  'Hindman': 'color-mix(in srgb, var(--color-fg) 65%, var(--color-bg))',
  'Goldin': 'color-mix(in srgb, var(--color-fg) 60%, var(--color-bg))',
};

// Concrete hexes per theme — ONLY for recharts/SVG fills, where var() is not
// reliable in presentation attributes. Swap via useTheme() at the call site.
// Same neutral fg-into-bg ramp as houseColors, precomputed per theme.
export const houseColorsHex: Record<'dark' | 'light', Record<string, string>> = {
  dark: {
    'Phillips': '#EDE6DA',
    "Sotheby's": '#E2DBD0',
    "Christie's": '#D7D0C5',
    'Rago': '#CBC5BB',
    'Wright': '#C0BAB0',
    'Heritage': '#B5AFA6',
    'Bonhams': '#AAA49B',
    'Hindman': '#9F9991',
    'Goldin': '#948E86',
  },
  light: {
    'Phillips': '#241E15',
    "Sotheby's": '#2E291F',
    "Christie's": '#39332A',
    'Rago': '#433E34',
    'Wright': '#4E483F',
    'Heritage': '#585349',
    'Bonhams': '#635D54',
    'Hindman': '#6D685E',
    'Goldin': '#787368',
  },
};

/**
 * craftTitle — the object made worthy. Auction feeds arrive raw: Bonhams
 * SHOUTS ("CARTIER: AN 18K GOLD WRISTWATCH, CIRCA 1950"), catalog styles
 * repeat the maker the card already names, titles trail orphan periods.
 * One pass: strip the redundant maker prefix, sentence-case the shouting,
 * trim the tail. The data stays untouched — this is presentation craft.
 */
const MAKER_PREFIX = /^(rolex|patek philippe|audemars piguet|omega|cartier|vacheron constantin|jaeger[- ]lecoultre)\s*[.,:]\s*/i;
// design/maker name(s) that lead a catalogue title and duplicate the maker line
const DESIGN_MAKER_PREFIX = /^(charles (?:&|and) ray eames|charles eames|ray eames|george nakashima|pierre jeanneret|jean prouv[eé]|le corbusier)\s*[.,:]\s*/i;
// "Charles Eames, Ray Eames: <title>" — a comma-joined name duo ending in a colon
const DUO_PREFIX = /^[A-ZÀ-Ý][\wÀ-ÿ.'-]+(?:\s+[A-ZÀ-Ý][\wÀ-ÿ.'-]+){0,3}(?:,\s*[A-ZÀ-Ý][\wÀ-ÿ.'-]+(?:\s+[A-ZÀ-Ý][\wÀ-ÿ.'-]+){0,3})+\s*:\s+/;
const HTML_TAG = /<\/?[a-z][^>]*>/gi;
const ENTITY: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ', '&mdash;': '—', '&ndash;': '–', '&hellip;': '…' };

/** Strip HTML tags + decode common entities + collapse whitespace. Auction feeds
 *  leak raw markup ("</p><p>") and entities into title/medium fields. */
export function cleanText(raw?: string | null): string {
  let t = (raw || '').replace(HTML_TAG, ' ');
  t = t.replace(/&[a-z#0-9]+;/gi, m => ENTITY[m.toLowerCase()] ?? ' ');
  return t.replace(/\s+/g, ' ').trim();
}
export function craftTitle(raw: string): string {
  let t = cleanText(raw);
  t = t.replace(/^\[(.+?)\]$/, '$1').trim();          // unwrap a fully-bracketed title  [Apollo 14] → Apollo 14
  t = t.replace(/^\[[^\]]{1,40}\]\s*/, '').trim();     // drop a leading [collection tag]
  t = t.replace(/\s*\(\d{1,3}\)\s*$/, '');             // drop trailing catalogue quantity  "…chairs (7)"
  t = t.replace(MAKER_PREFIX, '');
  t = t.replace(DESIGN_MAKER_PREFIX, '');              // "George Nakashima: Conoid" → "Conoid"
  t = t.replace(DUO_PREFIX, '');                       // "Charles Eames, Ray Eames: …" → "…"
  const letters = t.replace(/[^a-zA-Z]/g, '');
  if (letters.length > 8) {
    const shouting = t.replace(/[^A-Z]/g, '').length / letters.length > 0.7;
    if (shouting) {
      t = t.toLowerCase().replace(/(^|[.!?]\s+)([a-z])/g, (_, a, b) => a + b.toUpperCase());
    }
  }
  t = t.replace(/\s*[.,;]+\s*$/, '');
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
}

/**
 * sportOf — which sport a sports lot belongs to, read from its title (league,
 * team, athlete, or venue). Soccer dominates the current data so its cues are
 * broad; American sports lead with league + marquee names. Rules run
 * first-match-wins, so crossover surnames (Henry, Terry, Moore, Rodman,
 * Aaron, Luka) are cued by FULL NAME only — a bare surname would file a
 * Dennis Rodman Bulls jersey or an Aaron Rodgers Packers jersey under the
 * wrong pill before the team/league cue ever ran. Returns null when nothing
 * identifies the sport (kept as "Other" in the filter).
 */
const SPORT_RULES: [string, RegExp][] = [
  ['Soccer', /\b(soccer|fifa|world cup|uefa|premier league|la liga|serie a|bundesliga|ligue 1|champions league|barcelona|real madrid|manchester|arsenal|chelsea|liverpool|psg|paris saint|juventus|benfica|honved|galaxy|messi|ronaldo|ronaldinho|mbappe|haaland|neymar|pele|maradona|salah|yamal|pedri|busquets|fabregas|thierry henry|mendy|john terry|bobby moore|beckham|charlton|eusebio|puskas|puskás|tostão|tostao|trinity rodman|luka modric|meazza|figc|santos)\b/i],
  ['Basketball', /\b(nba|basketball|lakers|celtics|bulls|warriors|heat\b|nuggets|knicks|76ers|clippers|nets\b|ncaa|final four|lebron|jordan|kobe|jokic|curry|durant|anthony edwards|luka doncic|shai gilgeous)\b/i],
  ['Baseball', /\b(mlb|baseball|yankees|dodgers|red sox|cubs|world series|ohtani|jeter|rivera|mantle|ruth|hank aaron|home run|no-hitter|cy young)\b/i],
  ['Football', /\b(nfl|super bowl|quarterback|touchdown|heisman|patriots|chiefs|cowboys|packers|49ers|tom brady|mahomes|amendola|lombardi)\b/i],
  ['Hockey', /\b(nhl|hockey|stanley cup|gretzky|ovechkin|crosby|maple leafs|canadiens|bruins|goal no\.)\b/i],
  ['Racing', /\b(formula 1|f1\b|grand prix|nascar|leclerc|hamilton|verstappen|senna|ferrari|mclaren|race-worn|racing)\b/i],
  ['Boxing / MMA', /\b(boxing|ufc\b|mma\b|title belt|heavyweight|muhammad ali|mike tyson|mayweather|fight-worn)\b/i],
  ['Golf', /\b(golf|pga\b|masters|green jacket|tiger woods|the open|ryder cup)\b/i],
  ['Tennis', /\b(tennis|wimbledon|us open tennis|roland garros|federer|nadal|djokovic|serena)\b/i],
  ['Olympics', /\b(olympic|olympics|torch|gold medal.*(games|olympic))\b/i],
];
export function sportOf(title: string): string | null {
  const t = title || '';
  for (const [sport, re] of SPORT_RULES) if (re.test(t)) return sport;
  // "match-used / match-worn" is soccer/international grammar — Americans say
  // "game-used". A boot/shirt/jersey in that grammar is soccer.
  if (/\bmatch[- ](used|worn)\b/i.test(t) && /\b(jersey|shirt|boots|kit|strip|cleats)\b/i.test(t)) return 'Soccer';
  return null;
}

// Shared date formatter for the Ray suite. saleDate/lastCrawl are date-only
// strings (YYYY-MM-DD) that JS parses as UTC midnight — formatting them in
// the viewer's local timezone can shift the displayed day AND makes the
// server-rendered text differ from the client's (hydration mismatch).
// Always format in UTC so the output is identical everywhere.
export function formatDate(
  dateStr: string,
  opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' },
): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });
}

/** The user's LOCAL calendar day as YYYY-MM-DD — the ONE "today" for every
 *  client-render comparison against date-only saleDate strings. A UTC "today"
 *  (toISOString().slice(0, 10)) runs a day ahead of every US evening, so lots
 *  hammering "today" read as past and day-counts go off by one. Build-time
 *  scripts stay UTC on purpose — this is for what the READER's calendar says. */
export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Upgrade http:// image URLs to https:// so they don't trip mixed-content on
 *  our HTTPS pages (all our image hosts serve https). Undefined-safe. */
export function httpsImg(u?: string | null): string | undefined {
  return u ? u.replace(/^http:\/\//i, 'https://') : undefined;
}

/** Bonhams hotlinks are 2880×2880 originals (~672 KB each) but their image
 *  service resizes on request (verified live: `&width=160` → 3.3 KB). Ask for
 *  the size the slot actually renders (2× the CSS box, for retina) instead of
 *  shipping the master into a 40 px avatar.
 *
 *  Deliberately narrow: rewrites ONLY the Bonhams resizer endpoint, and never
 *  when the URL already carries a width. Every other CDN — and any already
 *  sized URL — comes back untouched.
 *
 *  images1/2/3 are the same resizer behind three shard hostnames (the corpus
 *  carries all three; each was curl-verified to 200 with a smaller body for
 *  `&width=`), so the host class covers 1–3 and nothing else. */
export function sizedImg(u: string, width: number): string;
export function sizedImg(u: string | null | undefined, width: number): string | undefined;
export function sizedImg(u: string | null | undefined, width: number): string | undefined {
  if (!u) return undefined;
  return /^https?:\/\/images[1-3]\.bonhams\.com\/image\?/i.test(u) && !/[?&]width=\d/i.test(u)
    ? `${u}&width=${width}`
    : u;
}

/** ONE signed-percent formatter: '+' for gains, a TRUE MINUS (U+2212) for
 *  losses, no sign at zero — replaces ~10 inline `>= 0 ? '+' : ''` sites that
 *  printed hyphen-minus and green zeros. */
export function fmtSignedPct(n: number, digits = 0): string {
  const r = +n.toFixed(digits);
  if (r === 0) return `${(0).toFixed(digits)}%`;
  return `${r > 0 ? '+' : '\u2212'}${Math.abs(r).toFixed(digits)}%`;
}

/** Direction tone for a signed reading: zero is FLAT (muted), not a gain.
 *  Use for classNames/colors so a 0% never paints signal-green. */
export function toneOf(n: number): 'up' | 'down' | 'flat' {
  return Math.round(n) === 0 ? 'flat' : n > 0 ? 'up' : 'down';
}

/** Hammer-basis % over estimate for a SOLD lot: realized prices are
 *  premium-inclusive (~1.25x) while estimates are hammer-basis — divide out
 *  the premium before comparing, or every figure overstates by ~25pts. */
export function overEstimatePct(l: { priceUsd?: number | null; hammerUsd?: number | null; hammerPrice?: number | null; estimateLow?: number | null; estimateHigh?: number | null }): number | null {
  const lo = l.estimateLow || l.estimateHigh || 0;
  const hi = l.estimateHigh || l.estimateLow || 0;
  const mid = (lo + hi) / 2;
  if (!(mid > 0) || !l.priceUsd) return null;
  // hammerUsd is corpus-only (stripped from served rows) — hammerPrice is the
  // alias that actually ships, so real published hammers reach the display
  // instead of silently falling to the /1.25 approximation everywhere.
  const real = (l.hammerUsd ?? l.hammerPrice ?? 0) > 0 ? (l.hammerUsd ?? l.hammerPrice)! : null;
  const hammer = real ?? l.priceUsd / 1.25;
  return (hammer / mid - 1) * 100;
}

/** ONE money-axis formatter for every chart — rolls to B, trims trailing .0,
 *  so "$1700.0M" and "$4.97B" can never coexist on adjacent panels. */
export function formatMoneyAxis(n: number): string {
  const v = Math.abs(n); const sign = n < 0 ? '−' : '';
  const trim = (s: string) => s.replace(/\.0$/, '');
  if (v >= 1_000_000_000) return `${sign}$${trim((v / 1_000_000_000).toFixed(v >= 10_000_000_000 ? 0 : 1))}B`;
  if (v >= 1_000_000) return `${sign}$${trim((v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1))}M`;
  if (v >= 1_000) return `${sign}$${Math.round(v / 1000)}K`;
  return `${sign}$${Math.round(v)}`;
}

export function formatPrice(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

export const categoryLabels: Record<string, string> = {
  original: 'Unique Work',
  print: 'Edition',
  photograph: 'Photograph',
  sculpture: 'Sculpture',
  design: 'Design Object',
  object: 'Object',
  unknown: 'Unknown',
};

// Neutral ivory ramp — same doctrine as houseColors: categories are coded by
// lightness, hue stays reserved for meaning.
export const categoryColors: Record<string, string> = {
  original: 'var(--color-fg)',
  print: 'color-mix(in srgb, var(--color-fg) 93%, var(--color-bg))',
  photograph: 'color-mix(in srgb, var(--color-fg) 86%, var(--color-bg))',
  sculpture: 'color-mix(in srgb, var(--color-fg) 79%, var(--color-bg))',
  design: 'color-mix(in srgb, var(--color-fg) 72%, var(--color-bg))',
  object: 'color-mix(in srgb, var(--color-fg) 68%, var(--color-bg))',
  unknown: 'color-mix(in srgb, var(--color-fg) 65%, var(--color-bg))',
};

// Concrete hexes per theme — ONLY for recharts/SVG fills. See houseColorsHex.
export const categoryColorsHex: Record<'dark' | 'light', Record<string, string>> = {
  dark: {
    original: '#EDE6DA',
    print: '#DDD7CB',
    photograph: '#CEC7BD',
    sculpture: '#BEB8AE',
    design: '#AEA99F',
    object: '#A6A198',
    unknown: '#9F9991',
  },
  light: {
    original: '#241E15',
    print: '#332D24',
    photograph: '#413B32',
    sculpture: '#504A41',
    design: '#5F5950',
    object: '#666157',
    unknown: '#6D685E',
  },
};

export function makeAuctionIcs(lot: {
  id: string;
  title: string;
  auctionHouse: string;
  saleDate: string;
  estimateLow: number | null;
  estimateHigh: number | null;
  currency: string;
  url: string;
  artist: string;
}): string | null {
  // A malformed/absent saleDate must return null (caller no-ops) — never
  // throw inside the click handler that builds the calendar file.
  const d = new Date((lot.saleDate || '') + 'T12:00:00');
  if (!lot.saleDate || !/^\d{4}-\d{2}-\d{2}/.test(lot.saleDate) || isNaN(d.getTime())) return null;
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\n/g, '\\n');
  const fmtDate = (iso: string) => iso.replace(/-/g, '').slice(0, 8);
  const nextDay = new Date(d.getTime() + 86_400_000);

  const fmtPrice = (n: number) =>
    n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `$${(n / 1_000).toFixed(0)}K` : `$${n}`;

  const estLine = lot.estimateLow && lot.estimateHigh
    ? `Est. ${fmtPrice(lot.estimateLow)}–${fmtPrice(lot.estimateHigh)} ${lot.currency}\\n`
    : '';

  const desc = esc(`${estLine}${lot.url}`);
  const summary = esc(`${lot.title} · ${lot.auctionHouse}`);

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//co.stil lectr//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:ray-${lot.id}@costil`,
    `DTSTART;VALUE=DATE:${fmtDate(lot.saleDate)}`,
    `DTEND;VALUE=DATE:${fmtDate(nextDay.toISOString())}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${desc}`,
    `URL:${lot.url}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:Auction today',
    'TRIGGER:-PT8H',
    'END:VALARM',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:Auction tomorrow',
    'TRIGGER:-P1D',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

/** A lot's TRUE sale day (YYYY-MM-DD). The crawler stamps `saleDate` with the
 *  CRAWL DAY as a fallback when it can't read a real date off a search/artist
 *  page — so an old sold lot re-seen there would otherwise show as "on the
 *  block today". `saleDateTime`, when set, is the genuinely-parsed timestamp
 *  and always wins. Every liveness comparison runs on this, never on the raw
 *  (possibly crawl-day) saleDate. */
export function trueSaleDay(l: { saleDate?: string | null; saleDateTime?: string | null }): string {
  return l.saleDateTime ? l.saleDateTime.slice(0, 10) : (l.saleDate || '').slice(0, 10);
}

/** THE upcoming-visibility predicate — ONE definition of "live" for every
 *  surface (feed, /value, /[artist], nav counts), mirroring build-upcoming's
 *  semantics: a lot is live while its true sale day is still ahead, OR — when
 *  it closed but the house hasn't posted results (`resultsPending`) — through
 *  a short grace window (default 1 day) while results post. The old inline
 *  predicates wrote `saleDate >= today || (resultsPending && saleDate >= today)`
 *  whose second disjunct was subsumed and never admitted anything, so those
 *  surfaces hid results-pending lots a day earlier than the lander's payload
 *  intended. Pass the reader's localToday() client-side. */
export function isLiveUpcoming(
  l: { status: string; saleDate?: string | null; saleDateTime?: string | null; resultsPending?: boolean },
  todayIso: string = localToday(),
  graceDays = 1,
): boolean {
  if (l.status !== 'upcoming') return false;
  const day = trueSaleDay(l);
  if (!day) return false;
  if (day >= todayIso) return true;
  if (!l.resultsPending) return false;
  const graceCut = new Date(Date.parse(`${todayIso}T00:00:00Z`) - graceDays * 864e5).toISOString().slice(0, 10);
  return day >= graceCut;
}

export function getUpcomingCounts(lots: Array<{ status: string; saleDate: string | null; saleDateTime?: string | null; artist: string; resultsPending?: boolean }>): Record<string, number> {
  const today = localToday();
  const counts: Record<string, number> = {};
  for (const lot of lots) {
    if (isLiveUpcoming(lot, today)) {
      counts[lot.artist] = (counts[lot.artist] || 0) + 1;
    }
  }
  return counts;
}

// ── watch reference labels (the /ref dossier grammar) ────────────────────────
// Known model lines read as words; bare numerics read as references.
const REF_LINE_LABELS: Record<string, string> = {
  oysterperpetual: 'Oyster Perpetual', royaloak: 'Royal Oak', seamaster: 'Seamaster',
  calatrava: 'Calatrava', santos: 'Santos', constellation: 'Constellation',
  speedmaster: 'Speedmaster', pasha: 'Pasha', gondolo: 'Gondolo', cellini: 'Cellini',
  nautilus: 'Nautilus', aquanaut: 'Aquanaut', datejust: 'Datejust', daytona: 'Daytona',
  submariner: 'Submariner', cosmograph: 'Cosmograph', tank: 'Tank', panthère: 'Panthère',
  panthere: 'Panthère', ballon: 'Ballon Bleu', deville: 'De Ville', reverso: 'Reverso',
  explorer: 'Explorer', gmtmaster: 'GMT-Master', milgauss: 'Milgauss', yachtmaster: 'Yacht-Master',
  seadweller: 'Sea-Dweller', airking: 'Air-King', tortue: 'Tortue', baignoire: 'Baignoire',
  ronde: 'Ronde', roadster: 'Roadster', cloche: 'Cloche', must: 'Must de Cartier',
};
export function refLabel(ref: string): string {
  if (REF_LINE_LABELS[ref]) return REF_LINE_LABELS[ref];
  if (/^\d[\dA-Za-z/.-]*$/.test(ref)) return `Ref. ${ref.toUpperCase()}`;
  return ref.charAt(0).toUpperCase() + ref.slice(1);
}
