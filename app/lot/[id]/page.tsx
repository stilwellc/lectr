import type { Metadata } from 'next';
import { flaggedLots } from '../flagged';
import LotPage from '../../components/LotPage';
import { splitTitle, formatDate, httpsImg, formatPrice } from '../../utils';
import { lotVerdict, fmtUsd } from '../../lib/verdict';

/** comps ÷ estimate as the one × multiple (TonightsWall.gapMultiple's rule) */
const gapMultiple = (pct: number) => (pct > 400 ? '5×+' : `${(pct / 100 + 1).toFixed(1)}×`);
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

export async function generateMetadata(props: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const params = await props.params;
  const lot = flaggedLots().find(l => l.id === params.id);
  if (!lot) return { title: 'Lot' };

  const maker = ARTIST_LABEL[lot.artist] || lot.artist;
  const title = splitTitle(lot.title).short;
  const sig = lot.signal;
  const est = lot.estimateLow && lot.estimateHigh
    ? `${formatPrice(lot.estimateLow)}–${formatPrice(lot.estimateHigh)} est.`
    : lot.estimateLow || lot.estimateHigh
      ? `${formatPrice((lot.estimateLow || lot.estimateHigh)!)} est.`
      : null;
  // the Oct 3 frame: the engine's expected hammer against the house
  // estimate when it made a value call; else the comps read in the one ×
  // grammar — never "below market"
  const vd = lotVerdict(lot);
  const description = [
    vd && vd.vsEstPct != null
      ? `${maker} — lectr expects a ${fmtUsd(vd.expected)} hammer (${vd.vsEstPct >= 0 ? '+' : '−'}${Math.abs(vd.vsEstPct)}% vs the house estimate), likely ${fmtUsd(vd.bandLo)}–${fmtUsd(vd.bandHi)}.`
      : `${maker} — flagged: comparable sales realized ${sig && sig.label === 'Below Market' ? gapMultiple(sig.pct) : 'over'} the estimate${sig?.basis ? ` across ${sig.basis} sales` : ''}.`,
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

export default async function StaticLotPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const lot = flaggedLots().find(l => l.id === params.id) || null;
  // key: navigating between static lot pages must remount (fresh dbLot/
  // imgFailed state) — same doctrine as the /lot?id= query route.
  return <LotPage key={params.id} lotId={params.id} initialLot={lot} />;
}
