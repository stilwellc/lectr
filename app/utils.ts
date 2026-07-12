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
  },
};

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

export function formatPrice(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

export const categoryLabels: Record<string, string> = {
  original: 'Unique Work',
  print: 'Edition',
  photograph: 'Photograph',
  sculpture: 'Sculpture',
  design: 'Design Object',
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
    unknown: '#9F9991',
  },
  light: {
    original: '#241E15',
    print: '#332D24',
    photograph: '#413B32',
    sculpture: '#504A41',
    design: '#5F5950',
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
}): string {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\n/g, '\\n');
  const fmtDate = (iso: string) => iso.replace(/-/g, '').slice(0, 8);
  const d = new Date(lot.saleDate + 'T12:00:00');
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
    'PRODID:-//co.stil Ray//EN',
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

export function getUpcomingCounts(lots: Array<{ status: string; saleDate: string | null; artist: string }>): Record<string, number> {
  const today = new Date().toISOString().split('T')[0];
  const counts: Record<string, number> = {};
  for (const lot of lots) {
    if (lot.status === 'upcoming' && lot.saleDate && lot.saleDate >= today) {
      counts[lot.artist] = (counts[lot.artist] || 0) + 1;
    }
  }
  return counts;
}
