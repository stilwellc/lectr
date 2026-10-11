/**
 * Christie's wrong-sale repair (Oct 11 2026) — a one-time, idempotent fix of
 * rows ingested under the WRONG sale before the crawl fix (3f88989).
 *
 * Until Oct 11 the Christie's discovery cut the room suffix off sale links
 * ("…-24504-nyr" → "…-24504"), and www read the SALE NUMBER as a SALE ID: a
 * different, 2012–2015 sale. 14 slugs resolved that way; the lots on those
 * legacy pages were real (real titles, prices, dates, lot pages) but were
 * stored under the slug's saleName — a Babbage first edition sold in "Fine
 * Printed Books and Manuscripts" (2013) rode the segment as "Picasso
 * Ceramics", American silver as "Rare Watches Including Watches For Ela".
 * 37 such rows sit in the published segment (35 under the 14 truncated slugs,
 * 2 more under the Paris-evening slug whose stripped number was the same
 * wine sale).
 *
 * The crawler no longer fetches those pages (every page 1 is identity-checked),
 * so no new row can arrive this way; this pass relabels the ones already
 * stored. Each mapping is (the slug's saleName, the legacy sale's day) → the
 * legacy sale's real name, read off the page the truncated URL served (its
 * <title> + sale_id / sale_number / room). A row matches only when it is a
 * Christie's auction-crawler row (id christies-auc-…) carrying that saleName
 * on that day — the slug's real (current) sale is years later, and the
 * legacy sale's day had no sale of that name. The rewrite changes the
 * saleName, so a second pass matches nothing (idempotent).
 *
 * Why relabel and not drop: the rows are genuine sold lots with their own lot
 * pages and prices; only the sale label was wrong, and 14 sibling rows of the
 * same legacy sale already carry the real name ("Fine Printed Books And
 * Manuscripts", 2013-11-15). Their artist / category routing is left to the
 * reclass ladder like any other row.
 */

export interface ChristiesWrongSale {
  /** the truncated slug that crawled the wrong sale */
  slug: string;
  /** the saleName the rows were stored under (christiesSaleNameOf(slug)) */
  wrongName: string;
  /** the legacy sale's day (YYYY-MM-DD, from the page's lot end_date; a row
   *  within a day of it matches — the stored day is the sale-local one) */
  day: string;
  /** the legacy sale the page actually was */
  saleId: string;
  saleNumber: string;
  room: string;
  title: string;
}

/** The 14 truncated-slug loads found Oct 11 2026 (live page identity of each
 *  suffix-stripped URL) + the Paris-evening slug of the same wine sale. */
export const CHRISTIES_WRONG_SALES: readonly ChristiesWrongSale[] = [
  { slug: 'art-contemporain-vente-du-jour-24609', wrongName: 'Art Contemporain Vente Du Jour', day: '2014-06-24', saleId: '24609', saleNumber: '1532', room: 'cks', title: 'Impressionist/Modern Evening Sale' },
  { slug: 'art-moderne-24608', wrongName: 'Art Moderne', day: '2014-06-10', saleId: '24608', saleNumber: '1531', room: 'cks', title: 'South Asian Modern + Contemporary Art' },
  { slug: 'auction-25241', wrongName: 'Auction', day: '2015-04-14', saleId: '25241', saleNumber: '10545', room: 'csk', title: 'Jewellery' },
  { slug: 'avant-garde-s-including-thinking-italian-24607', wrongName: 'Avant Garde S Including Thinking Italian', day: '2014-06-05', saleId: '24607', saleNumber: '1530', room: 'cks', title: 'Finest & Rarest Wines & Spirits including The Collection of Sir Alex Ferguson CBE' },
  { slug: '20th-21st-century-paris-evening-sale-including-thinking-italian-24607', wrongName: '20th 21st Century Paris Evening Sale Including Thinking Italian', day: '2014-06-05', saleId: '24607', saleNumber: '1530', room: 'cks', title: 'Finest & Rarest Wines & Spirits including The Collection of Sir Alex Ferguson CBE' },
  { slug: 'durand-ruel-generations-of-vision-25209', wrongName: 'Durand Ruel Generations Of Vision', day: '2014-07-25', saleId: '25209', saleNumber: '3499', room: 'nyr', title: 'Forms in Color' },
  { slug: 'impressionist-and-modern-art-day-sale-24501', wrongName: 'Impressionist And Modern Art Day Sale', day: '2013-05-13', saleId: '24501', saleNumber: '3407', room: 'nyr', title: 'The 11th Hour' },
  { slug: 'impressionist-and-modern-works-on-paper-sale-24500', wrongName: 'Impressionist And Modern Works On Paper Sale', day: '2014-12-16', saleId: '24500', saleNumber: '3051', room: 'ams', title: 'Modern Art' },
  { slug: 'picasso-ceramics-24248', wrongName: 'Picasso Ceramics', day: '2013-11-15', saleId: '24248', saleNumber: '9702', room: 'csk', title: 'Fine Printed Books and Manuscripts' },
  { slug: 'post-war-and-contemporary-art-day-sale-24268', wrongName: 'Post War And Contemporary Art Day Sale', day: '2012-12-05', saleId: '24268', saleNumber: '2770', room: 'nyr', title: 'Ancient Jewelry' },
  { slug: 'rare-watches-including-watches-for-ela-24403', wrongName: 'Rare Watches Including Watches For Ela', day: '2014-01-23', saleId: '24403', saleNumber: '2814', room: 'nyr', title: 'Important American Silver' },
  { slug: 'retromobile-new-york-auctions-25352', wrongName: 'Retromobile New York Auctions', day: '2015-12-15', saleId: '25352', saleNumber: '3797', room: 'nyr', title: 'Living With Art' },
  // resolved to a legacy sale but none of its lots carry the slug's name in the
  // segment (no tracked maker, or ingested under the real name) — listed so a
  // stray row would still be caught
  { slug: '21st-century-evening-sale-24499', wrongName: '21st Century Evening Sale', day: '2014-11-25', saleId: '24499', saleNumber: '3050', room: 'ams', title: 'Old Masters, 19th Century and Impressionist Art' },
  { slug: 'auction-19475', wrongName: 'Auction', day: '2004-10-31', saleId: '19475', saleNumber: '2175', room: 'hgk', title: 'Fine Modern and Contemporary Chinese Paintings' },
  { slug: 'watches-online-the-geneva-edit-24404', wrongName: 'Watches Online The Geneva Edit', day: '2014-01-24', saleId: '24404', saleNumber: '2815', room: 'nyr', title: 'Important American Furniture, Folk Art & Decorative Arts' },
];

/** A sale title in the stored saleName style (the Title-Cased slug words —
 *  "Fine Printed Books and Manuscripts" → "Fine Printed Books And Manuscripts",
 *  the name 14 sibling rows of that sale already carry). */
export function christiesSaleNameFromTitle(title: string): string {
  return title.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .split(/[^a-z0-9]+/).filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

type Row = { id?: unknown; auctionHouse?: unknown; saleName?: unknown; saleDate?: unknown };

const shiftDay = (day: string, d: number) => new Date(Date.parse(`${day}T12:00:00Z`) + d * 864e5).toISOString().slice(0, 10);
const BY_KEY = new Map<string, ChristiesWrongSale>();
for (const w of CHRISTIES_WRONG_SALES) for (const d of [-1, 0, 1]) BY_KEY.set(`${w.wrongName}|${shiftDay(w.day, d)}`, w);

/** Relabel the wrong-sale rows in place. Returns how many moved, per slug. */
export function repairChristiesWrongSaleRows(rows: Row[]): { total: number; bySlug: Record<string, number> } {
  const bySlug: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    if (r.auctionHouse !== "Christie's" || typeof r.id !== 'string' || !r.id.startsWith('christies-auc-')) continue;
    const day = typeof r.saleDate === 'string' ? r.saleDate.slice(0, 10) : '';
    const w = BY_KEY.get(`${String(r.saleName || '')}|${day}`);
    if (!w) continue;
    r.saleName = christiesSaleNameFromTitle(w.title);
    bySlug[w.slug] = (bySlug[w.slug] || 0) + 1;
    total++;
  }
  return { total, bySlug };
}
