/**
 * share.ts — per-link share previews for the QUERY shells (Oct 20 2026).
 *
 * /lot?id=<id> is one static HTML for every lot (the static export can't
 * prerender 1M+ lots), so every shared lot link unfurled as the generic site
 * card. functions/lot/index.ts answers link-preview bots (iMessage, Slack, X,
 * WhatsApp, Discord, …) with that same shell, its head rewritten to the lot's
 * own title, sale facts and house photo. People get the untouched static page
 * (no extra hop on their load).
 *
 * Pure (no I/O): string in, string out, so node:test covers it. CPU is a few
 * regex passes over a ~30 KB head — inside the Free plan's 10 ms.
 */
import { ARTIST_LABEL } from '../../app/constants';
import { httpsImg, sizedImg } from '../../app/utils';

/** link-preview fetchers and search crawlers. iMessage presents as
 *  "… facebookexternalhit/1.1 Facebot Twitterbot/1.0" — caught here. */
const UNFURLER = /bot\b|bot\/|crawler|spider|facebookexternalhit|facebot|slack|discord|whatsapp|telegram|linkedin|embedly|pinterest|skype|redditbot|applebot|iframely|vkshare|bluesky|mastodon|preview/i;
export const isUnfurler = (ua: string | null | undefined) => !!ua && UNFURLER.test(ua);

/** the slice of a stored lot row a preview reads */
export interface ShareLot {
  id: string;
  artist?: string;
  title?: string;
  imageUrl?: string | null;
  auctionHouse?: string;
  saleDate?: string;
  lotNumber?: number | null;
  currency?: string;
  estimateLow?: number | null;
  estimateHigh?: number | null;
  status?: string;
  realizedNative?: number | null;
  value?: { n?: number; signal?: { label?: string } } | null;
}

export interface ShareMeta { title: string; description: string; image?: string; imageAlt: string; url: string }

const SYMBOL: Record<string, string> = { USD: '$', GBP: '£', EUR: '€', HKD: 'HK$', CHF: 'CHF ', JPY: '¥', CNY: 'CN¥', AUD: 'A$', CAD: 'C$', SGD: 'S$' };

/** a native-currency figure, compact like formatPrice ($30K, £1.20M) */
export function money(n: number, cur = 'USD'): string {
  const s = SYMBOL[cur] ?? `${cur} `;
  if (n >= 1e9) return `${s}${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${s}${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e4) return `${s}${Math.round(n / 1e3)}K`;
  return `${s}${Math.round(n).toLocaleString('en-US')}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function day(d?: string): string | null {
  const m = d?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : null;
}

/** the house photo at share size (the same rule as app/lot/[id] shareImg):
 *  Christie's originals run 2–3 MB (WhatsApp / X drop them) → w=1200;
 *  Bonhams / Wright / Goldin through sizedImg's verified rungs */
export function shareImg(u: string | null | undefined): string | undefined {
  const h = httpsImg(u);
  if (!h) return undefined;
  if (/^https:\/\/www\.christies\.com\/img\//i.test(h) && !/[?&]w=\d/i.test(h)) return `${h}${h.includes('?') ? '&' : '?'}w=1200`;
  return sizedImg(h, 1200);
}

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

/** the lot's own head: what a shared /lot?id= link should say */
export function lotShareMeta(lot: ShareLot, origin = 'https://lectr.bid'): ShareMeta {
  const maker = (lot.artist && ARTIST_LABEL[lot.artist]) || '';
  const name = clip((lot.title || 'Lot').replace(/\s+/g, ' ').trim(), 90);
  const title = maker && !name.toLowerCase().includes(maker.toLowerCase()) ? `${name} — ${maker}` : name;
  const cur = lot.currency || 'USD';
  const sold = lot.status === 'sold' && lot.realizedNative ? `Sold for ${money(lot.realizedNative, cur)}` : null;
  const lo = lot.estimateLow || null, hi = lot.estimateHigh || null;
  const est = lo && hi ? `est. ${money(lo, cur)}–${money(hi, cur)}` : lo || hi ? `est. ${money((lo || hi)!, cur)}` : null;
  const when = day(lot.saleDate);
  const sale = [lot.auctionHouse, lot.lotNumber != null ? `lot ${lot.lotNumber}` : null, when].filter(Boolean).join(' · ');
  const sig = lot.value?.signal?.label;
  const comps = sig && lot.value?.n ? `Comparable sales: ${sig} (${lot.value.n} sales).` : null;
  const description = [[sold || est, sale].filter(Boolean).join(' · ') + '.', comps, 'lectr auction intelligence.']
    .filter(s => s && s !== '.').join(' ');
  return {
    title: `${title} — lectr`,
    description,
    image: shareImg(lot.imageUrl),
    imageAlt: `${title}${lot.auctionHouse ? `, at ${lot.auctionHouse}` : ''}`,
    url: `${origin}/lot?id=${encodeURIComponent(lot.id)}`,
  };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** rewrite a static page's head to `m`: title, description, og:*, twitter:*.
 *  Our own card's fixed 1200×630 size tags go when the image is a house photo
 *  (its size is whatever the house serves); og:url is added (the shell has
 *  none — one HTML serves every id). */
export function rewriteHead(html: string, m: ShareMeta): string {
  const end = html.indexOf('</head>');
  if (end < 0) return html;
  let head = html.slice(0, end);
  const meta = (attr: 'property' | 'name', key: string, val: string) => {
    const re = new RegExp(`<meta ${attr}="${key}" content="[^"]*"\\s*/?>`, 'g');
    const tag = `<meta ${attr}="${key}" content="${esc(val)}"/>`;
    head = re.test(head) ? head.replace(re, tag) : head + tag;
  };
  head = head.replace(/<title>[^<]*<\/title>/, `<title>${esc(m.title)}</title>`);
  meta('name', 'description', m.description);
  meta('property', 'og:title', m.title);
  meta('property', 'og:description', m.description);
  meta('property', 'og:url', m.url);
  meta('property', 'og:type', 'article');
  meta('name', 'twitter:title', m.title);
  meta('name', 'twitter:description', m.description);
  if (m.image) {
    head = head.replace(/<meta property="og:image:(?:width|height)" content="[^"]*"\s*\/?>/g, '');
    meta('property', 'og:image', m.image);
    meta('property', 'og:image:alt', m.imageAlt);
    meta('name', 'twitter:image', m.image);
    meta('name', 'twitter:image:alt', m.imageAlt);
  }
  return head + html.slice(end);
}
