import type { Metadata } from 'next';
import { flaggedLots } from '../flagged';
import LotPage from '../../components/LotPage';
import { craftTitle, formatDate, httpsImg, formatPrice } from '../../utils';
import { signalMagnitude } from '../../lib/comps';
import { ARTIST_LABEL } from '../../constants';

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

export function generateMetadata({ params }: { params: { id: string } }): Metadata {
  const lot = flaggedLots().find(l => l.id === params.id);
  if (!lot) return { title: 'Lot' };

  const maker = ARTIST_LABEL[lot.artist] || lot.artist;
  const title = craftTitle(lot.title);
  const sig = lot.signal;
  const est = lot.estimateLow && lot.estimateHigh
    ? `${formatPrice(lot.estimateLow)}–${formatPrice(lot.estimateHigh)} est.`
    : lot.estimateLow || lot.estimateHigh
      ? `${formatPrice((lot.estimateLow || lot.estimateHigh)!)} est.`
      : null;
  const description = [
    `${maker} — flagged Below Market: comps run ${sig ? signalMagnitude(sig.label, sig.pct) : 'over'} the ask${sig?.basis ? ` across ${sig.basis} comparable sales` : ''}.`,
    est,
    `Hammers ${formatDate(lot.saleDate)} at ${lot.auctionHouse}.`,
  ].filter(Boolean).join(' ');

  // the lot's own photograph carries the share; https-forced (mixed-content),
  // falling back to the site card when the house published none
  const image = httpsImg(lot.imageUrl) || 'https://lectr.bid/opengraph-image';

  return {
    title: `${title} — ${maker}`,
    description,
    alternates: { canonical: `/lot/${lot.id}` },
    openGraph: {
      title: `${title} — ${maker} — lectr`,
      description,
      images: [image],
      type: 'article',
    },
    twitter: {
      card: 'summary_large_image',
      title: `${title} — ${maker}`,
      description,
      images: [image],
    },
  };
}

export default function StaticLotPage({ params }: { params: { id: string } }) {
  const lot = flaggedLots().find(l => l.id === params.id) || null;
  return <LotPage lotId={params.id} initialLot={lot} />;
}
