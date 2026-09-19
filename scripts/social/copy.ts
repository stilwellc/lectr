/**
 * The words. Desk voice: short declaratives, real numbers, no adjectives, no
 * hashtags in the body, no "🔥". A post says what the record says and stops.
 *
 * Platform shape:
 *   X   → the card post carries NO url (X bills a url post 13× a plain one),
 *         the link rides in one reply. Under 280 chars, always.
 *   IG  → captions cannot carry a live link, so the caption ends with the
 *         path a reader can type and the bio carries the domain.
 *
 * Every link carries utm_* so the day analytics exist the source is already
 * separable. Costs nothing now.
 */

import { Post, money, signed, whenLabel, marketLabel } from './lib';

export interface Copy {
  x: string;        // the post
  xReply: string;   // the link reply
  ig: string;       // the caption
  alt: string;      // image alt text, both platforms
}

const utm = (url: string, platform: 'x' | 'ig', type: string) =>
  `${url}${url.includes('?') ? '&' : '?'}utm_source=${platform}&utm_medium=social&utm_campaign=${type}`;

/** a truncated title already ends in an ellipsis — no period after it */
const sentence = (t: string) => (t.endsWith('…') ? t : `${t}.`);

const NO_ADVICE = 'Editorial analysis from public auction results, not investment advice.';

export function writeCopy(p: Post): Copy {
  switch (p.type) {
    case 'call': {
      const when = whenLabel(p.closes);
      const ask = p.estimate ? `${p.lot.auctionHouse} estimates ${p.estimate}.` : `${p.lot.auctionHouse} asks about ${money(p.askUsd)}.`;
      const x = [
        `${p.maker}. ${sentence(p.title)}`,
        `${ask} ${p.basis} comparable sales put the median at ${money(p.med)}. That is ${p.multiple} the ask.`,
        `Hammers ${when}.`,
      ].join('\n\n');
      return {
        x: clamp(x),
        xReply: `The comps, the pool, and the walk-away bid: ${utm(p.url, 'x', 'call')}`,
        ig: [
          `Tonight's call.`,
          ``,
          `${p.maker} — ${sentence(p.title)}`,
          `${ask} ${p.basis} comparable sales put the median at ${money(p.med)}, ${p.multiple} the ask. Hammers ${when}.`,
          ``,
          `The comps and the walk-away bid are on the lot page: lectr.bid/lot/${p.lot.id}`,
          ``,
          NO_ADVICE,
        ].join('\n'),
        alt: `${p.maker}, ${p.title}. ${p.estimate ? 'Estimate ' + p.estimate : 'Ask about ' + money(p.askUsd)}, comparable-sale median ${money(p.med)}, ${p.multiple} the ask. Hammers ${when} at ${p.lot.auctionHouse}.`,
      };
    }
    case 'receipt': {
      // the record grades a call by whether the hammer landed within ±30% of
      // the read — the same rule /receipts prints, nothing softer
      const verdict = p.hit ? 'Within the band.' : 'Outside the ±30% band. Missed.';
      const x = [
        `The receipt.`,
        `${p.maker}. ${sentence(p.title)}`,
        `Called ${fmtDay(p.row.d)} at ${money(p.row.p)}. Hammered ${fmtDay(p.row.sd || p.row.d)} at ${money(p.row.r)}. ${signed(p.deltaPct)}. ${verdict}`,
      ].join('\n\n');
      return {
        x: clamp(x),
        xReply: `Every call we have made, graded against what happened next: ${utm(p.url, 'x', 'receipt')}`,
        ig: [
          `The receipt.`,
          ``,
          `${p.maker} — ${sentence(p.title)}`,
          `Called ${fmtDay(p.row.d)} at ${money(p.row.p)}. Hammered ${fmtDay(p.row.sd || p.row.d)} at ${money(p.row.r)}. ${signed(p.deltaPct)}. ${verdict}`,
          ``,
          `We post the misses the same day we post the hits. The whole record is at lectr.bid/receipts`,
          ``,
          NO_ADVICE,
        ].join('\n'),
        alt: `Receipt: ${p.maker}, ${p.title}. Called at ${money(p.row.p)}, hammered at ${money(p.row.r)}, ${signed(p.deltaPct)}. ${verdict}`,
      };
    }
    case 'index': {
      const mk = marketLabel(p.market);
      const span = { '1Y': 'one year', '3Y': 'three years', '5Y': 'five years' }[p.horizon] || p.horizon;
      const method = p.method === 'repeat-sale' ? `Repeat-sale index, ${p.basis}.` : `Hedonic index, ${p.basis}.`;
      const x = [
        `${mk}: ${signed(p.changePct, 1)} over ${span}.`,
        `95% interval ${signed(p.ciLo, 0)} to ${signed(p.ciHi, 0)}. ${p.n.toLocaleString()} ${p.nLabel}.`,
        method,
      ].join('\n\n');
      return {
        x: clamp(x),
        xReply: `The series, the interval, and how it is built: ${utm(p.url, 'x', 'index')}`,
        ig: [
          `${mk}: ${signed(p.changePct, 1)} over ${span}.`,
          ``,
          `95% interval ${signed(p.ciLo, 0)} to ${signed(p.ciHi, 0)}, from ${p.n.toLocaleString()} ${p.nLabel}. ${method}`,
          ``,
          `Every index on the desk prints its interval or abstains. The series is at lectr.bid/analytics`,
          ``,
          NO_ADVICE,
        ].join('\n'),
        alt: `${mk} ${p.method} index: ${signed(p.changePct, 1)} over ${span}, 95% interval ${signed(p.ciLo)} to ${signed(p.ciHi)}, ${p.n.toLocaleString()} ${p.nLabel}.`,
      };
    }
    case 'record': {
      const x = [
        `The record, replayed.`,
        `${p.n.toLocaleString()} lots we flagged below their comparables, scored against what they actually hammered for. Median ${signed(p.flaggedMedianPct)} over estimate. Lots we did not flag: ${signed(p.unflaggedMedianPct)}.`,
        `${p.failToSellPct}% of flagged lots failed to sell. That number is on the page too.`,
      ].join('\n\n');
      return {
        x: clamp(x),
        xReply: `The replay, by year and by market: ${utm(p.url, 'x', 'record')}`,
        ig: [
          `The record, replayed.`,
          ``,
          `${p.n.toLocaleString()} lots we flagged below their comparables, scored against what they actually hammered for. Median ${signed(p.flaggedMedianPct)} over estimate. Lots we did not flag: ${signed(p.unflaggedMedianPct)}. ${p.failToSellPct}% of flagged lots failed to sell.`,
          ``,
          `By year and by market at lectr.bid/receipts`,
          ``,
          NO_ADVICE,
        ].join('\n'),
        alt: `The replayed record: ${p.n.toLocaleString()} flagged lots, median ${signed(p.flaggedMedianPct)} over estimate versus ${signed(p.unflaggedMedianPct)} unflagged.`,
      };
    }
  }
}

function fmtDay(iso: string): string {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : iso;
}

/** X counts URLs as 23 and most characters as 1; we ship no URL in the post,
 *  so a plain length check with headroom is enough. */
function clamp(s: string, max = 270): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  return cut.slice(0, cut.lastIndexOf(' ')) + '…';
}
