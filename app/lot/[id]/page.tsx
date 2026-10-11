import type { Metadata } from 'next';
import { flaggedLots } from '../flagged';
import LotPage from '../../components/LotPage';
import { splitTitle, formatDate, httpsImg, formatPrice } from '../../utils';
import { signalMagnitude } from '../../lib/comps';
import { makerLineOf } from '../../lib/lot-labels';
import JsonLd from '../../components/JsonLd';
import { seoMeta, webPageLd, breadcrumbLd, type Ld } from '../../lib/seo';
import { PAGE_MAKERS } from '../../lib/entity/retired';
import { ARTIST_LABEL, ARTIST_MARKET } from '../../constants';
import type { AuctionLot } from '../../types';

/**
 * The STATIC flagged set — /lot/<id> prerendered for every lot the crawl
 * flagged 'Below Market' (see flagged.ts; bounded well under the Cloudflare
 * Pages 20,000-file cap). Each page ships real metadata (title, signal
 * description, the lot's own photograph as og:image) and serializes the
 * build-time lot into LotPage as initialLot, so the first paint — and the
 * crawler — sees the full catalogue page before any JSON arrives. Live data
 * supersedes the snapshot on hydration. Everything NOT flagged resolves at
 * the universal /lot?id= route instead.
 */
export const dynamicParams = false;

export function generateStaticParams() {
  return flaggedLots().map(l => ({ id: l.id }));
}

export async function generateMetadata(props: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const params = await props.params;
  const lot = flaggedLots().find(l => l.id === params.id);
  if (!lot) return { title: 'Lot' };

  const maker = makerLineOf(lot).name;
  const title = splitTitle(lot.title, lot.auctionHouse).short;
  const sig = lot.signal;
  const est = lot.estimateLow && lot.estimateHigh
    ? `${formatPrice(lot.estimateLow)}–${formatPrice(lot.estimateHigh)} est.`
    : lot.estimateLow || lot.estimateHigh
      ? `${formatPrice((lot.estimateLow || lot.estimateHigh)!)} est.`
      : null;
  const description = [
    `${maker} — flagged Below Market: comps run ${sig ? signalMagnitude(sig.label, sig.pct) : 'over'} the ask${sig?.basis ? ` across ${sig.basis} comparable sales` : ''}.`,
    est,
    `Hammers ${formatDate(lot.saleDate)} at ${lot.auctionHouse}${lot.lotNumber != null ? `, lot ${lot.lotNumber}` : ''}.`,
  ].filter(Boolean).join(' ');
  // two flagged lots of one title (editions, a letter series in one sale)
  // would share a <title>: the lot number tells them apart
  const twin = lot.lotNumber != null && flaggedLots().some(o => o.id !== lot.id
    && makerLineOf(o).name === maker && splitTitle(o.title, o.auctionHouse).short === title);
  const head = `${title} — ${maker}${twin ? ` · lot ${lot.lotNumber}` : ''}`;

  // the lot's own photograph carries the share; https-forced (mixed-content),
  // falling back to the site card when the house published none
  const image = httpsImg(lot.imageUrl) || 'https://lectr.bid/opengraph-image';

  return seoMeta({
    title: head,
    description,
    path: `/lot/${lot.id}`,
    image,
    imageAlt: `${title} — ${maker}, at ${lot.auctionHouse}`,
    type: 'article',
  });
}

/** a flagged lot's structured data: the page and the work it is about, plus
 *  its breadcrumb. Deliberately NOT a Product/Offer: lectr sells nothing and
 *  the house estimate is not an offer price (app/lib/seo.ts). */
function lotLd(lot: AuctionLot): Ld[] {
  const maker = makerLineOf(lot).name;
  const title = splitTitle(lot.title, lot.auctionHouse).short;
  const path = `/lot/${encodeURIComponent(lot.id)}`;
  const img = httpsImg(lot.imageUrl);
  const art = ARTIST_MARKET[lot.artist] === 'art';
  const crumbs: [string, string][] = [['lectr', '/']];
  if (PAGE_MAKERS.includes(lot.artist)) crumbs.push([ARTIST_LABEL[lot.artist] || maker, `/makers/${lot.artist}`]);
  crumbs.push([title, path]);
  return [
    webPageLd({
      path, type: 'ItemPage', name: `${title} — ${maker}`,
      description: `${title} by ${maker}, offered at ${lot.auctionHouse} on ${formatDate(lot.saleDate)} — read against its comparable sales by lectr.`,
      image: img || undefined,
      about: {
        '@type': art ? 'VisualArtwork' : 'Thing',
        name: title,
        ...(img ? { image: img } : {}),
        ...(art ? { creator: { '@type': 'Person', name: maker } } : {}),
      },
    }),
    breadcrumbLd(crumbs),
  ];
}

export default async function StaticLotPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const lot = flaggedLots().find(l => l.id === params.id) || null;
  // key: navigating between static lot pages must remount (fresh dbLot/
  // imgFailed state) — same doctrine as the /lot?id= query route.
  return (
    <>
      {lot && <JsonLd data={lotLd(lot)} />}
      <LotPage key={params.id} lotId={params.id} initialLot={lot} />
    </>
  );
}
