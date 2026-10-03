import type { Metadata } from 'next';
import fs from 'node:fs';
import path from 'node:path';
import { flaggedLots } from '../flagged';
import LotPage from '../../components/LotPage';
import { splitTitle, formatDate, httpsImg, formatPrice } from '../../utils';
import { lotVerdict, fmtUsd } from '../../lib/verdict';

/** comps ÷ estimate as the one × multiple (TonightsWall.gapMultiple's rule) */
const gapMultiple = (pct: number) => (pct > 400 ? '5×+' : `${(pct / 100 + 1).toFixed(1)}×`);
import { ARTIST_LABEL } from '../../constants';
import { fmtExpected } from '../../lib/og-meta';

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

  const maker = ARTIST_LABEL[lot.artist] || lot.artist;
  const title = splitTitle(lot.title).short;
  const sig = lot.signal;
  const est = lot.estimateLow && lot.estimateHigh
    ? (formatPrice(lot.estimateLow) === formatPrice(lot.estimateHigh) ? formatPrice(lot.estimateLow) : `${formatPrice(lot.estimateLow)}–${formatPrice(lot.estimateHigh)}`)
    : lot.estimateLow || lot.estimateHigh
      ? formatPrice((lot.estimateLow || lot.estimateHigh)!)
      : null;
  // THE CALL, in the card's own sentence: the house's printed guess, then the
  // engine's expected hammer and its likely range (lotVerdict — the same
  // numbers the lot page's why panel prints)
  const vd = lotVerdict(lot);
  const description = [
    est ? `${lot.auctionHouse} says ${est}.` : `${lot.auctionHouse} prints no estimate.`,
    vd ? `The record says ${fmtUsd(vd.expected)}, likely ${fmtUsd(vd.bandLo)}–${fmtUsd(vd.bandHi)}.`
      : sig && sig.label === 'Below Market' ? `Comparable sales realized ${gapMultiple(sig.pct)} the estimate${sig.basis ? ` across ${sig.basis} sales` : ''}.` : null,
    `${maker} — ${title}. Hammers ${formatDate(lot.saleDate)}.`,
  ].filter(Boolean).join(' ');

  // the lot's own call card (scripts/build-og.tsx → public/og/lot/<id>.png);
  // the house photograph, then the site card, when the card was not drawn
  const card = path.join(process.cwd(), 'public', 'og', 'lot', `${lot.id}.png`);
  const image = fs.existsSync(card)
    ? `/og/lot/${encodeURIComponent(lot.id)}.png`
    : httpsImg(lot.imageUrl) || '/opengraph-image';

  // the lot number keeps same-named lots (editions, a run of comic pages)
  // from sharing one title
  // (Hake's publishes no lot numbers — its item number is the id's tail)
  const itemNo = lot.lotNumber ? `lot ${lot.lotNumber}` : (lot.id.match(/(\d{4,})~?$/)?.[1] ? `${lot.auctionHouse} #${lot.id.match(/(\d{4,})~?$/)![1]}` : '');
  const name = `${title}${itemNo ? `, ${itemNo}` : ''} — ${maker}`;
  return {
    // absolute: the plain-string title on app/lot/layout drops the root
    // template for this dynamic child (it shipped without the brand)
    title: { absolute: `${name} — lectr` },
    description,
    alternates: { canonical: `/lot/${lot.id}` },
    openGraph: {
      title: `${name} — lectr`,
      description,
      images: [image],
      type: 'article',
    },
    twitter: {
      card: 'summary_large_image',
      title: name,
      description,
      images: [image],
    },
  };
}

export default async function StaticLotPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const lot = flaggedLots().find(l => l.id === params.id) || null;
  // key: navigating between static lot pages must remount (fresh dbLot/
  // imgFailed state) — same doctrine as the /lot?id= query route.
  return <LotPage key={params.id} lotId={params.id} initialLot={lot} />;
}
